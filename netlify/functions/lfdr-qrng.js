// netlify/functions/lfdr-qrng.js
const fetch = require('node-fetch');

exports.handler = async function (event, context) {
  try {
    // Grab exactly one bit in BINARY format
    const res = await fetch(
      'https://lfdr.de/qrng_api/qrng?length=1&format=BINARY'
    );

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: `LFDR HTTP ${res.status}: ${res.statusText}`,
        }),
      };
    }

    const { qrn, length } = await res.json();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // allow your app to call this from any origin;
        // replace '*' with your domain if you want to lock it down.
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ qrn, length }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
