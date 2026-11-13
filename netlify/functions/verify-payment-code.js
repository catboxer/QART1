// netlify/functions/verify-payment-code.js
// Checks that a personal payment code (?TREMENDOUS=<code>) is genuine.
//
// A code is 10 characters from a 32-symbol alphabet: 5 random characters
// followed by a 5-character tag = HMAC-SHA256(PAYMENT_CODE_SECRET, first5).
// Only someone with the secret can make a code that verifies. Generate codes
// with scripts/make-payment-codes.js.
//
// Requires env var: PAYMENT_CODE_SECRET (Netlify site config, or root .env)
//
// GET /.netlify/functions/verify-payment-code?code=ABCDE12345
//   -> { valid: true|false }            (200)
//   -> { valid: false, error: 'not_configured' }   (503, secret missing)

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function tagFor(secret, first5) {
  const mac = crypto.createHmac('sha256', secret).update(first5).digest();
  let out = '';
  for (let i = 0; i < 5; i++) out += ALPHABET[mac[i] % 32];
  return out;
}

exports.tagFor = tagFor;
exports.ALPHABET = ALPHABET;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  const secret = process.env.PAYMENT_CODE_SECRET;
  if (!secret) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({ valid: false, error: 'not_configured' }),
    };
  }
  const code = String(event.queryStringParameters?.code || '')
    .trim()
    .toUpperCase();
  const wellFormed =
    code.length === 10 && [...code].every((c) => ALPHABET.includes(c));
  let valid = false;
  if (wellFormed) {
    const expected = Buffer.from(tagFor(secret, code.slice(0, 5)));
    const given = Buffer.from(code.slice(5));
    valid = crypto.timingSafeEqual(expected, given);
  }
  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ valid }),
  };
};
