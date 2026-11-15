// Google Calendar (iCal) expansion for the Linux box sync job. The Worker no longer parses feeds;
// it serves the JSON this produces from KV.
import ICAL from 'ical.js';

const DAY = 86400000;

// Expands the given iCal documents into { updated, events } for the window the page shows.
export function buildCalendar(icsTexts, now = Date.now()) {
  const from = now - DAY;
  const to = now + 8 * DAY;
  const events = [];
  for (const ics of icsTexts) events.push(...expand(ics, from, to));
  events.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  return { updated: now, events };
}

// Expands one iCal document into event instances overlapping [from, to).
export function expand(ics, from, to) {
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    const zone = new ICAL.Timezone(vtz);
    if (!ICAL.TimezoneService.has(zone.tzid)) ICAL.TimezoneService.register(zone);
  }

  const vevents = root.getAllSubcomponents('vevent');
  // Modified occurrences of recurring events (RECURRENCE-ID), keyed by UID.
  const exceptions = new Map();
  for (const ve of vevents) {
    if (!ve.hasProperty('recurrence-id')) continue;
    const uid = ve.getFirstPropertyValue('uid');
    if (!exceptions.has(uid)) exceptions.set(uid, []);
    exceptions.get(uid).push(ve);
  }

  const out = [];
  const push = (ev, start, end) => {
    if (ev.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    const allDay = start.isDate;
    const s = allDay ? dateMs(start) : start.toUnixTime() * 1000;
    const e = allDay ? dateMs(end) : end.toUnixTime() * 1000;
    if (e <= from || s >= to) return;
    out.push({
      title: ev.summary || '(No title)',
      location: ev.location || '',
      allDay,
      start: s,
      end: e,
      // All-day dates as YYYY-MM-DD so the page places them on the right local day.
      date: allDay ? start.toString().slice(0, 10) : undefined,
      endDate: allDay ? end.toString().slice(0, 10) : undefined,
    });
  };

  for (const ve of vevents) {
    if (ve.hasProperty('recurrence-id')) continue;
    const ev = new ICAL.Event(ve);
    for (const ex of exceptions.get(ev.uid) || []) ev.relateException(ex);

    if (!ev.isRecurring()) {
      push(ev, ev.startDate, ev.endDate);
      continue;
    }
    const it = ev.iterator();
    for (let next = it.next(), guard = 0; next && guard < 5000; next = it.next(), guard++) {
      const t = next.isDate ? dateMs(next) : next.toUnixTime() * 1000;
      if (t >= to) break;
      const occ = ev.getOccurrenceDetails(next);
      push(occ.item, occ.startDate, occ.endDate);
    }
  }
  return out;
}

// All-day dates have no zone; anchor them at UTC midnight for range checks only.
function dateMs(t) {
  return Date.UTC(t.year, t.month - 1, t.day);
}
