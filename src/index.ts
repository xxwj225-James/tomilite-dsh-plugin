// ═══ tomilite-dsh-plugin ═══
// DeepSeek Harness plugin that exposes a local TomiLite instance
// (http://localhost:3192) as agent tools: tasks, notes, project stats.
//
// TomiLite and DSH run on the same machine; localhost calls are token-exempt
// on TomiLite's side, so no API key is needed for the default setup. For
// remote TomiLite instances set `baseUrl` and `apiToken` in config (or the
// TOMILITE_API_TOKEN env var).
//
// Wire format (mirrors TomiLite's own frontend client, apps/web/src/lib/api.ts):
//   GET  /api/<router>.<proc>?input=<urlencoded JSON>   (reads)
//   POST /api/<router>.<proc>  body=<JSON input>        (mutations)
//   Response envelope: { result: { data: ... } }
//
// Copy is English by design: DSH's locale service is browser-side only, so a
// host-side tool plugin like this one always renders English — the same
// choice every official DSH tool package makes.
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';

export const name = 'tomilite';
export const inject = ['tools'];

export interface Config {
  /** TomiLite API base URL. Default: local desktop app. */
  baseUrl: string;
  /** API token for non-localhost TomiLite instances (Settings → API Keys). */
  apiToken: string;
  /** Default project id used by TomiLite (single-user local: proj-default). */
  projectId: string;
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().default('http://localhost:3192'),
  apiToken: z.string().default(''),
  projectId: z.string().default('proj-default'),
});

// ─── Model-visible copy (English) ───
const NOT_RUNNING =
  'TomiLite is not running or unreachable. Start the TomiLite desktop app and retry. ' +
  'Download: https://github.com/xxwj225-James/tomilite/releases/latest';

const COPY = {
  listTasksDesc:
    'List tasks from the local TomiLite task manager (project "{project}"). ' +
    'Optionally filter by status: todo, in_progress, done. Returns compact rows ' +
    '(description truncated to 300 chars).',
  listTasksStatus: 'Optional status filter: todo | in_progress | done',
  listTasksLimit: 'Maximum rows to return, default 20 (server caps at 200)',
  createTaskDesc: 'Create a task in the local TomiLite task manager. The task appears in the user\'s Tasks panel immediately.',
  createTaskTitle: 'Task title',
  createTaskDescription: 'Optional task body / details',
  createTaskType: 'Task type, default task',
  createTaskPriority: 'Priority, default medium',
  createTaskStoryPoints: 'Optional story points estimate',
  taskCreated: 'Created task TL-{number} (id {id}) in TomiLite.',
  updateTaskDesc: 'Update an existing TomiLite task (status, priority, body, etc.). Only provided fields change.',
  updateTaskId: 'Task id (from tomilite_list_tasks)',
  updateTaskStatus: 'New status',
  updateTaskPriority: 'New priority',
  updateTaskDescription: 'New body',
  taskUpdated: 'Updated task in TomiLite.',
  listNotesDesc:
    'List notes from the local TomiLite knowledge base. Optionally filter by ' +
    'category. Returns compact rows (content preview truncated to 500 chars).',
  listNotesCategory: 'Optional category filter (default category: general)',
  listNotesLimit: 'Maximum rows to return, default 20',
  createNoteDesc: 'Create a note in the local TomiLite knowledge base. The note appears in the user\'s Notes panel immediately.',
  createNoteTitle: 'Note title',
  createNoteContent: 'Note body (Markdown)',
  createNoteCategory: 'Note category, default general',
  noteCreated: 'Created note (id {id}) in TomiLite.',
  getStatsDesc:
    'Get task statistics from the local TomiLite board (counts per status, ' +
    'priority, and type), e.g. before writing a daily report.',
} as const;

/** Interpolate `{param}` placeholders in a template string. */
function fmt(template: string, params: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(params)) out = out.replaceAll(`{${key}}`, String(value));
  return out;
}

// ─── TomiLite HTTP client ───
// Reads go through GET ?input= (same as TomiLite's own frontend), mutations
// through POST body. Both return the unwrapped tRPC { result: { data } }.

/** Hard cap on every HTTP call so a hung TomiLite cannot stall an agent turn. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Combine the harness cancellation signal with a hard deadline. */
function withTimeout(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

/** Extract the human-readable message from a tRPC error body, if any. */
function tRpcMessage(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: { json?: { message?: unknown } } };
    const msg = parsed.error?.json?.message;
    return typeof msg === 'string' && msg.length > 0 ? msg : undefined;
  } catch {
    return undefined;
  }
}

async function tlRequest(config: Config, url: string, init: RequestInit, route: string): Promise<unknown> {
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`tomilite ${route}: ${NOT_RUNNING} (${detail})`);
  }
  if (!resp.ok) {
    const body = await resp.text();
    const detail = tRpcMessage(body);
    throw new Error(`tomilite ${route}: HTTP ${resp.status}${detail ? ` — ${detail}` : ''}`);
  }
  const json = (await resp.json().catch(() => ({}))) as { result?: { data?: unknown }; error?: unknown };
  if (json.error) {
    const detail = tRpcMessage(JSON.stringify(json.error)) ?? JSON.stringify(json.error);
    throw new Error(`tomilite ${route}: ${detail}`);
  }
  return json.result?.data;
}

async function tlRead(config: Config, route: string, input: Record<string, unknown> | undefined, signal: AbortSignal): Promise<unknown> {
  const query = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const url = `${config.baseUrl}/api/${route}${query}`;
  return tlRequest(config, url, { headers: tlHeaders(config), signal: withTimeout(signal) }, route);
}

async function tlMutate(config: Config, route: string, input: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const url = `${config.baseUrl}/api/${route}`;
  return tlRequest(config, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tlHeaders(config) },
    body: JSON.stringify(input),
    signal: withTimeout(signal),
  }, route);
}

function tlHeaders(config: Config): Record<string, string> {
  const token = config.apiToken || process.env.TOMILITE_API_TOKEN || '';
  return token ? { 'x-tl-token': token } : {};
}

// ─── Row projections ───
// Lists return compact rows instead of full Prisma records to keep the model
// context lean; long text fields are truncated.

// Type aliases (not interfaces) so the rows stay structurally assignable to
// JsonValue; absent fields are `null` (JsonValue has no `undefined`).
type TaskRow = {
  id: string;
  issueNumber: number;
  title: string;
  status: string;
  priority: string;
  type: string;
  dueDate: string | null;
  description: string | null;
};

function projectTask(row: Record<string, unknown>): TaskRow {
  return {
    id: String(row.id),
    issueNumber: Number(row.issueNumber),
    title: String(row.title ?? ''),
    status: String(row.status ?? ''),
    priority: String(row.priority ?? ''),
    type: String(row.type ?? ''),
    dueDate: typeof row.dueDate === 'string' ? row.dueDate : null,
    description: typeof row.description === 'string' ? row.description.slice(0, 300) : null,
  };
}

type NoteRow = {
  id: string;
  title: string;
  category: string;
  updatedAt: string | null;
  content: string | null;
};

function projectNote(row: Record<string, unknown>): NoteRow {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    category: String(row.category ?? ''),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
    content: typeof row.content === 'string' ? row.content.slice(0, 500) : null,
  };
}

/** Renders a JSON value for the model as a compact pretty-printed block. */
function jsonRender(_args: unknown, value: unknown) {
  return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }];
}

// ─── Plugin ───
export function apply(ctx: Context, config: Config) {
  ctx.logger(name).info('TomiLite plugin loaded — baseUrl=%s projectId=%s', config.baseUrl, config.projectId);

  // ─── Tasks ───
  ctx.tools.register(
    defineTool({
      name: 'tomilite_list_tasks',
      description: fmt(COPY.listTasksDesc, { project: config.projectId }),
      timeoutMs: REQUEST_TIMEOUT_MS,
      parameters: {
        status: { type: 'string', description: COPY.listTasksStatus },
        limit: { type: 'integer', description: COPY.listTasksLimit },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { tasks: { type: 'array' } } },
        render: jsonRender,
      },
      async execute(args, exec) {
        const rows = (await tlRead(config, 'issue.list', { projectId: config.projectId }, exec.signal)) as Record<string, unknown>[];
        const filtered = args.status ? rows.filter((r) => r.status === args.status) : rows;
        return { tasks: filtered.slice(0, args.limit ?? 20).map(projectTask) };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'tomilite_create_task',
      description: COPY.createTaskDesc,
      timeoutMs: REQUEST_TIMEOUT_MS,
      parameters: {
        title: { type: 'string', required: true, description: COPY.createTaskTitle },
        description: { type: 'string', description: COPY.createTaskDescription },
        type: { type: 'string', enum: ['task', 'bug', 'story'], description: COPY.createTaskType },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: COPY.createTaskPriority },
        storyPoints: { type: 'integer', description: COPY.createTaskStoryPoints },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: { id: { type: 'string' }, issueNumber: { type: 'integer' } },
        },
        render: (_args, value) => [{ type: 'text' as const, text: fmt(COPY.taskCreated, { number: String(value.issueNumber), id: String(value.id) }) }],
      },
      async execute(args, exec) {
        const created = (await tlMutate(
          config,
          'issue.create',
          {
            projectId: config.projectId,
            title: args.title,
            description: args.description,
            type: args.type ?? 'task',
            priority: args.priority ?? 'medium',
            storyPoints: args.storyPoints,
          },
          exec.signal,
        )) as { id: string; issueNumber: number };
        return { id: created.id, issueNumber: created.issueNumber };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'tomilite_update_task',
      description: COPY.updateTaskDesc,
      timeoutMs: REQUEST_TIMEOUT_MS,
      parameters: {
        id: { type: 'string', required: true, description: COPY.updateTaskId },
        status: { type: 'string', enum: ['todo', 'in_progress', 'done'], description: COPY.updateTaskStatus },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: COPY.updateTaskPriority },
        description: { type: 'string', description: COPY.updateTaskDescription },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { updated: { type: 'boolean' } } },
        render: () => [{ type: 'text' as const, text: COPY.taskUpdated }],
      },
      async execute(args, exec) {
        const body: Record<string, unknown> = { id: args.id };
        if (args.status) body.status = args.status;
        if (args.priority) body.priority = args.priority;
        if (args.description !== undefined) body.description = args.description;
        await tlMutate(config, 'issue.update', body, exec.signal);
        return { updated: true };
      },
    }),
  );

  // ─── Notes ───
  ctx.tools.register(
    defineTool({
      name: 'tomilite_list_notes',
      description: COPY.listNotesDesc,
      timeoutMs: REQUEST_TIMEOUT_MS,
      parameters: {
        category: { type: 'string', description: COPY.listNotesCategory },
        limit: { type: 'integer', description: COPY.listNotesLimit },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { notes: { type: 'array' } } },
        render: jsonRender,
      },
      async execute(args, exec) {
        const rows = (await tlRead(
          config,
          'wiki.list',
          { projectId: config.projectId, category: args.category },
          exec.signal,
        )) as Record<string, unknown>[];
        return { notes: rows.slice(0, args.limit ?? 20).map(projectNote) };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'tomilite_create_note',
      description: COPY.createNoteDesc,
      timeoutMs: REQUEST_TIMEOUT_MS,
      parameters: {
        title: { type: 'string', required: true, description: COPY.createNoteTitle },
        content: { type: 'string', description: COPY.createNoteContent },
        category: { type: 'string', description: COPY.createNoteCategory },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: { id: { type: 'string' } },
        },
        render: (_args, value) => [{ type: 'text' as const, text: fmt(COPY.noteCreated, { id: String(value.id) }) }],
      },
      async execute(args, exec) {
        const created = (await tlMutate(
          config,
          'wiki.create',
          { projectId: config.projectId, title: args.title, content: args.content, category: args.category ?? 'general' },
          exec.signal,
        )) as { id: string };
        return { id: created.id };
      },
    }),
  );

  // ─── Project overview ───
  ctx.tools.register(
    defineTool({
      name: 'tomilite_get_stats',
      description: COPY.getStatsDesc,
      timeoutMs: REQUEST_TIMEOUT_MS,
      parameters: {},
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: { stats: { type: 'object', additionalProperties: true } },
        },
        render: jsonRender,
      },
      async execute(_args, exec) {
        // health.taskStats is a no-input query returning aggregated counts.
        const stats = (await tlRead(config, 'health.taskStats', undefined, exec.signal)) as Record<string, JsonValue>;
        return { stats };
      },
    }),
  );
}
