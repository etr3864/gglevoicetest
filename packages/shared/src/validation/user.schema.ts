import { z } from 'zod';

const password = z.string().min(8, 'סיסמה חייבת להכיל לפחות 8 תווים').max(128);
const email = z.string().email('כתובת אימייל לא תקינה');
const name = z.string().min(2, 'שם חייב להכיל לפחות 2 תווים').max(100);

export const createAdminSchema = z.object({
  email,
  password,
  name,
  companyName: z.string().min(2).max(100).optional(),
  phone: z.string().max(20).optional(),
});

export const createEmployeeSchema = z.object({
  email,
  password,
  name,
});

export const createSuperAdminSchema = z.object({
  email,
  password,
  name,
});

export const updateAdminSchema = z.object({
  name: name.optional(),
  companyName: z.string().min(2).max(100).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const updateEmployeeSchema = z.object({
  name: name.optional(),
  isActive: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

export const resetPasswordSchema = z.object({
  password,
});
