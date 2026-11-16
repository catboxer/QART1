// netlify/lib/guard.js
// Shared protection for public Netlify functions that spend paid API quota
// (random-number providers) or check payment codes.
//
//  - sameSite(event): the request must come from a page on this same site (or localhost).
//    Browsers always send an Origin or Referer header; it must name the host the function
//    is being served from. This stops other websites from using our endpoints from their
//    visitors' browsers. It does NOT stop someone calling the URL directly with a script,
//    because a script can fake these headers.
//  - rateLimited(event, name, max, windowMs): at most `max` calls per client IP per window.
//    The counters live in memory, so they are per running function instance and reset when
//    an instance is recycled. This is best-effort protection against floods and guessing,
//    not a hard guarantee.
//
// guard(event, name, { max, windowMs }) -> null if the request may proceed, otherwise
// { statusCode, body } to return.

const hits = new Map(); // `${name}|${ip}` -> [timestamps]

function clientIp(event) {
  const h = event.headers || {};
  return (
    h['x-nf-client-connection-ip'] ||
    (h['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  );
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function sameSite(event) {
  const h = event.headers || {};
  const own = (h['x-forwarded-host'] || h.host || '').toLowerCase();
  const seen = [h.origin, h.referer, h.referrer]
    .filter(Boolean)
    .map((u) => (hostOf(u) || '').toLowerCase());
  if (!seen.length) return false;
  return seen.some((s) => s === own || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(s));
}

function rateLimited(event, name, max, windowMs) {
  const key = `${name}|${clientIp(event)}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  // keep the map from growing without bound
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    }
  }
  return recent.length > max;
}

function guard(event, name, { max = 120, windowMs = 60 * 1000, requireSameSite = true } = {}) {
  if (requireSameSite && !sameSite(event)) {
    return { statusCode: 403, body: JSON.stringify({ success: false, error: 'forbidden' }) };
  }
  if (rateLimited(event, name, max, windowMs)) {
    return { statusCode: 429, body: JSON.stringify({ success: false, error: 'rate_limited' }) };
  }
  return null;
}

module.exports = { guard, sameSite, rateLimited };
