// Fails when a tracked file contains something that looks like a real credential.
// Run: npm run scan:secrets   (also part of CI). It is a safety net, not a guarantee.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const PATTERNS = [
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["OpenAI-style key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
  ["Resend key", /\bre_[A-Za-z0-9]{20,}\b/],
  ["Stripe/Razorpay live secret", /\b(?:sk_live|rzp_live)_[A-Za-z0-9]{10,}/],
  ["JWT-shaped token", /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/],
  [
    "Postgres URL with password",
    /postgres(?:ql)?:\/\/[^:\s/@]+:(?!password|\[|<|\$|your|x{3,}|\*{3,})[^@\s]{6,}@/i,
  ],
];

export function scanText(text) {
  const hits = [];
  for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(name);
  return hits;
}

const isMain =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const skip =
    /(^|\/)(package-lock\.json|.*\.(png|jpe?g|webp|ico|woff2?|pdf)|scripts\/scan-secrets\.mjs|tests\/unit\/secret-scan\.test\.ts)$/;
  let bad = 0;
  for (const f of files) {
    if (skip.test(f)) continue;
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const hit of scanText(text)) {
      console.error(`${f}: looks like a ${hit}`);
      bad++;
    }
  }
  if (bad) {
    console.error(
      `\n${bad} possible secret(s). Remove them and rotate the credential if it was real.`,
    );
    process.exit(1);
  }
  console.log(`No secrets found in ${files.length} tracked files.`);
}
