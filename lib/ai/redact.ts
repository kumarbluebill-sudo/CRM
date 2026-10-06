/** Data minimisation for free text sent to the model: contact details and ID-like numbers are not needed. */
export function redactForAiText(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]")
    .replace(/\b[A-Z]{1,2}\d{6,9}\b/g, "[id]");
}
