const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control':
    'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  'Surrogate-Control': 'no-store',
};

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
    };
  }

  try {
    // Add cache-busting timestamp
    const timestamp = Date.now();
    const url = `https://lfdr.de/qrng_api/qrng?length=1&format=BINARY&_=${timestamp}`;
    console.log('LFDR upstream URL:', url);
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          fallback: true,
          error: `LFDR HTTP ${res.status}: ${res.statusText}`,
        }),
      };
    }

    const { qrn } = await res.json();
    const byte = qrn?.charCodeAt(0) ?? 0;

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        data: [byte],
        success: true,
        fallback: false,
        source: 'lfdr',
        raw: qrn,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        fallback: true,
        error: err.message,
      }),
    };
  }
};
