const fetch = require('node-fetch');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
    };
  }

  try {
    const res = await fetch(
      'https://lfdr.de/qrng_api/qrng?length=1&format=BINARY'
    );

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: `LFDR HTTP ${res.status}: ${res.statusText}`,
        }),
      };
    }

    const { qrn, length } = await res.json();
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ qrn, length }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
