// netlify/functions/anu-qrng.js
export async function handler(event, context) {
  let byte;

  // 1) Try upstream ANU QRNG
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

  // 2) Build the payload
  let payload;
  if (typeof byte === 'number') {
    // Successful quantum result
    payload = {
      type: 'uint8',
      length: 1,
      data: [byte],
      success: true,
      fallback: false,
    };
  } else {
    // Fallback to pseudorandom
    const randomByte = Math.floor(Math.random() * 256);
    console.warn(
      'ANU proxy pseudorandom fallback, byte=',
      randomByte
    );
    payload = {
      type: 'uint8',
      length: 1,
      data: [randomByte],
      success: false,
      fallback: true,
    };
  }

  // 3) Return uniform 200 response
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(payload),
  };
}
