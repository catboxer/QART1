// Stateless, CommonJS
const crypto = require('crypto');

const MASTER = process.env.HMAC_MASTER_SECRET;
if (!MASTER) console.warn('HMAC_MASTER_SECRET not set');

function hmacHex(key, data) {
  return crypto
    .createHmac('sha256', Buffer.from(key, 'utf8'))
    .update(data)
    .digest('hex');
}
function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
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
    const { session_id, block } = body || {};
    if (!session_id || !block) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'missing session_id or block',
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

    const nonce = crypto.randomBytes(16).toString('hex');
    const exp = Date.now() + 2 * 60 * 60 * 1000; // 2 hours

    // token payload (base64url) + signature hex
    const payload = { v: 1, session_id, block, nonce, exp };
    const b64 = Buffer.from(JSON.stringify(payload)).toString(
      'base64url'
    );
    const sig = hmacHex(MASTER, b64);
    const commit_token = `${b64}.${sig}`;

    // derive K and its hash for audit (no storage)
    const K = crypto
      .createHmac('sha256', Buffer.from(MASTER, 'utf8'))
      .update(`K-derivation|v1|${session_id}|${block}|${nonce}`)
      .digest();
    const commit_hash = sha256hex(K);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        commit_token,
        commit_hash,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: String(e) }),
    };
  }
};
