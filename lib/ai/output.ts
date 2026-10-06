const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Model output is shown as plain text only. Strip control characters, tidy blank lines, cap the length. */
export function cleanAiText(raw: string, max = 4000): string {
  return raw
    .replace(CONTROL, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}
