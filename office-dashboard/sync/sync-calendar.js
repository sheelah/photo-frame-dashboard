// Runs on the Linux box every 5 minutes (office-dashboard-sync.timer): fetches the Google Calendar
// iCal feeds, expands the next 8 days and writes the JSON to Workers KV key "calendar".
// On any failure it writes nothing, so KV keeps the last good data.
//
//   node sync-calendar.js            fetch, expand, push
//   node sync-calendar.js --dry-run  fetch, expand, print counts only
//
// Logs carry counts only: never titles, locations or feed URLs.
import { buildCalendar } from './calendar.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const t0 = Date.now();
  const feeds = (process.env.CALENDAR_ICS_URL || '').split(/\s+/).filter(Boolean);
  if (!feeds.length) throw new Error('CALENDAR_ICS_URL is not set');

  const texts = [];
  for (const [i, feed] of feeds.entries()) {
    const res = await fetch(feed, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`feed ${i + 1} returned ${res.status}`);
    texts.push(await res.text());
  }
  const t1 = Date.now();
  const data = buildCalendar(texts, Date.now());
  const t2 = Date.now();
  const body = JSON.stringify(data);

  const allDay = data.events.filter((e) => e.allDay).length;
  const stats = `${data.events.length} events (${allDay} all-day), feeds ${texts.reduce((n, t) => n + t.length, 0)} bytes, ` +
    `fetch ${t1 - t0} ms, parse ${t2 - t1} ms, ${body.length} bytes JSON`;
  if (dryRun) {
    console.log(`dry run: ${stats}`);
    return;
  }

  const { CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = process.env;
  if (!CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID || !CF_API_TOKEN) {
    throw new Error('CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID and CF_API_TOKEN must be set');
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}` +
    `/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/calendar`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(30000),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || !result.success) {
    const why = (result.errors || []).map((e) => `${e.code} ${e.message}`).join('; ');
    throw new Error(`KV write returned ${res.status}${why ? `: ${why}` : ''}`);
  }
  console.log(`pushed ${stats}, total ${Date.now() - t0} ms`);
}

main().catch((err) => {
  // fetch() hides the network reason in err.cause; the code (ENOTFOUND, ...) never carries the URL.
  const cause = err && err.cause && err.cause.code ? ` (${err.cause.code})` : '';
  console.error(`sync failed: ${err && err.message || err}${cause}`);
  process.exitCode = 1;
});
