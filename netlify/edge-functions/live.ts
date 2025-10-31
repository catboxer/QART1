/// <reference lib="deno.ns" />
/// <reference lib="deno.unstable" />

// netlify/edge-functions/live.ts
// Netlify Edge (Deno). Streams SSE for ~10 minutes with heartbeats.

const headers = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*",
};

const OUTSHIFT_TIMEOUT_MS = 800;
const _LFDR_TIMEOUT_MS = 1000;

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

async function _tryOutshift(nBits: number): Promise<QRNGResult | null> {
  const apiKey = Deno.env.get("QRNG_OUTSHIFT_API_KEY");
  if (!apiKey) {
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

    // Detect 429 rate limit specifically
    if (res.status === 429) {
      return null;
    }

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
  } catch {
    return null;
  }
}

async function _tryLFDR(nBits: number): Promise<QRNGResult | null> {
  const nBytes = Math.ceil(nBits / 8);
  try {
    const res = await fetchWithTimeout(
      `https://lfdr.de/qrng_api/qrng?length=${nBytes}&format=HEX`,
      {},
      _LFDR_TIMEOUT_MS
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (typeof j?.qrn !== "string") throw new Error("Bad response");

    const hex = j.qrn.trim();
    let bits = "";
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.slice(i, i + 2), 16);
      if (isNaN(byte)) throw new Error("Hex parse error");
      bits += byte.toString(2).padStart(8, "0");
    }
    return { source: "lfdr", bits: bits.slice(0, nBits) };
  } catch {
    return null;
  }
}


async function getQRNGBits(nBits = 512): Promise<QRNGResult> {
  // Try Outshift first (true quantum)
  const outshift = await _tryOutshift(nBits);
  if (outshift) return outshift;

  // Fall back to LFDR (validated quantum source - positional bias fixed as of 2025-10-27)
  const lfdr = await _tryLFDR(nBits);
  if (lfdr) return lfdr;

  // Both providers exhausted - cannot continue
  throw new Error("Cannot complete: Out of QRNG quota. Both Outshift and LFDR are unavailable. Please try again tomorrow or email h@whatthequark.com to schedule a session.");
}

export default (req: Request): Response => {
  const url = new URL(req.url);
  const reqMs = Number(url.searchParams.get("dur")) || 600_000;
  const durationMs = Math.min(Math.max(reqMs, 5_000), 600_000);
  const endAt = Date.now() + durationMs;

  let seq = 1;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (name: string, data: unknown) => {
        controller.enqueue(
          enc.encode(
            `id: ${seq}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`
          )
        );
        seq++;
      };

      const hb = setInterval(
        () => send("heartbeat", { t: Date.now() }),
        10_000
      );

      const loop = async () => {
        // Initial warmup: pull 300 bytes (2400 bits) to build buffer
        try {
          const warmup = await getQRNGBits(2400);
          send("bits", {
            ts: Date.now(),
            source: warmup.source,
            bits: warmup.bits,
          });
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : `${e}`;
          const userMessage = errorMsg.includes("quota")
            ? "Ran out of QRNG quota. Please try again tomorrow or schedule a session by emailing h@whatthequark.com"
            : "Quantum sources unavailable. Please try again later.";
          send("error", {
            message: userMessage,
            detail: errorMsg,
            ts: Date.now(),
          });
          clearInterval(hb);
          controller.close();
          return;
        }

        // Then pull 145 bytes (1160 bits) every 15 seconds
        // 40 chunks × 1160 bits = 46,400 bits + 2,400 warmup = 48,800 bits total
        while (Date.now() < endAt) {
          await new Promise((r) => setTimeout(r, 15000));

          try {
            const result = await getQRNGBits(1160); // 145 bytes
            send("bits", {
              ts: Date.now(),
              source: result.source,
              bits: result.bits,
            });
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : `${e}`;
            const userMessage = errorMsg.includes("quota")
              ? "Ran out of QRNG quota. Please try again tomorrow or schedule a session by emailing h@whatthequark.com"
              : "Quantum sources unavailable. Please try again later.";
            send("error", {
              message: userMessage,
              detail: errorMsg,
              ts: Date.now(),
            });
            clearInterval(hb);
            controller.close();
            return;
          }
        }
        send("done", { endedAt: Date.now() });
        clearInterval(hb);
        controller.close();
      };

      loop().catch((e) => {
        send("error", {
          message: "Stream error",
          detail: e instanceof Error ? e.message : `${e}`,
          ts: Date.now(),
        });
        clearInterval(hb);
        controller.close();
      });
    },
  });

  return new Response(stream, { headers });
};