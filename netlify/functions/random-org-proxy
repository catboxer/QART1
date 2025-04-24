// netlify/functions/random-org-proxy.js

export async function handler(event, context) {
  // 1️⃣ Grab your key from Netlify env-vars
  const API_KEY = process.env.RANDOM_ORG_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing RANDOM_ORG_API_KEY' }),
    };
  }

  // 2️⃣ Build the JSON-RPC payload
  const payload = {
    jsonrpc: '2.0',
    method: 'generateIntegers',
    params: {
      apiKey: API_KEY,
      n: 1,
      min: 0,
      max: 255,
      replacement: true,
    },
    id: Date.now(),
  };

  try {
    // 3️⃣ Send it to Random.org
    const res = await fetch(
      'https://api.random.org/json-rpc/4/invoke',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { result } = await res.json();
    const byte = result.random.data[0];

    // 4️⃣ Return the byte
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        data: [byte],
        success: true,
      }),
    };
  } catch (err) {
    console.error('Random.org proxy error:', err);
    // 5️⃣ Fallback if anything goes wrong
    const fallback = Math.floor(Math.random() * 256);
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        data: [fallback],
        success: false,
        fallback: true,
      }),
    };
  }
}
