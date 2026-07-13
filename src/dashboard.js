import { execGws } from './config.js';

export function formatLocalTime(isoString, timezone) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    
    // Check if the isoString is date-only (like YYYY-MM-DD) or midnight UTC
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(isoString) || (isoString.includes('T00:00:00') && isoString.endsWith('Z'));
    
    const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    if (isDateOnly) {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }).format(date);
    }
    
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  } catch (e) {
    return isoString;
  }
}

export async function getDashboardData(timezone) {
  const result = {
    emails: [],
    events: [],
    tasks: []
  };

  // 1. Fetch unread emails
  try {
    const stdout = await execGws(['gmail', '+triage', '--max', '5', '--format', 'json']);
    const data = JSON.parse(stdout.toString());
    result.emails = data.messages || [];
    result.emails.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    result.emails = result.emails.map(m => ({ ...m, date: formatLocalTime(m.date, timezone) }));
  } catch (e) {
    console.error('Dashboard Error loading emails:', e.message);
  }

  // 2. Fetch upcoming calendar events
  try {
    const stdout = await execGws(['calendar', '+agenda', '--days', '3', '--format', 'json']);
    const data = JSON.parse(stdout.toString());
    result.events = data.items || data.events || [];
    result.events.sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));
    result.events = result.events.map(e => ({ ...e, start: formatLocalTime(e.start, timezone) }));
  } catch (e) {
    console.error('Dashboard Error loading calendar events:', e.message);
  }

  // 3. Fetch active tasks
  try {
    const params = { tasklist: '@default', showCompleted: false };
    const stdout = await execGws([
      'tasks',
      'tasks',
      'list',
      '--params',
      JSON.stringify(params),
      '--format',
      'json'
    ]);
    const data = JSON.parse(stdout.toString());
    result.tasks = data.items || [];
    result.tasks.sort((a, b) => {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return new Date(a.due) - new Date(b.due);
    });
    result.tasks = result.tasks.map(t => ({ ...t, due: t.due ? formatLocalTime(t.due, timezone) : '' }));
  } catch (e) {
    console.error('Dashboard Error loading tasks:', e.message);
  }

  return result;
}
