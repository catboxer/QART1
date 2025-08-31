// Stateless, CommonJS
const crypto = require('crypto');

const MASTER = process.env.HMAC_MASTER_SECRET;
if (!MASTER) console.warn('HMAC_MASTER_SECRET not set');

function hmac(key, data) {
  return crypto
    .createHmac('sha256', Buffer.from(key, 'utf8'))
    .update(data)
    .digest();
}
function hmacHex(key, data) {
  return crypto
    .createHmac('sha256', Buffer.from(key, 'utf8'))
    .update(data)
    .digest('hex');
}
function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function verifyToken(commit_token, expectedSession, expectedBlock) {
  if (typeof commit_token !== 'string' || !commit_token.includes('.'))
    return { ok: false, error: 'bad token' };
  const [b64, sig] = commit_token.split('.');
  const want = hmacHex(MASTER, b64);
  if (sig !== want) return { ok: false, error: 'bad signature' };
  let payload;
  try {
    payload = JSON.parse(
      Buffer.from(b64, 'base64url').toString('utf8')
    );
  } catch {
    return { ok: false, error: 'bad payload' };
  }
  const { v, session_id, block, nonce, exp } = payload || {};
  if (v !== 1 || !session_id || !block || !nonce || !exp)
    return { ok: false, error: 'missing claims' };
  if (session_id !== expectedSession || block !== expectedBlock)
    return { ok: false, error: 'claims mismatch' };
  if (Date.now() > Number(exp))
    return { ok: false, error: 'token expired' };
  return { ok: true, nonce };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ success: false, error: 'POST only' }),
      };
    }
    const body = JSON.parse(event.body || '{}');
    const {
      session_id,
      block,
      trial_index,
      commit_token, // NEW
      press_start_ts,
      press_bucket_ms,
      selected_index,
      options,
      raw_byte, // allow client to send its pre-drawn byte (already logged on client)
    } = body || {};

    if (!session_id || !block || !trial_index) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'missing fields',
        }),
      };
    }
    if (selected_index == null) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'selected_index required',
        }),
      };
    }
    if (!Array.isArray(options) || options.length !== 5) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'options must be 5 ids',
        }),
      };
    }
    if (typeof raw_byte !== 'number') {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'raw_byte required',
        }),
      };
    }
    if (!MASTER) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: 'HMAC_MASTER_SECRET missing',
        }),
      };
    }

    // verify token
    const vt = verifyToken(commit_token, session_id, block);
    if (!vt.ok) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: vt.error }),
      };
    }

    // derive K from secret + nonce (stateless)
    const K = hmac(
      MASTER,
      `K-derivation|v1|${session_id}|${block}|${vt.nonce}`
    );

    // canonical context
    const ctx = JSON.stringify({
      v: 1,
      session_id,
      block,
      trial_index: Number(trial_index),
      press_bucket_ms: Math.floor(Number(press_bucket_ms) || 0),
      selected_index: Number(selected_index),
      options,
      raw_byte: Number(raw_byte),
      purpose: 'target',
    });

    const digest = crypto
      .createHmac('sha256', K)
      .update(ctx)
      .digest();
    const r = digest[0] % 5;
    const proof_hmac = crypto
      .createHmac('sha256', K)
      .update(ctx + '|r=' + r)
      .digest()
      .subarray(0, 8)
      .toString('hex');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        r,
        proof_hmac,
        server_time: Date.now(),
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: String(e) }),
    };
  }
};
