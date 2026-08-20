import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
export const name = 'tomilite';
export const inject = ['tools'];
export const Config = z.object({
    baseUrl: z.string().default('http://localhost:3192'),
    apiToken: z.string().default(''),
    projectId: z.string().default('proj-default'),
});
// ─── Model-visible copy (English) ───
const NOT_RUNNING = 'TomiLite is not running or unreachable. Start the TomiLite desktop app and retry. ' +
    'Download: https://github.com/xxwj225-James/tomilite/releases/latest';
const COPY = {
    listTasksDesc: 'List tasks from the local TomiLite task manager (project "{project}"). ' +
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
    listNotesDesc: 'List notes from the local TomiLite knowledge base. Optionally filter by ' +
        'category. Returns compact rows (content preview truncated to 500 chars).',
    listNotesCategory: 'Optional category filter (default category: general)',
    listNotesLimit: 'Maximum rows to return, default 20',
    createNoteDesc: 'Create a note in the local TomiLite knowledge base. The note appears in the user\'s Notes panel immediately.',
    createNoteTitle: 'Note title',
    createNoteContent: 'Note body (Markdown)',
    createNoteCategory: 'Note category, default general',
    noteCreated: 'Created note (id {id}) in TomiLite.',
    getStatsDesc: 'Get task statistics from the local TomiLite board (counts per status, ' +
        'priority, and type), e.g. before writing a daily report.',
};
/** Interpolate `{param}` placeholders in a template string. */
function fmt(template, params) {
    let out = template;
    for (const [key, value] of Object.entries(params))
        out = out.replaceAll(`{${key}}`, String(value));
    return out;
}
// ─── TomiLite HTTP client ───
// Reads go through GET ?input= (same as TomiLite's own frontend), mutations
// through POST body. Both return the unwrapped tRPC { result: { data } }.
/** Hard cap on every HTTP call so a hung TomiLite cannot stall an agent turn. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Combine the harness cancellation signal with a hard deadline. */
function withTimeout(signal) {
    return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}
/** Extract the human-readable message from a tRPC error body, if any. */
function tRpcMessage(text) {
    try {
        const parsed = JSON.parse(text);
        const msg = parsed.error?.json?.message;
        return typeof msg === 'string' && msg.length > 0 ? msg : undefined;
    }
    catch {
        return undefined;
    }
}
async function tlRequest(config, url, init, route) {
    let resp;
    try {
        resp = await fetch(url, init);
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`tomilite ${route}: ${NOT_RUNNING} (${detail})`);
    }
    if (!resp.ok) {
        const body = await resp.text();
        const detail = tRpcMessage(body);
        throw new Error(`tomilite ${route}: HTTP ${resp.status}${detail ? ` — ${detail}` : ''}`);
    }
    const json = (await resp.json().catch(() => ({})));
    if (json.error) {
        const detail = tRpcMessage(JSON.stringify(json.error)) ?? JSON.stringify(json.error);
        throw new Error(`tomilite ${route}: ${detail}`);
    }
    return json.result?.data;
}
async function tlRead(config, route, input, signal) {
    const query = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
    const url = `${config.baseUrl}/api/${route}${query}`;
    return tlRequest(config, url, { headers: tlHeaders(config), signal: withTimeout(signal) }, route);
}
async function tlMutate(config, route, input, signal) {
    const url = `${config.baseUrl}/api/${route}`;
    return tlRequest(config, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tlHeaders(config) },
        body: JSON.stringify(input),
        signal: withTimeout(signal),
    }, route);
}
function tlHeaders(config) {
    const token = config.apiToken || process.env.TOMILITE_API_TOKEN || '';
    return token ? { 'x-tl-token': token } : {};
}
function projectTask(row) {
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
function projectNote(row) {
    return {
        id: String(row.id),
        title: String(row.title ?? ''),
        category: String(row.category ?? ''),
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
        content: typeof row.content === 'string' ? row.content.slice(0, 500) : null,
    };
}
/** Renders a JSON value for the model as a compact pretty-printed block. */
function jsonRender(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
// ─── Plugin ───
export function apply(ctx, config) {
    ctx.logger(name).info('TomiLite plugin loaded — baseUrl=%s projectId=%s', config.baseUrl, config.projectId);
    // ─── Tasks ───
    ctx.tools.register(defineTool({
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
            const rows = (await tlRead(config, 'issue.list', { projectId: config.projectId }, exec.signal));
            const filtered = args.status ? rows.filter((r) => r.status === args.status) : rows;
            return { tasks: filtered.slice(0, args.limit ?? 20).map(projectTask) };
        },
    }));
    ctx.tools.register(defineTool({
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
            render: (_args, value) => [{ type: 'text', text: fmt(COPY.taskCreated, { number: String(value.issueNumber), id: String(value.id) }) }],
        },
        async execute(args, exec) {
            const created = (await tlMutate(config, 'issue.create', {
                projectId: config.projectId,
                title: args.title,
                description: args.description,
                type: args.type ?? 'task',
                priority: args.priority ?? 'medium',
                storyPoints: args.storyPoints,
            }, exec.signal));
            return { id: created.id, issueNumber: created.issueNumber };
        },
    }));
    ctx.tools.register(defineTool({
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
            render: () => [{ type: 'text', text: COPY.taskUpdated }],
        },
        async execute(args, exec) {
            const body = { id: args.id };
            if (args.status)
                body.status = args.status;
            if (args.priority)
                body.priority = args.priority;
            if (args.description !== undefined)
                body.description = args.description;
            await tlMutate(config, 'issue.update', body, exec.signal);
            return { updated: true };
        },
    }));
    // ─── Notes ───
    ctx.tools.register(defineTool({
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
            const rows = (await tlRead(config, 'wiki.list', { projectId: config.projectId, category: args.category }, exec.signal));
            return { notes: rows.slice(0, args.limit ?? 20).map(projectNote) };
        },
    }));
    ctx.tools.register(defineTool({
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
            render: (_args, value) => [{ type: 'text', text: fmt(COPY.noteCreated, { id: String(value.id) }) }],
        },
        async execute(args, exec) {
            const created = (await tlMutate(config, 'wiki.create', { projectId: config.projectId, title: args.title, content: args.content, category: args.category ?? 'general' }, exec.signal));
            return { id: created.id };
        },
    }));
    // ─── Project overview ───
    ctx.tools.register(defineTool({
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
            const stats = (await tlRead(config, 'health.taskStats', undefined, exec.signal));
            return { stats };
        },
    }));
}
