export interface Agent {
  id: string;
  name: string;
  phoneNumber: string | null;
  telnyxPhoneId: string | null;
  telnyxAppId: string | null;
  status: 'active' | 'inactive';
  voice: string;
  basePrompt: string | null;
  activeHours: ActiveHours | null;
  calendarConfig: CalendarConfig | null;
  calendarInstructions: string | null;
  businessHours: BusinessHours | null;
  createdAt: string;
}

export interface ActiveHours {
  [day: string]: { start: string; end: string } | null;
}

export interface ReminderRule {
  minutesBefore: number;
  contentType: 'template' | 'ai';
  template: string | null;
  aiPrompt: string | null;
}

export interface ReminderConfig {
  enabled: boolean;
  retryAttempts: number;
  retryDelayMinutes: number;
  rules: ReminderRule[];
}

export interface CalendarConfig {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  calendarId: string;
  reminders?: ReminderConfig;
}

export interface BusinessHours {
  [day: string]: { start: string; end: string } | null;
}

export interface CreateAgentBody {
  name: string;
  basePrompt?: string;
}

export interface UpdateAgentBody {
  name?: string;
  basePrompt?: string | null;
  status?: 'active' | 'inactive';
  voice?: string;
  phoneNumber?: string | null;
  telnyxPhoneId?: string | null;
  telnyxAppId?: string | null;
  activeHours?: ActiveHours | null;
  calendarInstructions?: string | null;
  businessHours?: BusinessHours | null;
}
