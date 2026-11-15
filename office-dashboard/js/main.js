// Office dashboard: clock, weather (Open-Meteo via /api/weather), Google Calendar (/api/calendar).
import { icon, weatherInfo } from './icons.js';

const $ = (id) => document.getElementById(id);
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NIGHT_FROM = 21;   // dark, dim theme from 9 PM...
const NIGHT_TO = 6.5;    // ...to 6:30 AM
const STALE_AFTER = 20 * MIN;

// The kiosk opens /?k=<token>; pass it on API calls too, in case the cookie is lost.
const params = new URLSearchParams(location.search);
const token = params.get('k');
const theme = params.get('theme'); // 'day' or 'night' forces a theme (for testing)
const api = (path) => token ? `${path}?k=${encodeURIComponent(token)}` : path;

const state = {
  calendar: load('calendar'),
  weather: load('weather'),
  ok: { calendar: 0, weather: 0 },
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

// ------------------------------------------------------------------ clock + night mode

function renderClock() {
  const n = new Date();
  $('time').textContent = fmtTime(n, false);
  $('ampm').textContent = n.getHours() < 12 ? 'AM' : 'PM';
  $('weekday').textContent = WEEKDAY[n.getDay()];
  $('date').textContent = `${MONTH[n.getMonth()]} ${n.getDate()}`;
  const h = n.getHours() + n.getMinutes() / 60;
  const night = theme ? theme === 'night' : h >= NIGHT_FROM || h < NIGHT_TO;
  $('stage').classList.toggle('night', night);
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
  // Today, tomorrow, then two more days; caps keep it within the 800px panel.
  const plan = [[0, 6], [1, 4], [2, 3], [3, 3]];
  let budget = 12;
  const html = [];
  for (const [offset, cap] of plan) {
    const day = addDays(today, offset);
    const { allDay, timed } = eventsOn(day);
    const items = allDay.map((e) => ({ e, all: true })).concat(timed.map((e) => ({ e, all: false })));
    if (offset >= 2 && (!items.length || budget <= 0)) continue;
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
    save(key, data);
  } catch (e) {
    console.warn(`${key} refresh failed`, e);
  }
  renderAll();
}

function renderAll() {
  renderClock();
  renderWeather();
  renderNext();
  renderAgenda();
  renderStatus();
}

renderAll();
refresh('calendar');
refresh('weather');
setInterval(() => refresh('calendar'), 5 * MIN);
setInterval(() => refresh('weather'), 15 * MIN);

// Tick on the minute: clock, countdown, past/current rows.
function tick() {
  renderClock();
  renderNext();
  renderAgenda();
  renderStatus();
  setTimeout(tick, MIN - (Date.now() % MIN) + 50);
}
setTimeout(tick, MIN - (Date.now() % MIN) + 50);

// Reload once a night to pick up deploys and clear any WebView memory growth.
setTimeout(() => location.reload(), addDays(startOfDay(Date.now()), 1) + 3 * HOUR - Date.now());

window.OFFICE_READY = true;
