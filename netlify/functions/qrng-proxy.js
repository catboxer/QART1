export async function handler(event, context) {
  // Fetch as text so we can catch parse errors
  let text;
  try {
    const upstream = await fetch(
      'https://qrng.anu.edu.au/API/jsonI.php?length=1&type=uint8'
    );
    text = await upstream.text();
  } catch (err) {
    console.error('QRNG proxy network error:', err);
    text = null;
  }

  let payload;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (err) {
      console.warn('QRNG JSON parse failed, falling back:', err);
    }
  }

  // If parsing failed or fetch errored, do pseudorandom fallback
  if (!payload || !Array.isArray(payload.data)) {
    const randomByte = Math.floor(Math.random() * 256);
    payload = {
      type: 'uint8',
      length: 1,
      data: [randomByte],
      success: false,
      fallback: true,
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(payload),
  };
}
