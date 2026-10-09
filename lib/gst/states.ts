/** GST state / union-territory codes, as used for place of supply. */
export const GST_STATES: { code: string; name: string }[] = [
  ["01", "Jammu and Kashmir"],
  ["02", "Himachal Pradesh"],
  ["03", "Punjab"],
  ["04", "Chandigarh"],
  ["05", "Uttarakhand"],
  ["06", "Haryana"],
  ["07", "Delhi"],
  ["08", "Rajasthan"],
  ["09", "Uttar Pradesh"],
  ["10", "Bihar"],
  ["11", "Sikkim"],
  ["12", "Arunachal Pradesh"],
  ["13", "Nagaland"],
  ["14", "Manipur"],
  ["15", "Mizoram"],
  ["16", "Tripura"],
  ["17", "Meghalaya"],
  ["18", "Assam"],
  ["19", "West Bengal"],
  ["20", "Jharkhand"],
  ["21", "Odisha"],
  ["22", "Chhattisgarh"],
  ["23", "Madhya Pradesh"],
  ["24", "Gujarat"],
  ["26", "Dadra and Nagar Haveli and Daman and Diu"],
  ["27", "Maharashtra"],
  ["29", "Karnataka"],
  ["30", "Goa"],
  ["31", "Lakshadweep"],
  ["32", "Kerala"],
  ["33", "Tamil Nadu"],
  ["34", "Puducherry"],
  ["35", "Andaman and Nicobar Islands"],
  ["36", "Telangana"],
  ["37", "Andhra Pradesh"],
  ["38", "Ladakh"],
  ["97", "Other Territory"],
  ["99", "Centre Jurisdiction"],
].map(([code, name]) => ({ code, name }));

export const stateName = (code: string | null | undefined) =>
  GST_STATES.find((s) => s.code === code)?.name ?? code ?? "";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Best-effort match of a free-text state name (from the customer record) to a code; null if unsure. */
export function stateCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = norm(name);
  if (!n) return null;
  const hit = GST_STATES.find((s) => norm(s.name) === n);
  if (hit) return hit.code;
  const alias: Record<string, string> = {
    "jammu and kashmir": "01",
    "j and k": "01",
    orissa: "21",
    pondicherry: "34",
    "andaman and nicobar": "35",
    "dadra and nagar haveli": "26",
    "daman and diu": "26",
    uttaranchal: "05",
    "new delhi": "07",
    "nct of delhi": "07",
  };
  return alias[n] ?? null;
}
