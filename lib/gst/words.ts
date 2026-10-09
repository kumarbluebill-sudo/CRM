const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ""));
  } else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}

/** Whole number in the Indian system (thousand, lakh, crore). */
export function numberToWordsIndian(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError("whole non-negative number expected");
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  const out: string[] = [];
  if (crore) out.push(`${numberToWordsIndian(crore)} Crore`);
  if (lakh) out.push(`${below1000(lakh)} Lakh`);
  if (thousand) out.push(`${below1000(thousand)} Thousand`);
  if (rest) out.push(below1000(rest));
  return out.join(" ");
}

/** "Rupees Twelve Thousand Nine Hundred Eighty and Fifty Paise Only" (INR) or "<CODE> ... Only" for other currencies. */
export function amountInWords(amount: number, currency = "INR"): string {
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(cents / 100);
  const paise = cents % 100;
  const unit = currency === "INR" ? "Rupees" : currency;
  const sub = currency === "INR" ? "Paise" : "Cents";
  return `${unit} ${numberToWordsIndian(whole)}${paise ? ` and ${numberToWordsIndian(paise)} ${sub}` : ""} Only`;
}
