/** Same normalization as the main-process text index (`electron/text-index.ts`). */
export function normalizeForMatch(value: string): string {
  let normalized = "";
  let prevIsAlpha = false;
  let prevIsDigit = false;
  for (const c of value) {
    if (/[a-zA-Z0-9]/.test(c)) {
      const isAlpha = /[a-zA-Z]/.test(c);
      const isDigit = /[0-9]/.test(c);
      if (
        normalized.length > 0 &&
        ((prevIsAlpha && isDigit) || (prevIsDigit && isAlpha))
      ) {
        normalized += " ";
      }
      normalized += c.toLowerCase();
      prevIsAlpha = isAlpha;
      prevIsDigit = isDigit;
    } else {
      normalized += " ";
      prevIsAlpha = false;
      prevIsDigit = false;
    }
  }
  return normalized
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .join(" ");
}
