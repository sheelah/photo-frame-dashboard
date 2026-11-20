// Office dashboard Worker: token gate, the calendar (read from KV; the Linux box sync job writes
// it, see sync/), the Open-Meteo weather API, one public Flickr album, and the static page from ./dist.

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
      else if (url.pathname === '/api/photos') response = await photos(env);
      else if (url.pathname.startsWith('/img/')) response = await photoImage(url.pathname.slice(5));
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

// ------------------------------------------------------------------ photos

// One public Flickr album (FLICKR_USER_ID / FLICKR_ALBUM_ID vars, FLICKR_API_KEY secret), as
// { updated, album, photos: [{ src, w, h, caption, taken }] }. 1600px (h) suits a 1280x800 frame
// without decoding 2048px images on 1 GB of RAM; fall back to 2048 (k), then 1024 (l).
//
// `src` points at /img/ on this Worker, not at live.staticflickr.com: Flickr's CloudFront
// certificate chains to Amazon Root CA 1 / Starfield Services Root G2, which Android 6 doesn't
// trust, so the frame's WebView refuses images loaded from Flickr directly.
const SIZES = ['h', 'k', 'l'];
const FLICKR_IMG = /^https:\/\/live\.staticflickr\.com\/(\d+\/\d+_[0-9a-f]+_[a-z]\.jpg)$/;

async function photos(env) {
  if (!env.FLICKR_API_KEY || !env.FLICKR_ALBUM_ID) return json({ error: 'Flickr album not configured' }, 503);
  const q = new URLSearchParams({
    method: 'flickr.photosets.getPhotos',
    api_key: env.FLICKR_API_KEY,
    photoset_id: env.FLICKR_ALBUM_ID,
    extras: SIZES.map((s) => `url_${s}`).join(',') + ',date_taken',
    privacy_filter: '1',
    media: 'photos',
    per_page: '500',
    format: 'json',
    nojsoncallback: '1',
  });
  if (env.FLICKR_USER_ID) q.set('user_id', env.FLICKR_USER_ID);
  const res = await fetch(`https://api.flickr.com/services/rest/?${q}`, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error(`flickr returned ${res.status}`);
  const data = await res.json();
  if (data.stat !== 'ok') throw new Error(`flickr: ${data.message || 'request failed'}`);

  const list = [];
  for (const p of data.photoset.photo || []) {
    const s = SIZES.find((size) => p[`url_${size}`]);
    const m = s && FLICKR_IMG.exec(p[`url_${s}`]);
    if (!m) continue;
    list.push({
      src: `/img/${m[1]}`,
      w: Number(p[`width_${s}`]) || 0,
      h: Number(p[`height_${s}`]) || 0,
      caption: p.title || '',
      taken: p.datetaken || null,
    });
  }
  return json({ updated: Date.now(), album: data.photoset.title || '', photos: list }, 200, 3600);
}

// /img/<server>/<id>_<secret>_<size>.jpg → the same path on live.staticflickr.com. Only that shape
// is accepted, so this can't be used to fetch anything else. Images never change at a given URL, so
// both Cloudflare and the WebView may cache them for a long time.
async function photoImage(path) {
  if (!/^\d+\/\d+_[0-9a-f]+_[a-z]\.jpg$/.test(path)) return new Response('Not found', { status: 404 });
  const res = await fetch(`https://live.staticflickr.com/${path}`, { cf: { cacheTtl: 30 * 86400, cacheEverything: true } });
  if (!res.ok) return new Response(`flickr image returned ${res.status}`, { status: 502 });
  return new Response(res.body, {
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'private, max-age=604800' },
  });
}
