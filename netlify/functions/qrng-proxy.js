// A simple Netlify Function that adds CORS headers
export async function handler(event, context) {
  try {
    const upstream = await fetch(
      'https://qrng.anu.edu.au/API/jsonI.php?length=1&type=uint8'
    );
    const data = await upstream.json();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // allow any site to call this
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('QRNG proxy error:', err);
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'QRNG fetch failed' }),
    };
  }
}
