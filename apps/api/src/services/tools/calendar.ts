import { prisma } from '@voice/db';
import { globalRegistry } from './registry';
import type { ToolContext } from './registry';
import {
  getValidToken,
  getFreeBusy,
  createEvent,
  updateEvent,
  deleteEvent,
  TIMEZONE,
  type FreeBusySlot,
} from '../calendar/google';
import type { BusinessHours, CalendarConfig } from '@voice/shared';

const SLOT_DURATION_MIN = 30;

export function registerCalendarTools(): void {
  globalRegistry.register(
    {
      name: 'check_availability',
      description: 'Check available appointment slots for a specific date. Returns a list of available time windows.',
      parameters: {
        date: {
          type: 'string',
          description: 'The date to check availability for, in YYYY-MM-DD format',
        },
      },
      required: ['date'],
    },
    async (args, ctx) => {
      return checkAvailability(args.date as string, ctx);
    },
  );

  globalRegistry.register(
    {
      name: 'book_appointment',
      description: 'Book an appointment at a specific date and time. Validates the slot is available before booking.',
      parameters: {
        date: {
          type: 'string',
          description: 'Appointment date in YYYY-MM-DD format',
        },
        time: {
          type: 'string',
          description: 'Appointment start time in HH:MM format (24h)',
        },
        duration: {
          type: 'number',
          description: 'Duration in minutes (default 30)',
        },
        title: {
          type: 'string',
          description: 'Appointment title/purpose',
        },
        description: {
          type: 'string',
          description: 'Optional additional details',
        },
      },
      required: ['date', 'time', 'title'],
    },
    async (args, ctx) => {
      return bookAppointment(
        {
          date: args.date as string,
          time: args.time as string,
          duration: (args.duration as number) || SLOT_DURATION_MIN,
          title: args.title as string,
          description: args.description as string | undefined,
        },
        ctx,
      );
    },
  );

  globalRegistry.register(
    {
      name: 'reschedule_appointment',
      description: 'Reschedule an existing appointment to a new date/time. Finds the appointment by the contact phone and moves it.',
      parameters: {
        appointmentId: {
          type: 'string',
          description: 'The appointment ID to reschedule',
        },
        newDate: {
          type: 'string',
          description: 'New date in YYYY-MM-DD format',
        },
        newTime: {
          type: 'string',
          description: 'New start time in HH:MM format (24h)',
        },
      },
      required: ['appointmentId', 'newDate', 'newTime'],
    },
    async (args, ctx) => {
      return rescheduleAppointment(
        args.appointmentId as string,
        args.newDate as string,
        args.newTime as string,
        ctx,
      );
    },
  );

  globalRegistry.register(
    {
      name: 'cancel_appointment',
      description: 'Cancel an existing appointment. Removes it from Google Calendar and marks it as cancelled.',
      parameters: {
        appointmentId: {
          type: 'string',
          description: 'The appointment ID to cancel',
        },
      },
      required: ['appointmentId'],
    },
    async (args, ctx) => {
      return cancelAppointment(args.appointmentId as string, ctx);
    },
  );
}

// --- Handlers ---

async function checkAvailability(date: string, ctx: ToolContext) {
  const agent = await prisma.agent.findUnique({ where: { id: ctx.agentId } });
  if (!agent?.calendarConfig) {
    return { error: 'Calendar not connected for this agent' };
  }

  const businessHours = agent.businessHours as unknown as BusinessHours | null;
  const dayHours = getDayHours(date, businessHours);
  if (!dayHours) {
    return { available: false, slots: [], message: 'Business is closed on this day' };
  }

  const { token, calendarId } = await getValidToken(ctx.agentId);
  const timeMin = toISOWithTZ(date, dayHours.start);
  const timeMax = toISOWithTZ(date, dayHours.end);

  const [busySlots, localAppointments] = await Promise.all([
    getFreeBusy(token, calendarId, timeMin, timeMax),
    prisma.appointment.findMany({
      where: {
        agentId: ctx.agentId,
        status: { in: ['scheduled'] },
        startTime: { gte: new Date(timeMin) },
        endTime: { lte: new Date(timeMax) },
      },
    }),
  ]);

  const allBusy = mergeBusySlots(busySlots, localAppointments);
  const available = computeAvailableSlots(dayHours.start, dayHours.end, allBusy, date);

  return { available: available.length > 0, slots: available, date, timezone: TIMEZONE };
}

async function bookAppointment(
  params: { date: string; time: string; duration: number; title: string; description?: string },
  ctx: ToolContext,
) {
  const agent = await prisma.agent.findUnique({ where: { id: ctx.agentId } });
  if (!agent?.calendarConfig) {
    return { error: 'Calendar not connected for this agent' };
  }

  const startISO = toISOWithTZ(params.date, params.time);
  const endDate = new Date(startISO);
  endDate.setMinutes(endDate.getMinutes() + params.duration);
  const endISO = endDate.toISOString();

  const { token, calendarId } = await getValidToken(ctx.agentId);

  const busy = await getFreeBusy(token, calendarId, startISO, endISO);
  if (busy.length > 0) {
    return { error: 'This time slot is no longer available' };
  }

  const contact = ctx.contactPhone
    ? await prisma.contact.findUnique({ where: { phone: ctx.contactPhone } })
    : null;

  const { eventId } = await createEvent(token, calendarId, {
    summary: params.title,
    description: params.description,
    start: startISO,
    end: endISO,
    attendeeName: contact?.name ?? undefined,
    attendeePhone: ctx.contactPhone,
  });

  const appointment = await prisma.appointment.create({
    data: {
      agentId: ctx.agentId,
      contactId: contact?.id ?? null,
      callId: ctx.callId,
      googleEventId: eventId,
      title: params.title,
      description: params.description ?? null,
      phone: ctx.contactPhone || '',
      startTime: new Date(startISO),
      endTime: endDate,
      duration: params.duration,
      status: 'scheduled',
    },
  });

  return {
    booked: true,
    appointmentId: appointment.id,
    date: params.date,
    time: params.time,
    duration: params.duration,
    title: params.title,
  };
}

async function rescheduleAppointment(
  appointmentId: string,
  newDate: string,
  newTime: string,
  ctx: ToolContext,
) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment || appointment.agentId !== ctx.agentId) {
    return { error: 'Appointment not found' };
  }
  if (appointment.status !== 'scheduled') {
    return { error: `Cannot reschedule — appointment is ${appointment.status}` };
  }

  const { token, calendarId } = await getValidToken(ctx.agentId);

  const newStartISO = toISOWithTZ(newDate, newTime);
  const newEnd = new Date(newStartISO);
  newEnd.setMinutes(newEnd.getMinutes() + appointment.duration);
  const newEndISO = newEnd.toISOString();

  const busy = await getFreeBusy(token, calendarId, newStartISO, newEndISO);
  if (busy.length > 0) {
    return { error: 'The new time slot is not available' };
  }

  if (appointment.googleEventId) {
    await updateEvent(token, calendarId, appointment.googleEventId, {
      start: newStartISO,
      end: newEndISO,
    });
  }

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      startTime: new Date(newStartISO),
      endTime: newEnd,
    },
  });

  return {
    rescheduled: true,
    appointmentId,
    newDate,
    newTime,
    duration: appointment.duration,
  };
}

async function cancelAppointment(appointmentId: string, ctx: ToolContext) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment || appointment.agentId !== ctx.agentId) {
    return { error: 'Appointment not found' };
  }
  if (appointment.status === 'cancelled') {
    return { error: 'Appointment is already cancelled' };
  }

  if (appointment.googleEventId) {
    const { token, calendarId } = await getValidToken(ctx.agentId);
    await deleteEvent(token, calendarId, appointment.googleEventId);
  }

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: 'cancelled' },
  });

  return { cancelled: true, appointmentId };
}

// --- Helpers ---

function getDayHours(
  dateStr: string,
  businessHours: BusinessHours | null,
): { start: string; end: string } | null {
  if (!businessHours) {
    return { start: '09:00', end: '17:00' };
  }

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = new Date(dateStr + 'T12:00:00').getDay();
  const dayName = dayNames[dayIndex];
  const hours = businessHours[dayName];
  return hours ?? null;
}

function toISOWithTZ(date: string, time: string): string {
  const dt = new Date(`${date}T${time}:00`);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(dt);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${time}:00+02:00`;
}

function mergeBusySlots(
  googleBusy: FreeBusySlot[],
  localAppointments: { startTime: Date; endTime: Date }[],
): { start: number; end: number }[] {
  const all = [
    ...googleBusy.map(s => ({ start: new Date(s.start).getTime(), end: new Date(s.end).getTime() })),
    ...localAppointments.map(a => ({ start: a.startTime.getTime(), end: a.endTime.getTime() })),
  ];
  return all.sort((a, b) => a.start - b.start);
}

function computeAvailableSlots(
  dayStart: string,
  dayEnd: string,
  busy: { start: number; end: number }[],
  dateStr: string,
): { start: string; end: string }[] {
  const dayStartMs = new Date(toISOWithTZ(dateStr, dayStart)).getTime();
  const dayEndMs = new Date(toISOWithTZ(dateStr, dayEnd)).getTime();
  const slotMs = SLOT_DURATION_MIN * 60 * 1000;
  const slots: { start: string; end: string }[] = [];

  let cursor = dayStartMs;
  for (const block of busy) {
    while (cursor + slotMs <= block.start && cursor + slotMs <= dayEndMs) {
      slots.push({ start: fmtTime(cursor), end: fmtTime(cursor + slotMs) });
      cursor += slotMs;
    }
    cursor = Math.max(cursor, block.end);
  }

  while (cursor + slotMs <= dayEndMs) {
    slots.push({ start: fmtTime(cursor), end: fmtTime(cursor + slotMs) });
    cursor += slotMs;
  }

  return slots;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' });
}
