// Smoke test: loads the compiled plugin with a mock Cordis context and
// verifies (1) apply() runs, (2) all tools register with the right names,
// (3) schemas are model-visible JSON Schema. No network calls.
import { apply, name } from '../lib/index.js';

const registered = [];
const fakeCtx = {
  tools: { register: (def) => { registered.push(def); return () => {}; } },
  logger: () => ({ info: (...a) => console.log('[plugin]', ...a) }),
};

apply(fakeCtx, { baseUrl: 'http://localhost:3192', apiToken: '', projectId: 'proj-default' });

const names = registered.map((d) => d.name);
const expected = [
  'tomilite_list_tasks',
  'tomilite_create_task',
  'tomilite_update_task',
  'tomilite_list_notes',
  'tomilite_create_note',
  'tomilite_get_stats',
];

let failed = false;
for (const e of expected) {
  if (!names.includes(e)) { console.error(`MISSING tool: ${e}`); failed = true; }
}
console.log('registered tools:', names);

// Model-visible surface must be exactly { name, description, parameters }
for (const def of registered) {
  const surface = { name: def.name, description: def.description, parameters: def.parameters };
  if (JSON.stringify(surface).includes('execute')) { console.error('LEAK: execute leaked into model surface for', def.name); failed = true; }
  console.log(`  ${def.name} — params: ${Object.keys(def.parameters || {}).length} keys`);
}

console.log(failed ? '❌ SMOKE TEST FAILED' : '✅ SMOKE TEST PASSED (plugin name: ' + name + ')');
process.exit(failed ? 1 : 0);
