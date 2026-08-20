// Integration test: exercises the plugin's HTTP helpers against a REAL
// running TomiLite API (http://localhost:3192). Write operations are
// cleaned up (created test rows deleted) so no user data is left behind.
import { apply } from '../lib/index.js';

const BASE = 'http://localhost:3192';
const PROJECT = 'proj-default';
const registered = [];
const fakeCtx = {
  tools: { register: (def) => { registered.push(def); return () => {}; } },
  logger: () => ({ info() {} }),
};
apply(fakeCtx, { baseUrl: BASE, apiToken: '', projectId: PROJECT });

const byName = Object.fromEntries(registered.map((d) => [d.name, d]));
const abort = new AbortController();
let failed = false;

function check(cond, label) {
  console.log(cond ? `  ✅ ${label}` : `  ❌ ${label}`);
  if (!cond) failed = true;
}

async function runTool(toolName, args) {
  const def = byName[toolName];
  return def.execute(args, { signal: abort.signal });
}

console.log('== Read-only tools ==');
{
  const r = await runTool('tomilite_list_tasks', { limit: 5 });
  check(Array.isArray(r.tasks), `list_tasks returned array (${r.tasks.length} rows)`);
  check(r.tasks.every((t) => typeof t.id === 'string' && typeof t.title === 'string'), 'list_tasks rows are compact projections (id + title)');
}
{
  const r = await runTool('tomilite_list_notes', { limit: 5 });
  check(Array.isArray(r.notes), `list_notes returned array (${r.notes.length} rows)`);
}
{
  const r = await runTool('tomilite_get_stats', {});
  check(typeof r.stats === 'object' && r.stats !== null, 'get_stats returned object');
  check(typeof r.stats.total === 'number', 'get_stats.total is a number');
  check(typeof r.stats.byStatus === 'object' && r.stats.byStatus !== null, 'get_stats.byStatus is an object (counts per status)');
  check(typeof r.stats.byPriority === 'object' && r.stats.byPriority !== null, 'get_stats.byPriority is an object');
  check(typeof r.stats.byType === 'object' && r.stats.byType !== null, 'get_stats.byType is an object');
}

console.log('== Write round-trip: task ==');
let taskId;
{
  const title = `__dsh_plugin_test_${Date.now()}__`;
  const r = await runTool('tomilite_create_task', { title, priority: 'low' });
  check(!!r.id && typeof r.issueNumber === 'number', `create_task returned id TL-${r.issueNumber}`);
  taskId = r.id;

  const up = await runTool('tomilite_update_task', { id: taskId, status: 'in_progress' });
  check(up.updated === true, 'update_task set status=in_progress');

  const listed = await runTool('tomilite_list_tasks', { status: 'in_progress' });
  check(listed.tasks.some((t) => t.id === taskId), 'updated task visible in list with new status');

  // cleanup
  const resp = await fetch(`${BASE}/api/issue.delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: taskId }),
  });
  check(resp.ok, 'cleanup: task deleted');
}

console.log('== Write round-trip: note ==');
{
  const title = `__dsh_plugin_test_${Date.now()}__`;
  const r = await runTool('tomilite_create_note', { title, content: 'test body from dsh-plugin' });
  check(!!r.id, `create_note returned id`);
  // cleanup
  const resp = await fetch(`${BASE}/api/wiki.delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id }),
  });
  check(resp.ok, 'cleanup: note deleted');
}

console.log('== Error path ==');
{
  let threw = false;
  try {
    await runTool('tomilite_update_task', { id: 'nonexistent-id-12345' });
  } catch { threw = true; }
  check(threw, 'update_task on missing id throws (no silent success)');
}

console.log(failed ? '❌ INTEGRATION TEST FAILED' : '✅ INTEGRATION TEST PASSED');
process.exit(failed ? 1 : 0);
