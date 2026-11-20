// Office dashboard: a sidebar of views (Today, Calendar, Weather, Photos) over the same data —
// weather (Open-Meteo via /api/weather), the synced calendar (/api/calendar) and a Flickr album
// (/api/photos).
import { icon, weatherInfo } from './icons.js';

const $ = (id) => document.getElementById(id);
const MIN = 60000;
const HOUR = 60 * MIN;
const STALE_AFTER = 20 * MIN;
const IDLE_HOME = 2 * MIN;  // untouched this long on another view → back to Today
const VIEWS = ['today', 'calendar', 'weather', 'photos'];

// The kiosk opens /?k=<token>; pass it on API calls too, in case the cookie is lost.
const params = new URLSearchParams(location.search);
const token = params.get('k');
const api = (path) => token ? `${path}?k=${encodeURIComponent(token)}` : path;

const state = {
  calendar: load('calendar'),
  weather: load('weather'),
  photos: load('photos'),
  ok: { calendar: 0, weather: 0, photos: 0 },
  failed: {},
};

// ------------------------------------------------------------------ helpers

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function startOfDay(t) {
  const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime();
}
function addDays(t, n) {
  const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime();
}
function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtTime(t, withAmPm = true) {
  const d = new Date(t);
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return withAmPm ? `${h}:${m} ${d.getHours() < 12 ? 'AM' : 'PM'}` : `${h}:${m}`;
}
function fmtRange(ev) {
  const sameHalf = new Date(ev.start).getHours() < 12 === new Date(ev.end).getHours() < 12;
  return `${fmtTime(ev.start, !sameHalf)} – ${fmtTime(ev.end)}`;
}
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ------------------------------------------------------------------ colour themes
// Same palettes as Home HQ (css/style.css). The saved theme is the day choice; from sunset to
// sunrise Graphite is shown on top unless "Graphite at night" is off. index.html applies the same
// rule before first paint.

const THEMES = [
  { id: 'paper', name: 'Paper', sw: ['#F2EEE6', '#111111'] },
  { id: 'heather', name: 'Heather', sw: ['#ECE8F1', '#1E1530'] },
  { id: 'harbor', name: 'Harbor', sw: ['#E5EAF0', '#0D1C33'] },
  { id: 'clay', name: 'Clay', sw: ['#F1E3D6', '#2B150D'] },
  { id: 'graphite', name: 'Graphite', sw: ['#161719', '#EDE8DE'] },
];
function loadRaw(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
function saveRaw(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
let chosenTheme = loadRaw('office.theme', 'paper');
if (!THEMES.some((t) => t.id === chosenTheme)) chosenTheme = 'paper';
let autoNight = loadRaw('office.nightTheme', '1') === '1';

// Sunrise/sunset come from the weather feed's daily list, as local "YYYY-MM-DDTHH:MM" strings in the
// Worker's TZ. Today's entry if present; otherwise the nearest day's times (they shift by a minute
// or two a day), and with no weather cached at all, 6 PM – 7 AM. index.html repeats this rule.
const hm = (s) => (typeof s === 'string' && s.length >= 16 ? Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)) : null);
function sunTimes(d = new Date()) {
  const daily = state.weather && state.weather.daily;
  if (daily && daily.time && daily.sunrise && daily.sunset && daily.time.length) {
    let i = daily.time.indexOf(dayKey(d));
    if (i < 0) i = daily.time[0] > dayKey(d) ? 0 : daily.time.length - 1;
    const rise = hm(daily.sunrise[i]), set = hm(daily.sunset[i]);
    if (rise != null && set != null) return { rise, set };
  }
  return { rise: 7 * 60, set: 18 * 60 };
}
function isNight(d = new Date()) {
  const { rise, set } = sunTimes(d), m = d.getHours() * 60 + d.getMinutes();
  return m < rise || m >= set;
}
const fmtMin = (m) => fmtTime(new Date(2000, 0, 1, Math.floor(m / 60), m % 60));
function applyTheme() {
  const id = autoNight && isNight() ? 'graphite' : chosenTheme;
  const root = document.documentElement;
  if ((root.getAttribute('data-theme') || 'paper') === id) return;
  root.classList.add('theme-anim');
  if (id === 'paper') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--paper').trim());
  clearTimeout(applyTheme.t);
  applyTheme.t = setTimeout(() => root.classList.remove('theme-anim'), 400);
}
function setTheme(id) { chosenTheme = id; saveRaw('office.theme', id); applyTheme(); }
function setAutoNight(on) { autoNight = on; saveRaw('office.nightTheme', on ? '1' : '0'); applyTheme(); }

// ------------------------------------------------------------------ clock

function renderClock() {
  const n = new Date();
  $('time').textContent = fmtTime(n, false);
  $('ampm').textContent = n.getHours() < 12 ? 'AM' : 'PM';
  $('weekday').textContent = WEEKDAY[n.getDay()];
  $('date').textContent = `${MONTH[n.getMonth()]} ${n.getDate()}`;
  $('railClock').innerHTML = `<b>${fmtTime(n, false)}</b><span>${n.getHours() < 12 ? 'AM' : 'PM'}</span>`;
  applyTheme();
}

// ------------------------------------------------------------------ weather

function renderWeather() {
  const W = state.weather;
  if (!W || !W.current) { $('weather').innerHTML = ''; return; }
  const c = W.current, d = W.daily, h = W.hourly;
  const now = weatherInfo(c.weather_code, c.is_day);

  // Hourly: the next 7 hours starting with the current one.
  const nowMs = Date.now();
  let first = h.time.findIndex((t) => new Date(t).getTime() + HOUR > nowMs);
  if (first < 0) first = 0;
  const hours = [];
  for (let i = first; i < Math.min(first + 7, h.time.length); i++) {
    const info = weatherInfo(h.weather_code[i], h.is_day[i]);
    const p = h.precipitation_probability[i];
    const label = i === first ? 'NOW' : fmtTime(h.time[i]).replace(':00 ', '').replace('AM', 'A').replace('PM', 'P');
    hours.push(`<div><span class="h">${label}</span>${icon(info.icon, 28)}<span class="t">${Math.round(h.temperature_2m[i])}°</span><span class="p">${p >= 20 ? p + '%' : ''}</span></div>`);
  }

  // Daily: today plus the next 4 days.
  const days = [];
  for (let i = 0; i < Math.min(5, d.time.length); i++) {
    const info = weatherInfo(d.weather_code[i], 1);
    const date = new Date(`${d.time[i]}T12:00`);
    const p = d.precipitation_probability_max[i];
    days.push(`<div class="w-day"><span class="d">${i === 0 ? 'Today' : WEEKDAY[date.getDay()].slice(0, 3)}</span>${icon(info.icon, 30)}<span class="p">${p >= 20 ? p + '%' : ''}</span><span class="hi">${Math.round(d.temperature_2m_max[i])}°</span><span class="lo">${Math.round(d.temperature_2m_min[i])}°</span></div>`);
  }

  $('weather').innerHTML =
    `<div class="w-now">${icon(now.icon, 84)}<span class="num w-temp">${Math.round(c.temperature_2m)}°</span>` +
      `<div class="w-desc"><span class="cond">${esc(now.label)}</span>` +
      `<span class="hl">H ${Math.round(d.temperature_2m_max[0])}° · L ${Math.round(d.temperature_2m_min[0])}°</span>` +
      `<span class="hl">Feels ${Math.round(c.apparent_temperature)}° · Wind ${Math.round(c.wind_speed_10m)} mph</span></div></div>` +
    `<div class="w-note serif">${esc(weatherNote(W))}</div>` +
    `<div class="w-hours">${hours.join('')}</div>` +
    `<div class="w-days">${days.join('')}</div>`;
}

// One line of advice from the next 12 hours.
function weatherNote(W) {
  const h = W.hourly, nowMs = Date.now();
  for (let i = 0; i < h.time.length; i++) {
    const t = new Date(h.time[i]).getTime();
    if (t + HOUR <= nowMs) continue;
    if (t > nowMs + 12 * HOUR) break;
    const code = h.weather_code[i];
    const wet = h.precipitation_probability[i] >= 50 && code >= 51;
    if (wet) {
      const snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
      const when = t <= nowMs ? 'now' : `from ${fmtTime(t).replace(':00', '')}`;
      return `${snow ? 'Snow' : 'Rain'} likely ${when}.`;
    }
  }
  const hi = W.daily.temperature_2m_max[0];
  if (hi >= 90) return 'Hot one today.';
  if (hi <= 32) return 'Below freezing today.';
  return 'Dry for the next 12 hours.';
}

// ------------------------------------------------------------------ calendar

function eventsOn(dayStart) {
  const events = (state.calendar && state.calendar.events) || [];
  const dayEnd = addDays(dayStart, 1);
  const key = dayKey(dayStart);
  const allDay = events.filter((e) => e.allDay && e.date <= key && key < e.endDate);
  const timed = events.filter((e) => !e.allDay && e.start < dayEnd && e.end > dayStart);
  return { allDay, timed };
}

function renderNext() {
  const events = ((state.calendar && state.calendar.events) || []).filter((e) => !e.allDay);
  const nowMs = Date.now();
  const current = events.filter((e) => e.start <= nowMs && e.end > nowMs);
  const upcoming = events.filter((e) => e.start > nowMs);
  const next = upcoming[0];
  const el = $('next');

  // Prefer the next meeting if it starts within 10 minutes; otherwise show what's on now.
  let ev, mode;
  if (next && next.start - nowMs <= 10 * MIN) { ev = next; mode = 'soon'; }
  else if (current.length) { ev = current[current.length - 1]; mode = 'now'; }
  else if (next) { ev = next; mode = 'soon'; }

  if (!state.calendar) {
    el.className = 'next empty';
    el.innerHTML = `<span class="label">Next up</span><div><div class="title">Calendar not connected</div><div class="meta">Waiting for calendar data.</div></div>`;
    return;
  }
  if (!ev) {
    el.className = 'next empty';
    el.innerHTML = `<span class="label">Next up</span><div><div class="title">Nothing scheduled</div><div class="meta">The next week is clear.</div></div>`;
    return;
  }

  let num, unit, label;
  if (mode === 'now') {
    const left = Math.ceil((ev.end - nowMs) / MIN);
    label = 'Happening now';
    [num, unit] = left < 60 ? [left, 'min left'] : [`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, 'left'];
  } else {
    const mins = Math.ceil((ev.start - nowMs) / MIN);
    const sameDay = startOfDay(ev.start) === startOfDay(nowMs);
    label = 'Next up';
    if (mins < 60) [num, unit] = [mins, 'min'];
    else if (sameDay || mins < 12 * 60) [num, unit] = [Math.round(mins / 60), Math.round(mins / 60) === 1 ? 'hour' : 'hours'];
    else if (startOfDay(ev.start) === addDays(startOfDay(nowMs), 1)) [num, unit] = [fmtTime(ev.start, false), 'tomorrow'];
    else [num, unit] = [WEEKDAY[new Date(ev.start).getDay()].slice(0, 3), fmtTime(ev.start)];
  }

  el.className = `next ${mode === 'now' ? 'now' : ''}`;
  el.innerHTML =
    `<span class="label">${label}</span>` +
    `<div style="min-width:0"><div class="title">${esc(ev.title)}</div>` +
    `<div class="meta">${fmtRange(ev)}${ev.location ? ' · ' + esc(ev.location) : ''}</div></div>` +
    `<div class="count"><span class="num">${num}</span><span class="u">${esc(String(unit).toUpperCase())}</span></div>`;
}

function renderAgenda() {
  if (!state.calendar) { $('agenda').innerHTML = ''; return; }
  const nowMs = Date.now();
  const today = startOfDay(nowMs);
  // Today and tomorrow always, then the next two days with events within the week (the sync job
  // expands 8 days), so an empty weekend doesn't leave the list at two days. Caps keep it within
  // the 800px panel.
  let budget = 12;
  let extra = 2;
  const html = [];
  for (let offset = 0; offset < 7 && extra > 0; offset++) {
    const cap = offset === 0 ? 6 : offset === 1 ? 4 : 3;
    const day = addDays(today, offset);
    const { allDay, timed } = eventsOn(day);
    const items = allDay.map((e) => ({ e, all: true })).concat(timed.map((e) => ({ e, all: false })));
    if (offset >= 2) {
      if (!items.length) continue;
      if (budget <= 0) break;
      extra--;
    }
    const limit = Math.min(cap, Math.max(1, budget));
    const shown = items.slice(0, limit);
    budget -= Math.max(1, shown.length);

    const name = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : WEEKDAY[new Date(day).getDay()];
    const sub = offset <= 1 ? `${WEEKDAY[new Date(day).getDay()]}, ${MONTH[new Date(day).getMonth()].slice(0, 3)} ${new Date(day).getDate()}` : `${MONTH[new Date(day).getMonth()].slice(0, 3)} ${new Date(day).getDate()}`;
    const rows = shown.map(({ e, all }) => {
      const cls = all ? '' : e.end <= nowMs ? 'past' : e.start <= nowMs ? 'current' : '';
      const when = all ? 'All day' : e.start < day ? 'cont.' : fmtTime(e.start);
      return `<div class="ev ${cls}"><span class="when">${when}</span><span class="what">${esc(e.title)}${e.location ? `<span class="where">${esc(e.location)}</span>` : ''}</span></div>`;
    }).join('');
    const more = items.length > shown.length ? `<div class="more">+${items.length - shown.length} more</div>` : '';
    const none = items.length ? '' : `<div class="none">${offset === 0 ? 'Nothing on the calendar today.' : 'Nothing scheduled.'}</div>`;
    html.push(`<div class="day"><div class="day-h"><span class="label">${name}</span><span class="sub">${sub}</span></div>${rows}${none}${more}</div>`);
  }
  $('agenda').innerHTML = html.join('');
}

// ------------------------------------------------------------------ status

function renderStatus() {
  const nowMs = Date.now();
  const stale = [];
  for (const key of ['calendar', 'weather']) {
    const last = state.ok[key] || (state[key] && state[key].updated) || 0;
    if (nowMs - last > STALE_AFTER) stale.push(last ? `${key} offline since ${fmtTime(last)}` : `${key} unavailable`);
  }
  const el = $('status');
  el.className = `status ${stale.length ? 'stale' : ''}`;
  el.textContent = stale.length ? stale.join(' · ') : `Updated ${fmtTime(Math.min(state.ok.calendar, state.ok.weather))}`;
}

// ------------------------------------------------------------------ data

async function refresh(key) {
  try {
    const res = await fetch(api(`/api/${key}`), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state[key] = data;
    // The calendar comes from KV and may be old; trust its sync time, not the fetch time.
    state.ok[key] = data.updated || Date.now();
    state.failed[key] = false;
    save(key, data);
  } catch (e) {
    state.failed[key] = true;
    console.warn(`${key} refresh failed`, e);
    // Photos otherwise refresh hourly; don't sit on "Photos unavailable" that long after a blip
    // (such as a reload that lands mid-deploy, before the new Worker is live).
    if (key === 'photos') setTimeout(() => refresh('photos'), 2 * MIN);
  }
  renderAll();
}

// ------------------------------------------------------------------ calendar view: 7 days from today

function renderCalendarView() {
  const el = $('view-calendar');
  if (!state.calendar) {
    el.innerHTML = `<div class="v-head"><h1>This week</h1></div><div class="wx-empty">Waiting for calendar data.</div>`;
    return;
  }
  const nowMs = Date.now();
  const today = startOfDay(nowMs);
  const last = addDays(today, 6);
  const range = `${MONTH[new Date(today).getMonth()].slice(0, 3)} ${new Date(today).getDate()} – ${MONTH[new Date(last).getMonth()].slice(0, 3)} ${new Date(last).getDate()}`;
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    const d = new Date(day);
    const { allDay, timed } = eventsOn(day);
    const items = allDay.map((e) => ({ e, all: true })).concat(timed.map((e) => ({ e, all: false })));
    const CAP = 7;
    const cards = items.slice(0, CAP).map(({ e, all }) => {
      const cls = all ? 'is-all' : e.end <= nowMs ? 'is-past' : e.start <= nowMs ? 'is-now' : '';
      const when = all ? 'All day' : e.start < day ? 'Cont.' : fmtTime(e.start);
      return `<div class="cal-ev ${cls}"><b>${when}</b><span>${esc(e.title)}</span></div>`;
    }).join('');
    const more = items.length > CAP ? `<div class="cal-more">+${items.length - CAP} more</div>` : '';
    const none = items.length ? '' : `<div class="cal-none">Free</div>`;
    cols.push(`<div class="cal-day ${i === 0 ? 'is-today' : ''}"><div class="cal-dh"><span class="label">${i === 0 ? 'Today' : WEEKDAY[d.getDay()].slice(0, 3)}</span><span class="num">${d.getDate()}</span></div>${cards}${none}${more}</div>`);
  }
  el.innerHTML = `<div class="cal"><div class="v-head"><h1>This week</h1><span class="sub">${range}</span></div><div class="cal-week">${cols.join('')}</div></div>`;
}

// ------------------------------------------------------------------ weather view: 12 hours + 6 days

function renderWeatherView() {
  const el = $('view-weather');
  const W = state.weather;
  if (!W || !W.current) { el.innerHTML = `<div class="v-head"><h1>Weather</h1></div><div class="wx-empty">Waiting for weather data.</div>`; return; }
  const c = W.current, d = W.daily, h = W.hourly;
  const now = weatherInfo(c.weather_code, c.is_day);
  const nowMs = Date.now();

  let first = h.time.findIndex((t) => new Date(t).getTime() + HOUR > nowMs);
  if (first < 0) first = 0;
  const end = Math.min(first + 12, h.time.length);
  const temps = h.temperature_2m.slice(first, end);
  const lo = Math.min(...temps), span = Math.max(1, Math.max(...temps) - lo);
  const hours = [];
  for (let i = first; i < end; i++) {
    const info = weatherInfo(h.weather_code[i], h.is_day[i]);
    const p = h.precipitation_probability[i];
    const label = i === first ? 'NOW' : fmtTime(h.time[i]).replace(':00 ', '').replace('AM', 'A').replace('PM', 'P');
    const bar = 24 + Math.round(((h.temperature_2m[i] - lo) / span) * 110);
    hours.push(`<div class="wx-h"><span class="t">${Math.round(h.temperature_2m[i])}°</span><i class="wx-bar" style="height:${bar}px"></i>${icon(info.icon, 30)}<span class="p">${p >= 20 ? p + '%' : ''}</span><span class="h">${label}</span></div>`);
  }

  const days = [];
  for (let i = 0; i < Math.min(6, d.time.length); i++) {
    const info = weatherInfo(d.weather_code[i], 1);
    const date = new Date(`${d.time[i]}T12:00`);
    const p = d.precipitation_probability_max[i];
    days.push(`<div class="wx-day"><span class="d">${i === 0 ? 'Today' : WEEKDAY[date.getDay()].slice(0, 3)}</span>${icon(info.icon, 34)}<span class="p">${p >= 20 ? p + '%' : ''}</span><span class="hi">${Math.round(d.temperature_2m_max[i])}°</span><span class="lo">${Math.round(d.temperature_2m_min[i])}°</span></div>`);
  }
  const sun = (k) => (d[k] && d[k][0] ? fmtTime(d[k][0]) : '–');

  el.innerHTML =
    `<div class="wx">` +
      `<div class="wx-now">${icon(now.icon, 120)}<span class="num w-temp">${Math.round(c.temperature_2m)}°</span>` +
        `<div class="w-desc"><span class="cond">${esc(now.label)}</span>` +
        `<span class="hl">H ${Math.round(d.temperature_2m_max[0])}° · L ${Math.round(d.temperature_2m_min[0])}°</span>` +
        `<span class="hl">Feels ${Math.round(c.apparent_temperature)}° · Wind ${Math.round(c.wind_speed_10m)} mph</span>` +
        `<span class="hl serif">${esc(weatherNote(W))}</span></div></div>` +
      `<div class="wx-sun"><div><span class="label">Sunrise</span><b>${sun('sunrise')}</b></div><div><span class="label">Sunset</span><b>${sun('sunset')}</b></div></div>` +
      `<div class="wx-hours"><span class="label">Next 12 hours</span><div class="wx-hgrid">${hours.join('')}</div></div>` +
      `<div class="wx-days">${days.join('')}</div>` +
    `</div>`;
}

// ------------------------------------------------------------------ photos view: a Flickr album
// /api/photos returns { album, photos: [{ src, caption }] } for one public album. Only two slide
// elements exist (showing + next), so the kiosk never holds the whole album in memory; the next
// image is decoded before it fades in, and the one after that is preloaded.

const PHOTO_EVERY = 12000;
let photoOrder = [], photoKey = '', photoIdx = 0, photoTimer = 0, photoFront = 0;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Keep one shuffled order per page load; reshuffle only when the album's contents change.
function syncPhotoOrder() {
  const list = (state.photos && state.photos.photos) || [];
  const key = list.map((p) => p.src).join('|');
  if (key === photoKey) return false;
  photoKey = key;
  photoOrder = shuffle(list.slice());
  photoIdx = 0;
  return true;
}
function photoCaption(p) {
  return (p && p.caption) || (state.photos && state.photos.album) || '';
}
function renderPhotoCap() {
  const p = photoOrder[photoIdx];
  document.querySelector('.ph-cap .label').textContent =
    photoOrder.length ? `Photos · ${photoIdx + 1} of ${photoOrder.length}` : 'Photos';
  document.querySelector('.ph-cap .serif').textContent =
    p ? photoCaption(p)
      : state.photos ? 'No photos in the album'
      : state.failed.photos ? 'Photos unavailable'
      : 'Loading photos…';
}

// Called on every renderAll (each data refresh), so only rebuild when the album changed.
function renderPhotos() {
  const changed = syncPhotoOrder();
  if (!changed && $('view-photos').querySelector('.ph')) { renderPhotoCap(); return; }
  const p = photoOrder[photoIdx];
  photoFront = 0;
  $('view-photos').innerHTML =
    `<div class="ph">` +
      `<div class="ph-slide is-on">${p ? `<img src="${esc(api(p.src))}" alt="" decoding="async">` : ''}</div>` +
      `<div class="ph-slide"><img alt="" decoding="async"></div>` +
      `<div class="ph-cap"><div><span class="label"></span><div class="serif"></div></div>` +
      `<span class="num ph-time">${fmtTime(new Date(), false)}</span></div>` +
    `</div>`;
  if (!p) $('view-photos').querySelector('.ph-slide').classList.add('ph-empty');
  renderPhotoCap();
  preloadPhoto(photoIdx + 1);
}
function preloadPhoto(i) {
  if (photoOrder.length > 1) new Image().src = api(photoOrder[i % photoOrder.length].src);
}
let photoBusy = false;  // a decode is in flight; a tap meanwhile mustn't swap the back slide's src
async function nextPhoto() {
  if (photoBusy || photoOrder.length < 2) return;
  const slides = document.querySelectorAll('#view-photos .ph-slide');
  if (slides.length < 2) return;
  const idx = (photoIdx + 1) % photoOrder.length;
  const back = slides[1 - photoFront];
  let img = back.querySelector('img');
  if (!img) { img = document.createElement('img'); img.alt = ''; back.appendChild(img); }
  img.src = api(photoOrder[idx].src);
  photoBusy = true;
  try { await img.decode(); } catch (e) { photoIdx = idx; return; }  // broken image: skip it next time round
  finally { photoBusy = false; }
  if (current !== 'photos') return;
  back.classList.add('is-on');
  slides[photoFront].classList.remove('is-on');
  photoFront = 1 - photoFront;
  photoIdx = idx;
  renderPhotoCap();
  preloadPhoto(idx + 1);
}
function startPhotos() {
  stopPhotos();
  photoTimer = setInterval(nextPhoto, PHOTO_EVERY);
}
function stopPhotos() { clearInterval(photoTimer); photoTimer = 0; }

// Tap a photo to skip ahead; the auto-advance timer restarts so the new one gets its full time.
$('view-photos').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || current !== 'photos') return;
  startPhotos();
  nextPhoto();
});

// ------------------------------------------------------------------ views + idle

let current = null;
function go(name) {
  if (!VIEWS.includes(name)) name = 'today';
  if (name === current) return;
  current = name;
  for (const v of VIEWS) $(`view-${v}`).classList.toggle('is-active', v === name);
  document.querySelectorAll('.rail-item').forEach((b) => b.classList.toggle('is-active', b.dataset.go === name));
  $('stage').classList.toggle('on-photos', name === 'photos');
  if (location.hash !== `#${name}`) history.replaceState(null, '', `${location.pathname}${location.search}#${name}`);
  renderCurrent();
  if (name === 'photos') startPhotos(); else stopPhotos();
}
function renderCurrent() {
  if (current === 'calendar') renderCalendarView();
  else if (current === 'weather') renderWeatherView();
  else if (current === 'photos') renderPhotos();
}

let lastTouch = Date.now();
setInterval(() => {
  if (current !== 'today' && !$('settings').classList.contains('is-open') && Date.now() - lastTouch >= IDLE_HOME) go('today');
}, 5000);

// ------------------------------------------------------------------ display settings (hold the rail clock, or press S)

function settingsHTML() {
  const swatch = (t) => `<i style="background:linear-gradient(135deg,${t.sw[0]} 50%,${t.sw[1]} 50%)"></i>`;
  const sunNow = sunTimes();
  const nightNote = autoNight && isNight() && chosenTheme !== 'graphite'
    ? `<p class="set-note">Night-time: showing Graphite until sunrise at ${fmtMin(sunNow.rise)}, then ${THEMES.find((t) => t.id === chosenTheme).name}.</p>` : '';
  return `<div class="set-panel"><button class="set-done" data-close>Done</button>` +
    `<span class="label">Display</span><h2>Colour theme</h2>` +
    `<div class="set-grid">${THEMES.map((t) => `<button data-theme="${t.id}" class="${t.id === chosenTheme ? 'is-on' : ''}">${swatch(t)}${t.name}</button>`).join('')}` +
    `<button data-autonight class="${autoNight ? 'is-on' : ''}">Graphite at night${autoNight ? ' ✓' : ''}</button></div>` +
    `${nightNote}<p class="set-note">Graphite at night runs from sunset to sunrise (today ${fmtMin(sunNow.set)} – ${fmtMin(sunNow.rise)}). Keys: 1–4 views · T theme · S settings.</p></div>`;
}
function openSettings() { $('settings').innerHTML = settingsHTML(); $('settings').classList.add('is-open'); }
function closeSettings() { $('settings').classList.remove('is-open'); }
function cycleTheme() {
  const ids = THEMES.map((t) => t.id);
  setTheme(ids[(ids.indexOf(chosenTheme) + 1) % ids.length]);
}

$('settings').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) { if (e.target === $('settings')) closeSettings(); return; }
  if (b.hasAttribute('data-close')) return closeSettings();
  if (b.dataset.theme) setTheme(b.dataset.theme);
  if (b.hasAttribute('data-autonight')) setAutoNight(!autoNight);
  openSettings();
});

// Hold the rail clock for 0.7 s to open settings.
(function holdClock() {
  const el = $('railClock');
  let t = 0;
  const cancel = () => { clearTimeout(t); el.classList.remove('is-holding'); };
  el.addEventListener('pointerdown', () => {
    el.classList.add('is-holding');
    t = setTimeout(() => { cancel(); openSettings(); }, 700);
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
})();

// Switch views the instant a finger lands, not on release; keyboard "clicks" (detail 0) still work.
$('rail').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-go]');
  if (b && e.button === 0) go(b.dataset.go);
});
$('rail').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b && e.detail === 0) go(b.dataset.go);
});
document.addEventListener('pointerdown', () => { lastTouch = Date.now(); }, true);
window.addEventListener('hashchange', () => go(location.hash.slice(1)));
document.addEventListener('keydown', (e) => {
  lastTouch = Date.now();
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= String(VIEWS.length)) go(VIEWS[+k - 1]);
  if (k === 't') { cycleTheme(); if ($('settings').classList.contains('is-open')) openSettings(); }
  if (k === 's') { $('settings').classList.contains('is-open') ? closeSettings() : openSettings(); }
  if (k === 'escape') closeSettings();
});

// ------------------------------------------------------------------ boot + ticks

function renderAll() {
  renderClock();
  renderWeather();
  renderNext();
  renderAgenda();
  renderStatus();
  renderCurrent();
}

go(location.hash.slice(1) || 'today');
renderAll();
refresh('calendar');
refresh('weather');
setInterval(() => refresh('calendar'), 5 * MIN);
setInterval(() => refresh('weather'), 15 * MIN);
refresh('photos');
setInterval(() => refresh('photos'), HOUR);

// Tick on the minute: theme (Graphite at night), clock, countdown, past/current rows, and the open view.
function tick() {
  applyTheme();
  renderClock();
  renderNext();
  renderAgenda();
  renderStatus();
  if (current === 'calendar') renderCalendarView();
  if (current === 'photos') document.querySelector('.ph-time').textContent = fmtTime(new Date(), false);
  setTimeout(tick, MIN - (Date.now() % MIN) + 50);
}
setTimeout(tick, MIN - (Date.now() % MIN) + 50);

// Reload once a night to clear any WebView memory growth.
setTimeout(() => location.reload(), addDays(startOfDay(Date.now()), 1) + 3 * HOUR - Date.now());

// Pick up deploys: every few minutes, fetch the page and compare its hashed /assets/ files with
// the ones this copy loaded. A JS or CSS change gives new hashes; reload when they differ. It waits
// for Today with settings closed, and reloads at most once per 10 min in case a cache serves an old page.
const assetSet = (list) => list.filter((p) => p && p.indexOf('/assets/') !== -1).sort().join(' ');
const loadedAssets = assetSet([...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')]
  .map((el) => el.getAttribute('src') || el.getAttribute('href')));
async function checkForDeploy() {
  if (!loadedAssets || current !== 'today' || $('settings').classList.contains('is-open')) return;
  if (Date.now() - Number(loadRaw('office.lastReload', '0')) < 10 * MIN) return;
  try {
    const res = await fetch(api('/'), { cache: 'no-store' });
    if (!res.ok) return;
    const live = assetSet((await res.text()).match(/\/assets\/[^"'\s>]+/g) || []);
    if (live && live !== loadedAssets) { saveRaw('office.lastReload', String(Date.now())); location.reload(); }
  } catch (e) { /* offline; try again next time */ }
}
setInterval(checkForDeploy, 5 * MIN);

window.OFFICE_READY = true;
