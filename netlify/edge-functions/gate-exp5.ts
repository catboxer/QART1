/// <reference lib="deno.ns" />

// netlify/edge-functions/gate-exp5.ts
// HTTP Basic Auth gate for /exp5/* -- keeps the live human-facing exp5
// experiment from being publicly reachable while it's not ready for
// participants. Scoped to /exp5 and /exp5/* only; does not affect
// /exp5-prescreen/* or any other experiment path.

export default async (request: Request, context: any) => {
  const user = Deno.env.get("EXP5_BASIC_AUTH_USER");
  const pass = Deno.env.get("EXP5_BASIC_AUTH_PASS");

  // Fail open only if not configured, so a missing env var doesn't 500 the
  // page -- but this means the gate isn't actually protecting anything.
  if (!user || !pass) {
    console.log("gate-exp5: EXP5_BASIC_AUTH_USER/PASS not set -- gate disabled");
    return context.next();
  }

  const expected = "Basic " + btoa(`${user}:${pass}`);
  if (request.headers.get("authorization") === expected) {
    return context.next();
  }

  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="exp5", charset="UTF-8"' },
  });
};
