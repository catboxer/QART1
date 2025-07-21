var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/random-org-proxy.js
var random_org_proxy_exports = {};
__export(random_org_proxy_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(random_org_proxy_exports);
async function handler(event, context) {
  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: CORS_HEADERS
    };
  }
  const API_KEY = process.env.RANDOM_ORG_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Missing RANDOM_ORG_API_KEY" })
    };
  }
  const payload = {
    jsonrpc: "2.0",
    method: "generateIntegers",
    params: {
      apiKey: API_KEY,
      n: 1,
      min: 0,
      max: 255,
      replacement: true
    },
    id: Date.now()
  };
  try {
    const res = await fetch(
      "https://api.random.org/json-rpc/4/invoke",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    if (!res.ok)
      throw new Error(`HTTP ${res.status}`);
    const { result } = await res.json();
    const byte = result.random.data[0];
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        data: [byte],
        success: true
      })
    };
  } catch (err) {
    console.error("Random.org proxy error:", err);
    const fallback = Math.floor(Math.random() * 256);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        data: [fallback],
        success: false,
        fallback: true
      })
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=random-org-proxy.js.map
