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

// netlify/functions/qrng-proxy.js
var qrng_proxy_exports = {};
__export(qrng_proxy_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(qrng_proxy_exports);
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
  let byte;
  try {
    const upstream = await fetch(
      "https://qrng.anu.edu.au/API/jsonI.php?length=1&type=uint8"
    );
    if (upstream.ok) {
      const text = await upstream.text();
      try {
        const json = JSON.parse(text);
        if (Array.isArray(json.data) && json.data.length > 0) {
          byte = json.data[0];
        } else {
          console.warn("ANU QRNG returned no data array", json);
        }
      } catch (parseErr) {
        console.warn("ANU QRNG JSON parse failed:", parseErr);
      }
    } else {
      console.warn(
        `ANU QRNG HTTP error ${upstream.status}: ${upstream.statusText}`
      );
    }
  } catch (networkErr) {
    console.warn("ANU QRNG network error:", networkErr);
  }
  const payload = typeof byte === "number" ? {
    type: "uint8",
    length: 1,
    data: [byte],
    success: true,
    fallback: false
  } : {
    type: "uint8",
    length: 1,
    data: [Math.floor(Math.random() * 256)],
    success: false,
    fallback: true
  };
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload)
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=qrng-proxy.js.map
