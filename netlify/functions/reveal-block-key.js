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

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ success: false, error: 'POST only' }),
      };
    }
    const body = JSON.parse(event.body || '{}');
    const { session_id, block, commit_token } = body || {};
    if (!session_id || !block || !commit_token) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'missing fields',
        }),
      };
    }
    const [b64, sig] = commit_token.split('.');
    const want = hmacHex(MASTER, b64);
    if (sig !== want)
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'bad signature',
        }),
      };
    let payload;
    try {
      payload = JSON.parse(
        Buffer.from(b64, 'base64url').toString('utf8')
      );
    } catch {
      payload = null;
    }
    if (
      !payload ||
      payload.session_id !== session_id ||
      payload.block !== block
    ) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'claims mismatch',
        }),
      };
    }
    const { nonce } = payload;
    const K = crypto
      .createHmac('sha256', Buffer.from(MASTER, 'utf8'))
      .update(`K-derivation|v1|${session_id}|${block}|${nonce}`)
      .digest('hex');
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        K,
        commit_hash: crypto
          .createHash('sha256')
          .update(Buffer.from(K, 'hex'))
          .digest('hex'),
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: String(e) }),
    };
  }
};
