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

  let byte;

  try {
    const upstream = await fetch(
      'https://qrng.anu.edu.au/API/jsonI.php?length=1&type=uint8'
    );

    if (upstream.ok) {
      const text = await upstream.text();
      try {
        const json = JSON.parse(text);
        if (Array.isArray(json.data) && json.data.length > 0) {
          byte = json.data[0];
        } else {
          console.warn('ANU QRNG returned no data array', json);
        }
      } catch (parseErr) {
        console.warn('ANU QRNG JSON parse failed:', parseErr);
      }
    } else {
      console.warn(
        `ANU QRNG HTTP error ${upstream.status}: ${upstream.statusText}`
      );
    }
  } catch (networkErr) {
    console.warn('ANU QRNG network error:', networkErr);
  }

  const payload =
    typeof byte === 'number'
      ? {
          type: 'uint8',
          length: 1,
          data: [byte],
          success: true,
          fallback: false,
        }
      : {
          type: 'uint8',
          length: 1,
          data: [Math.floor(Math.random() * 256)],
          success: false,
          fallback: true,
        };

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload),
  };
}
