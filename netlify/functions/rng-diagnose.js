// Checks Random.org health/quota safely (server-side), plus a tiny draw.
// Open in browser: /.netlify/functions/rng-diagnose
exports.handler = async () => {
  const apiKey = process.env.RANDOM_ORG_API_KEY;
  try {
    // Node 18 has global fetch
    const results = { node: process.version, hasGlobalFetch: typeof fetch === "function" };
    results.keyPresent = !!apiKey;

    if (!apiKey) {
      results.status = "NO_KEY_LOCAL_ONLY";
      results.sample = localBytes(2);
      return ok(results);
    }

    // 1) getUsage (tells you quota)
    const usage = await rpc("getUsage", { apiKey });

    // 2) one small draw (n=2) to prove end-to-end
    let drawSource = "random_org";
    let sample;
    const drawRes = await rpc("generateIntegers", {
      apiKey, n: 2, min: 0, max: 255, replacement: true
    });
    const arr = drawRes?.result?.random?.data;
    if (Array.isArray(arr) && arr.length === 2) {
      sample = arr.map((x) => (x >>> 0) & 0xff);
    } else {
      drawSource = "local_fallback_shape";
      sample = localBytes(2);
    }

    return ok({
      ...results,
      status: "OK",
      usage: usage?.result ?? null,   // bitsLeft, requestsLeft, etc.
      source: drawSource,
      sample,
    });
  } catch (e) {
    console.error("[rng-diagnose] error", e);
    return ok({
      status: "FALLBACK",
      source: "local_error",
      sample: localBytes(2),
      error: e?.message || String(e),
    });
  }
};

// -------- helpers --------
async function rpc(method, params) {
  const body = { jsonrpc: "2.0", method, params, id: Date.now() };
  const res = await fetch("https://api.random.org/json-rpc/4/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data?.error) {
    throw new Error(`RPC ${method} failed: ${res.status} ${res.statusText} ${JSON.stringify(data?.error || {})}`);
  }
  return data;
}
function localBytes(n) { return Array.from(require("crypto").randomBytes(n)); }
function ok(obj) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(obj, null, 2),
  };
}
