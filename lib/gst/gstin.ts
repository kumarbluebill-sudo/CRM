const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Same rules as gstin_valid() in the database: shape, state code and the mod-36 check character. */
export function gstinValid(value: string | null | undefined): boolean {
  const g = value ?? "";
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  const state = Number(g.slice(0, 2));
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = ALPHABET.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36] === g[14];
}
