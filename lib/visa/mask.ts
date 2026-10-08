/**
 * Passport numbers are shown masked everywhere except the traveller's own detail screen:
 * A1234567 -> A12****67. Short or odd values are masked more aggressively. Never log the unmasked value.
 */
export function maskPassport(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (v.length <= 4) return "*".repeat(v.length);
  if (v.length < 7) return `${v.slice(0, 1)}${"*".repeat(v.length - 2)}${v.slice(-1)}`;
  return `${v.slice(0, 3)}${"*".repeat(v.length - 5)}${v.slice(-2)}`;
}
