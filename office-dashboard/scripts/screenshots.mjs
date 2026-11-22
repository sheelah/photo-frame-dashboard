// Screenshots of the office dashboard at the frame's 1280x800 (2x), for docs and blog posts.
//
//   npm run screenshots                                   # Today, Calendar, Weather with sample events
//   npm run screenshots -- --real-calendar                # your synced calendar from Cloudflare KV
//   npm run screenshots -- --views today --photos 3       # Today plus the first 3 album photos
//   npm run screenshots -- --out ~/Desktop/shots
//
// Options:
//   --views <list>     comma-separated, from today,calendar,weather (default: all three; "none" to skip)
//   --real-calendar    use the calendar the sync job wrote to KV, instead of made-up events.
//                      Real event titles end up in the images, so check them before sharing.
//   --photos <n>       also capture n Photos-view shots, tapping to advance between them. Runs the
//                      Worker with `wrangler dev`, which reads FLICKR_API_KEY and ACCESS_TOKEN from .dev.vars.
//   --out <dir>        where PNGs go (default: screenshots/, gitignored)
//
// It opens the built dist/ (run `vite build` first; the npm script does) in your installed Google
// Chrome, headless. The page's API calls are answered here: weather is fetched live from Open-Meteo
// with the same query as src/worker.js, using LAT/LON/TZ from wrangler.jsonc; the calendar is sample
// events or the KV copy. Times on screen are the real current time in TZ.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const VIEWS = ['today', 'calendar', 'weather'];
const DEV_PORT = 8799;

// ------------------------------------------------------------------ options

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const views = (opt('--views') || VIEWS.join(',')).split(',').filter((v) => v && v !== 'none');
for (const v of views) if (!VIEWS.includes(v)) fail(`unknown view "${v}" (choose from ${VIEWS.join(', ')})`);
const realCalendar = args.includes('--real-calendar');
const photoCount = Number(opt('--photos') || 0);
const out = path.resolve(opt('--out') || path.join(ROOT, 'screenshots'));

function fail(msg) { console.error(`screenshots: ${msg}`); process.exit(1); }

// ------------------------------------------------------------------ config

// wrangler.jsonc allows comments and trailing commas; strip them before JSON.parse. Comments here
// are whole-line or trailing after whitespace, and no string value contains " //".
function readConfig() {
  const file = path.join(ROOT, 'wrangler.jsonc');
  if (!fs.existsSync(file)) fail('wrangler.jsonc not found (copy wrangler.example.jsonc and fill it in)');
  const text = fs.readFileSync(file, 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+\/\/[^\n]*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(text);
}
const config = readConfig();
const { LAT, LON, TZ } = config.vars || {};
if (!LAT || !LON || !TZ || /YOUR_/.test(LAT + LON + TZ)) fail('set LAT, LON and TZ in wrangler.jsonc');

// ------------------------------------------------------------------ data

async function fetchWeather() {
  const q = new URLSearchParams({
    latitude: LAT, longitude: LON, timezone: TZ,
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch', forecast_days: '6',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
  });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
      if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
      return { updated: Date.now(), ...(await res.json()) };
    } catch (e) {
      if (attempt === 3) return fail(`weather: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function kvCalendar() {
  const ns = (config.kv_namespaces || []).find((n) => n.binding === 'CALENDAR');
  if (!ns || /YOUR_/.test(ns.id)) fail('no CALENDAR KV namespace in wrangler.jsonc');
  const raw = execFileSync('npx', ['wrangler', 'kv', 'key', 'get', 'calendar', '--namespace-id', ns.id, '--remote'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  try { return JSON.parse(raw); } catch (e) { return fail('KV has no synced calendar yet (run the sync job)'); }
}

// Made-up week relative to today, so screenshots don't show anyone's real schedule. Process TZ is
// set to the dashboard's TZ below, so these local times match what the page renders.
function sampleCalendar() {
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const at = (d, h, m = 0) => { const t = new Date(day0); t.setDate(t.getDate() + d); t.setHours(h, m, 0, 0); return +t; };
  const key = (d) => { const t = new Date(at(d, 0)); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const ev = (d, h1, m1, h2, m2, title, location) => ({ title, start: at(d, h1, m1), end: at(d, h2, m2), allDay: false, ...(location ? { location } : {}) });
  return {
    updated: Date.now(),
    events: [
      ev(0, 9, 0, 9, 30, 'Team standup'),
      ev(0, 11, 0, 12, 0, 'Design review', 'Zoom'),
      ev(0, 13, 0, 14, 0, 'Lunch with Sam', 'Moxie Bread Co.'),
      ev(0, 15, 30, 16, 0, '1:1 with Priya'),
      ev(0, 16, 30, 17, 30, 'Blog post editing'),
      ev(1, 9, 0, 10, 30, 'Farmers market'),
      ev(1, 14, 0, 16, 0, 'Bike tune-up', 'Full Cycle'),
      ev(2, 10, 0, 11, 0, 'Brunch with Alex'),
      ev(3, 9, 0, 9, 30, 'Team standup'),
      ev(3, 10, 0, 11, 0, 'Sprint planning', 'Zoom'),
      ev(3, 14, 0, 15, 0, 'Dentist'),
      ev(4, 9, 0, 9, 30, 'Team standup'),
      ev(4, 12, 0, 13, 0, 'Lunch & learn: WebViews', 'Zoom'),
      ev(4, 16, 0, 17, 0, 'Pottery class'),
      ev(5, 9, 0, 9, 30, 'Team standup'),
      ev(5, 13, 0, 14, 30, 'Pack for trip'),
      { title: 'Day off', allDay: true, date: key(6), endDate: key(7) },
      ev(6, 15, 0, 20, 0, 'Dinner with family'),
    ],
  };
}

// ------------------------------------------------------------------ servers

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function serveDist() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      const f = path.join(DIST, p);
      if (!f.startsWith(DIST + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(server));
  });
}

// `wrangler dev` for the Photos view: /api/photos needs the Flickr key, and /img/ proxies images.
async function startWorker() {
  const vars = path.join(ROOT, '.dev.vars');
  if (!fs.existsSync(vars)) fail('--photos needs .dev.vars with FLICKR_API_KEY and ACCESS_TOKEN');
  const token = /^ACCESS_TOKEN=["']?([^"'\n]*)/m.exec(fs.readFileSync(vars, 'utf8'))?.[1];
  if (!token) fail('ACCESS_TOKEN missing from .dev.vars');
  const child = spawn('npx', ['wrangler', 'dev', '--port', String(DEV_PORT), '--ip', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', detached: true });
  const base = `http://127.0.0.1:${DEV_PORT}`;
  for (let i = 0; i < 60; i++) {
    try { await fetch(base); return { child, base, token }; } catch (e) { await new Promise((r) => setTimeout(r, 1000)); }
  }
  process.kill(-child.pid);
  return fail('wrangler dev did not start within 60s');
}

// ------------------------------------------------------------------ capture

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) fail('dist/ is missing; run `npm run build` first');
  if (!views.length && !photoCount) fail('nothing to capture');
  fs.mkdirSync(out, { recursive: true });

  const weather = await fetchWeather();
  const calendar = realCalendar ? kvCalendar() : sampleCalendar();
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, timezoneId: TZ });
  await ctx.route('**/api/weather*', (r) => r.fulfill({ json: weather }));
  await ctx.route('**/api/calendar*', (r) => r.fulfill({ json: calendar }));
  const saved = [];

  if (views.length) {
    const server = await serveDist();
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await ctx.newPage();
    await page.route('**/api/photos*', (r) => r.fulfill({ json: { updated: Date.now(), album: '', photos: [] } }));
    for (const view of views) {
      await page.goto(`${base}/#${view}`);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800);
      const file = path.join(out, `office-${view}.png`);
      await page.screenshot({ path: file });
      saved.push(file);
    }
    await page.close();
    server.close();
  }

  if (photoCount) {
    const { child, base, token } = await startWorker();
    try {
      const page = await ctx.newPage();
      await page.goto(`${base}/?k=${encodeURIComponent(token)}#photos`);
      for (let i = 1; i <= photoCount; i++) {
        await page.waitForLoadState('networkidle');
        await page.waitForFunction(() => [...document.querySelectorAll('#view-photos img')].some((im) => im.complete && im.naturalWidth > 0), null, { timeout: 30000 });
        await page.waitForTimeout(2500); // let the crossfade finish
        const file = path.join(out, `office-photos-${i}.png`);
        await page.screenshot({ path: file });
        saved.push(file);
        await page.mouse.click(700, 400); // a tap advances to the next photo
      }
    } finally {
      process.kill(-child.pid);
    }
  }

  await browser.close();
  for (const f of saved) console.log(f);
}

// Date math for the sample calendar runs in this process, so match the dashboard's time zone.
process.env.TZ = TZ;
main().catch((e) => fail(e.stack || String(e)));
