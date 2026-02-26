const IL_LOCAL = /^0[2-9]\d{7,8}$/;
const IL_NO_PLUS = /^972[2-9]\d{7,8}$/;
const E164 = /^\+\d{10,15}$/;

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s\-()]/g, '');

  if (E164.test(digits)) return digits;
  if (IL_NO_PLUS.test(digits)) return `+${digits}`;
  if (IL_LOCAL.test(digits)) return `+972${digits.slice(1)}`;

  return digits.startsWith('+') ? digits : `+${digits}`;
}
