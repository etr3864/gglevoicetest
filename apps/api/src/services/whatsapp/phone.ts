export function toWasenderJid(e164: string): string {
  return `${e164.replace(/^\+/, '')}@c.us`;
}
