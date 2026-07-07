import { execGws } from './config.js';

export async function getDashboardData() {
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
  } catch (e) {
    console.error('Dashboard Error loading emails:', e.message);
  }

  // 2. Fetch upcoming calendar events
  try {
    const stdout = await execGws(['calendar', '+agenda', '--days', '3', '--format', 'json']);
    const data = JSON.parse(stdout.toString());
    result.events = data.items || [];
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
  } catch (e) {
    console.error('Dashboard Error loading tasks:', e.message);
  }

  return result;
}
