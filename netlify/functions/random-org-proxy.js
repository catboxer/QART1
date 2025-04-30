export async function handler(event, context) {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
    };
  }

  const API_KEY = process.env.RANDOM_ORG_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing RANDOM_ORG_API_KEY' }),
    };
  }

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

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        data: [byte],
        success: true,
      }),
    };
  } catch (err) {
    console.error('Random.org proxy error:', err);
    const fallback = Math.floor(Math.random() * 256);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        data: [fallback],
        success: false,
        fallback: true,
      }),
    };
  }
}
