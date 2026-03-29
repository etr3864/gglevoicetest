const SOFT_THRESHOLD = 24576; // 75% of 32767
const SOFT_RATIO = 0.3;

export function softLimitPcm16Le(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i <= buf.length - 2; i += 2) {
    const s = buf.readInt16LE(i);
    const limited =
      s > SOFT_THRESHOLD
        ? SOFT_THRESHOLD + (s - SOFT_THRESHOLD) * SOFT_RATIO
        : s < -SOFT_THRESHOLD
          ? -SOFT_THRESHOLD + (s + SOFT_THRESHOLD) * SOFT_RATIO
          : s;
    out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(limited))), i);
  }
  return out;
}
