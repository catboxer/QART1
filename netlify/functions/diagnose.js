exports.handler = async () => {
  const mask = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : null);

  const randomOrg = process.env.RANDOM_ORG_API_KEY || "";
  const outshift = process.env.QRNG_OUTSHIFT_API_KEY || "";

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      node: process.version,
      hasGlobalFetch: typeof fetch === "function",
      keys: {
        RANDOM_ORG_API_KEY: { present: !!randomOrg, preview: mask(randomOrg) },
        QRNG_OUTSHIFT_API_KEY: { present: !!outshift, preview: mask(outshift) },
      }
    }, null, 2),
  };
};
