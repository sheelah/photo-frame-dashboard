// Office dashboard Worker: token gate, the calendar (read from KV; the Linux box sync job writes
// it, see sync/), the Open-Meteo weather API, and the static page from ./dist.

const COOKIE = 'k';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const fromQuery = url.searchParams.get(COOKIE);
    const token = fromQuery || readCookie(request, COOKIE);
    if (!(await tokenOk(token, env.ACCESS_TOKEN))) return new Response('Not found', { status: 404 });

    let response;
    try {
      if (url.pathname === '/api/calendar') response = await calendar(env);
      else if (url.pathname === '/api/weather') response = await weather(env);
      else response = await env.ASSETS.fetch(request);
    } catch (err) {
      response = json({ error: String(err && err.message || err) }, 502);
    }

    // Asset responses have immutable headers; copy before changing them.
    response = new Response(response.body, response);
    // The kiosk loads the page with ?k=; later asset and API requests carry the cookie instead.
    if (fromQuery) {
      response.headers.append('Set-Cookie',
        `${COOKIE}=${encodeURIComponent(fromQuery)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`);
    }
    response.headers.set('X-Robots-Tag', 'noindex');
    return response;
  },
};

async function tokenOk(given, expected) {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const a = enc.encode(given), b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `private, max-age=${maxAge}` },
  });
}

// ------------------------------------------------------------------ calendar

// { updated, events } as written by sync/sync-calendar.js. The page flags it stale by `updated`.
async function calendar(env) {
  const data = await env.CALENDAR.get('calendar', 'json');
  if (!data) return json({ error: 'calendar not synced yet' }, 503);
  return json(data, 200, 60);
}

// ------------------------------------------------------------------ weather

async function weather(env) {
  const q = new URLSearchParams({
    latitude: env.LAT,
    longitude: env.LON,
    timezone: env.TZ,
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    forecast_days: '6',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { cf: { cacheTtl: 600, cacheEverything: true } });
  if (!res.ok) throw new Error(`weather returned ${res.status}`);
  const data = await res.json();
  return json({ updated: Date.now(), ...data }, 200, 300);
}
