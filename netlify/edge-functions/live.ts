// netlify/edge-functions/live.ts
// Netlify Edge (Deno). Streams SSE for ~90 seconds with heartbeats.
// It emits ~512 bits/sec so your client has plenty of buffer to drip 5 Hz.

const headers = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*", // fine for same-origin; keeps local tests easy
};

// helper: make <nBits> random bits (temporary; replace with your QRNG later)
function getBits(nBits = 512): string {
  const bytes = new Uint8Array(nBits / 8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(2).padStart(8, "0");
  return out;
}

export default async (req: Request) => {
  // allow override: /live?dur=90000 (caps at 3 minutes)
  const url = new URL(req.url);
  const reqMs = Number(url.searchParams.get("dur")) || 90_000;
  const durationMs = Math.min(Math.max(reqMs, 5_000), 180_000);
  const endAt = Date.now() + durationMs;

  let seq = 1;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (name: string, data: unknown) => {
        controller.enqueue(
          enc.encode(`id: ${seq}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
        );
        seq++;
      };

      // heartbeat every 10s so CDNs never idle you out
      const hb = setInterval(() => send("heartbeat", { t: Date.now() }), 10_000);

      const loop = async () => {
        while (Date.now() < endAt) {
          // push more than enough bits; client will consume at 5 Hz
          send("bits", { ts: Date.now(), source: "local-crypto", bits: getBits(512) });
          await new Promise((r) => setTimeout(r, 1000)); // ~1 chunk/sec
        }
        send("done", { endedAt: Date.now() });
        clearInterval(hb);
        controller.close();
      };

      loop().catch(() => {
        clearInterval(hb);
        controller.close();
      });
    },
  });

  return new Response(stream, { headers });
};
