/// <reference lib="deno.ns" />
/// <reference lib="deno.unstable" />

// netlify/edge-functions/live.ts
// Netlify Edge (Deno). Streams SSE with real QRNG for bit-based consumption.
// Delivers 300 bits warmup + 150 bits every 15 seconds.

const headers = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*",
};

const OUTSHIFT_TIMEOUT_MS = 800;
const ANU_TIMEOUT_MS = 1500;

interface QRNGResult {
  source: string;
  bits: string;
}

async function fetchWithTimeout(
  url: string,
  opts: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Fetch from Outshift QRNG
async function tryOutshift(nBits: number): Promise<QRNGResult | null> {
  const apiKey = Deno.env.get("QRNG_OUTSHIFT_API_KEY");
  if (!apiKey) {
    console.log("[live] Outshift: No API key");
    return null;
  }

  const nBytes = Math.ceil(nBits / 8);
  try {
    const res = await fetchWithTimeout(
      "https://api.qrng.outshift.com/api/v1/random_numbers",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "x-id-api-key": apiKey,
        },
        body: JSON.stringify({
          encoding: "base64",
          format: "decimal",
          formats: ["decimal"],
          bits_per_block: 8,
          number_of_blocks: nBytes,
        }),
      },
      OUTSHIFT_TIMEOUT_MS
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();

    if (Array.isArray(j?.random_numbers)) {
      const bytes: number[] = [];
      for (const row of j.random_numbers.slice(0, nBytes)) {
        if (!row?.decimal) continue;
        const txt = atob(row.decimal);
        const val = parseInt(txt, 10);
        if (!isNaN(val)) bytes.push(val & 0xff);
      }
      if (bytes.length < nBytes)
        throw new Error(`Short: got ${bytes.length}, need ${nBytes}`);

      let bits = "";
      for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
      return { source: "outshift", bits: bits.slice(0, nBits) };
    }
    throw new Error("Bad response shape");
  } catch (e) {
    console.log(`[live] Outshift failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// Fetch from ANU QRNG
async function tryANU(nBits: number): Promise<QRNGResult | null> {
  const nBytes = Math.ceil(nBits / 8);
  try {
    const res = await fetchWithTimeout(
      `https://qrng.anu.edu.au/API/jsonI.php?length=${nBytes}&type=uint8`,
      {},
      ANU_TIMEOUT_MS
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();

    if (!Array.isArray(j?.data)) throw new Error("Bad response shape");
    if (j.data.length < nBytes)
      throw new Error(`Short: got ${j.data.length}, need ${nBytes}`);

    const bytes = j.data.slice(0, nBytes).map((x: number) => (x >>> 0) & 255);
    let bits = "";
    for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
    return { source: "anu", bits: bits.slice(0, nBits) };
  } catch (e) {
    console.log(`[live] ANU failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// Fallback chain: Outshift → ANU
async function getQRNGBits(nBits: number): Promise<QRNGResult> {
  const outshift = await tryOutshift(nBits);
  if (outshift) return outshift;

  const anu = await tryANU(nBits);
  if (anu) return anu;

  throw new Error("All QRNG providers exhausted");
}

export default async (req: Request) => {
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
        try {
          // Initial warmup: 300 bits
          const warmup = await getQRNGBits(300);
          send("bits", { ts: Date.now(), source: warmup.source, bits: warmup.bits });
        } catch (err) {
          console.error("[live] QRNG warmup failed:", err);
          send("error", { message: String(err) });
        }

        // Then 150 bits every 15 seconds (40 requests × 150 = 6,000 bits total)
        while (Date.now() < endAt) {
          await new Promise((r) => setTimeout(r, 15000)); // 15 second intervals
          try {
            const result = await getQRNGBits(150);
            send("bits", { ts: Date.now(), source: result.source, bits: result.bits });
          } catch (err) {
            console.error("[live] QRNG failed:", err);
            send("error", { message: String(err) });
          }
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
