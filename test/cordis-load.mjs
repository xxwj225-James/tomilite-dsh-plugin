// Real-Cordis load test: boots a genuine @deepseek-ai/cordis Context, provides
// the `tools` service, loads the compiled plugin via ctx.plugin(), and
// verifies (1) the Cordis lifecycle resolves the plugin's inject + apply(),
// (2) all tools register, (3) the Config schema rejects invalid config.
// Catches ESM/API mismatches the fake-ctx smoke test can't.
import { Context } from '@deepseek-ai/cordis';
import * as plugin from '../lib/index.js';

const registered = [];
const ctx = new Context();

// Provide the `tools` service the plugin injects.
ctx.provide('tools', {
  register: (def) => { registered.push(def); return () => {}; },
});

let failed = false;

try {
  // Valid config → apply() runs under the real plugin lifecycle.
  const disposer = await ctx.plugin(plugin, {
    baseUrl: 'http://localhost:3192', apiToken: '', projectId: 'proj-default',
  });
  console.log('plugin disposer:', typeof disposer);

  const expected = [
    'tomilite_list_tasks',
    'tomilite_create_task',
    'tomilite_update_task',
    'tomilite_list_notes',
    'tomilite_create_note',
    'tomilite_get_stats',
  ];
  const names = registered.map((d) => d.name);
  for (const e of expected) {
    if (!names.includes(e)) { console.error(`MISSING after Cordis boot: ${e}`); failed = true; }
  }
  console.log('Cordis boot registered tools:', names);

  // Invalid config must be rejected by the Config schema.
  try {
    await ctx.plugin(plugin, { baseUrl: 42 });
    console.error('❌ invalid config was NOT rejected');
    failed = true;
  } catch (err) {
    console.log('invalid config rejected:', err?.name || String(err));
  }
} finally {
  await ctx.fiber.dispose();
}

console.log(failed ? '❌ CORDIS LOAD TEST FAILED' : '✅ CORDIS LOAD TEST PASSED');
process.exit(failed ? 1 : 0);
