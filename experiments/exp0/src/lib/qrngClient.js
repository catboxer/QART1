// qrngClient.js — wraps your Netlify function used in MainApp.jsx
export async function getQuantumPairOrThrow(
  retries = 2,
  backoffMs = 250
) {
  const make = () =>
    fetch(
      `/.netlify/functions/qrng-race?pair=1&nonce=${Date.now()}`,
      {
        cache: 'no-store',
      }
    );

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await make();
      if (!res.ok)
        throw new Error(
          'qrng_http_' + res.status + '_' + (res.statusText || '')
        );
      const j = await res.json(); // { success, bytes:[b0,b1], source, server_time }
      if (
        j?.success === true &&
        Array.isArray(j.bytes) &&
        j.bytes.length >= 2
      ) {
        const b0 = j.bytes[0] >>> 0;
        const b1 = j.bytes[1] >>> 0;
        return {
          bytes: [b0, b1],
          source: j.source || 'qrng',
          server_time: j.server_time ?? null,
        };
      }
      throw new Error('qrng_shape_pair_required');
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) =>
        setTimeout(r, backoffMs * (attempt + 1))
      );
    }
  }
}
