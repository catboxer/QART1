// netlify/functions/verify-payment-code.js
// Checks that a personal payment code (?TREMENDOUS=<code>) is genuine.
//
// A code is 13 characters from a 32-symbol alphabet: 5 random characters
// followed by an 8-character tag = HMAC-SHA256(PAYMENT_CODE_SECRET, first5).
// (The tag is 40 bits, so guessing a valid one is not feasible even with many tries,
// and this endpoint is also rate limited.)
// Only someone with the secret can make a code that verifies. Generate codes
// with scripts/make-payment-codes.js.
//
// Requires env var: PAYMENT_CODE_SECRET (Netlify site config, or root .env)
//
// GET /.netlify/functions/verify-payment-code?code=ABCDE12345678
//   -> { valid: true|false }            (200)
//   -> { valid: false, error: 'not_configured' }   (503, secret missing)

const crypto = require('crypto');
const { guard } = require('../lib/guard.js');

const TAG_LEN = 8;
const CODE_LEN = 5 + TAG_LEN;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function tagFor(secret, first5) {
  const mac = crypto.createHmac('sha256', secret).update(first5).digest();
  let out = '';
  for (let i = 0; i < TAG_LEN; i++) out += ALPHABET[mac[i] % 32];
  return out;
}

exports.tagFor = tagFor;
exports.ALPHABET = ALPHABET;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  // Strict: a person checking their own link needs a handful of calls, not dozens.
  const blocked = guard(event, 'verify-payment-code', { max: 20, windowMs: 10 * 60 * 1000 });
  if (blocked) return { ...blocked, headers: CORS };
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
    code.length === CODE_LEN && [...code].every((c) => ALPHABET.includes(c));
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
