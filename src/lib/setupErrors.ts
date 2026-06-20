/** Errors already covered by setup onboarding — hide duplicate inline alerts. */
export function isSetupRelatedError(message: string): boolean {
  const text = message.trim().toLowerCase();
  return (
    text.includes("missing gemini api key") ||
    text.includes("qdrant is not") ||
    text.includes("qdrant isn't")
  );
}

export function normalizeAlertMessage(message: string): string {
  return message.replace(/^Error:\s*/i, "").trim();
}
