#!/usr/bin/env node
// Generates personal payment codes and the matching study links.
//
// Usage:
//   PAYMENT_CODE_SECRET='<same secret as in Netlify>' \
//     node scripts/make-payment-codes.js <count> [base-url] > payment-codes.csv
//
// Output (CSV): code,param   e.g.  H6M5DR7Z44,TREMENDOUS=H6M5DR7Z44
//   (param = everything after the "?" in the link). With a base-url, a third
//   column "link" holds the full link. Keep the output private: it is your list
//   of who may be paid. Never commit it, and never put the secret in the repo.

const crypto = require('crypto');
const { tagFor, ALPHABET } = require('../netlify/functions/verify-payment-code.js');

const secret = process.env.PAYMENT_CODE_SECRET;
const count = parseInt(process.argv[2], 10);
const base = process.argv[3] || null;
if (!secret || !count) {
  console.error('Usage: PAYMENT_CODE_SECRET=... node scripts/make-payment-codes.js <count> [base-url]');
  process.exit(1);
}

const seen = new Set();
console.log(base ? 'code,param,link' : 'code,param');
while (seen.size < count) {
  let first5 = '';
  const rnd = crypto.randomBytes(5);
  for (let i = 0; i < 5; i++) first5 += ALPHABET[rnd[i] % 32];
  const code = first5 + tagFor(secret, first5);
  if (seen.has(code)) continue;
  seen.add(code);
  console.log(base ? `${code},TREMENDOUS=${code},${base}?TREMENDOUS=${code}` : `${code},TREMENDOUS=${code}`);
}
