import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { EntryBrowserBridge } from './bridge_runtime.mjs';
import { changedPaths, hashProject, hashRawProject, hashScriptMaskedProject, readEntProject, summarizeProject } from './project.mjs';
import { ENTRY_INSTRUCTIONS, registerAuthoringTools } from './authoring-tools.mjs';

const OUTPUT_DIR = process.env.ENTRY_MCP_OUTPUT || join(process.env.LOCALAPPDATA || tmpdir(), 'EntryPersonalMCP');
const bridge = new EntryBrowserBridge();
await bridge.start();

const response = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  isError: value.status === 'FAIL' || value.status === 'BLOCKED',
});
const guarded = (fn) => async (args) => {
  try { return response(await fn(args)); }
  catch (error) { return response({ status: 'BLOCKED', error: String(error?.message || error), nextStep: 'Use entry_help.recovery and entry_context. Do not retry a write without re-reading the project.' }); }
};

async function project() { return JSON.parse(await bridge.request('snapshot')); }
async function checkpoint(value) {
  const hash = hashProject(value);
  const dir = join(OUTPUT_DIR, 'snapshots');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${hash}.json`);
  await writeFile(path, JSON.stringify(value, null, 2));
  return { hash, path };
}

const server = new McpServer({ name: 'personal-entry-bridge', version: '0.2.0' }, { instructions: ENTRY_INSTRUCTIONS });
registerAuthoringTools(server, { bridge, guarded, project, checkpoint });

server.registerTool('entry_tabs', {
  description: 'List Entry editor tabs in your usual Chrome profile through the paired extension.',
  inputSchema: z.object({}),
}, guarded(async () => ({ status: 'PASS', tabs: await bridge.request('tabs') })));

server.registerTool('entry_select_tab', {
  description: 'Choose one listed Entry tab for later MCP calls.',
  inputSchema: z.object({ tabId: z.number().int().positive() }),
}, guarded(async ({ tabId }) => ({ status: 'PASS', ...(await bridge.request('selectTab', { tabId })) })));

server.registerTool('entry_status', {
  description: 'Read current Entry editor readiness, selected object, and capability counts.',
  inputSchema: z.object({}),
}, guarded(async () => ({ status: 'PASS', ...(await bridge.request('status')) })));

server.registerTool('entry_collider_tab_probe', {
  description: 'Inspect the collider tab in the usual Chrome Entry editor; optionally open the picture view and DOM-click the collider tab. Preserves and compares the stopped project.',
  inputSchema: z.object({ openPicture: z.boolean().default(false), click: z.boolean().default(false) }),
}, guarded(async (args) => {
  const before = await project();
  const saved = await checkpoint(before);
  const observation = await bridge.request('colliderTab', args);
  const after = await project();
  const paths = changedPaths(before, after);
  const state = observation.after;
  const entered = state.colliderTab?.state === 'active' && state.frameCount === 1
    && state.frameVisible && !state.surfaceFailure;
  const offered = observation.offered?.pictureVisible
    && observation.offered?.colliderTab?.visible;
  const status = paths.length || (args.click && !entered)
    || (observation.offered?.pictureVisible && !offered) ? 'FAIL'
    : !observation.offered?.pictureVisible ? 'BLOCKED' : 'CANDIDATE';
  return { status, entered, offered: observation.offered,
    checkpoint: saved.path, beforeHash: saved.hash, afterHash: hashProject(after),
    changedPaths: paths.slice(0, 100), ...observation };
}));

server.registerTool('entry_project', {
  description: 'Read a stopped project summary or one persisted section without editing.',
  inputSchema: z.object({ section: z.enum(['summary', 'objects', 'scenes', 'variables', 'messages', 'functions', 'tables']).default('summary'), id: z.string().optional() }),
}, guarded(async ({ section, id }) => {
  const value = await project();
  const data = section === 'summary' ? summarizeProject(value) : id ? (value[section] || []).find((item) => item.id === id) : value[section];
  if (data === undefined) throw new Error('PROJECT_ITEM_NOT_FOUND');
  if (JSON.stringify(data).length > 20_000) throw new Error('PROJECT_SECTION_TOO_LARGE: use entry_checkpoint');
  return { status: 'PASS', hash: hashProject(value), section, data };
}));

server.registerTool('entry_block_schema', {
  description: 'Find LIVE native or plugin blocks by query (English type-name fragment, e.g. move, shape, key, scene, list), or inspect an exact type. paramsKeyMap gives the named fields for entry_edit; params gives dropdown choices and statements gives branch slots. Never guess Entry parameter indices.',
  inputSchema: z.object({ type: z.string().optional(), query: z.string().optional(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(50) }),
}, guarded(async (args) => ({ status: 'PASS', ...(await bridge.request('blockSchema', args)) })));

server.registerTool('entry_checkpoint', {
  description: 'Save the stopped Entry project JSON locally and return its hash.',
  inputSchema: z.object({}),
}, guarded(async () => {
  const value = await project();
  // ★옛 확장에는 이 호출이 없다. 기록을 못 읽어도 체크포인트 자체는 저장한다.
  const journal = await bridge.request('journal').catch(() => null);
  return { status: 'PASS', ...(await checkpoint(value)), summary: summarizeProject(value), revertedEdits: journal?.revertedEdits ?? null };
}));

server.registerTool('entry_diff_checkpoint', {
  description: 'Compare every persisted field in the stopped editor with a local checkpoint.',
  inputSchema: z.object({ checkpointHash: z.string().regex(/^[a-f0-9]{64}$/) }),
}, guarded(async ({ checkpointHash }) => {
  const before = JSON.parse(await readFile(join(OUTPUT_DIR, 'snapshots', `${checkpointHash}.json`), 'utf8'));
  if (![hashProject, hashScriptMaskedProject, hashRawProject].some((hash) => hash(before) === checkpointHash)) throw new Error('CHECKPOINT_HASH_MISMATCH');
  const after = await project();
  const paths = changedPaths(before, after);
  return { status: paths.length ? 'CANDIDATE' : 'PASS', checkpointHash, currentHash: hashProject(after),
    changedCount: paths.length, changedPaths: paths.slice(0, 100) };
}));

server.registerTool('entry_load_checkpoint', {
  description: 'Replace the selected stopped editor project with a local checkpoint (clearProject then loadProject, through any installed EntryRoot hooks). Saves a backup checkpoint of the current tab first, never saves online, and reports counts and changed paths against the checkpoint. Call only when the user explicitly asks.',
  inputSchema: z.object({ checkpointHash: z.string().regex(/^[a-f0-9]{64}$/) }),
}, guarded(async ({ checkpointHash }) => {
  const file = join(OUTPUT_DIR, 'snapshots', `${checkpointHash}.json`);
  const text = await readFile(file, 'utf8');
  const wanted = JSON.parse(text);
  if (![hashProject, hashScriptMaskedProject, hashRawProject].some((hash) => hash(wanted) === checkpointHash)) throw new Error('CHECKPOINT_HASH_MISMATCH');
  const before = await project();
  const backup = await checkpoint(before);
  const loaded = await bridge.request('loadCheckpoint', { text: JSON.stringify(wanted) });
  const after = await project();
  const paths = changedPaths(wanted, after);
  const count = (value) => Object.fromEntries(['objects', 'functions', 'variables', 'messages', 'scenes', 'tables']
    .map((key) => [key, Array.isArray(value[key]) ? value[key].length : 0]));
  const lists = (value) => (value.variables || []).filter((item) => item?.variableType === 'list').length;
  const sameCounts = JSON.stringify(count(wanted)) === JSON.stringify(count(after)) && lists(wanted) === lists(after);
  return { status: !sameCounts ? 'FAIL' : paths.length ? 'CANDIDATE' : 'PASS', checkpointHash, loadedHash: hashProject(after),
    backupCheckpoint: backup.path, backupHash: backup.hash, loaded,
    counts: { checkpoint: { ...count(wanted), lists: lists(wanted) }, editor: { ...count(after), lists: lists(after) } },
    changedCount: paths.length, changedPaths: paths.slice(0, 100),
    note: 'Not saved online. The user saves from the editor. A CANDIDATE with changed paths can come from EntryRoot reshaping the export (lowering/compaction); check the paths before saving.' };
}));

server.registerTool('entry_rename_object', {
  description: 'Rename one visible object with a checkpoint and a saved-data check of that object. The user may edit elsewhere at the same time.',
  inputSchema: z.object({ objectId: z.string().min(1), newName: z.string().min(1).max(100) }),
}, guarded(async ({ objectId, newName }) => {
  const before = await project();
  const matches = before.objects.filter((object) => object.id === objectId);
  if (matches.length !== 1) throw new Error('OBJECT_ID_NOT_UNIQUE_OR_MISSING');
  const saved = await checkpoint(before);
  const result = await bridge.request('rename', { objectId, newName });
  const after = await project();
  // 사용자가 같은 때 다른 곳이나 이 오브젝트의 코드를 고칠 수 있으므로 코드를 뺀 이 오브젝트만 비교한다.
  const now = after.objects.filter((object) => object.id === objectId);
  const withoutScript = ({ script, ...rest }) => rest;
  const unexpectedChanges = now.length === 1
    ? changedPaths({ objects: [withoutScript({ ...matches[0], name: newName })] }, { objects: [withoutScript(now[0])] }).slice(0, 20) : ['object missing after rename'];
  return { status: result.persisted && result.visibleName === newName && !unexpectedChanges.length ? 'PASS' : 'FAIL',
    objectId, oldName: matches[0].name, newName, beforeHash: saved.hash, afterHash: hashProject(after),
    checkpoint: saved.path, unexpectedChanges };
}));

server.registerTool('entry_run_stop', {
  description: 'Click Entry run and stop in the usual Chrome tab, observe X, and verify saved project data stayed unchanged.',
  inputSchema: z.object({ objectId: z.string().min(1).optional(), durationMs: z.number().int().min(100).max(2000).default(300) }),
}, guarded(async (args) => {
  const before = await project();
  const beforeHash = hashProject(before);
  const result = await bridge.request('runStop', args);
  const after = await project();
  const afterHash = hashProject(after);
  const paths = changedPaths(before, after);
  return { status: paths.length ? 'FAIL' : 'PASS', ...result, beforeHash, afterHash,
    changedCount: paths.length, changedPaths: paths.slice(0, 100) };
}));

server.registerTool('entry_read_ent', {
  description: 'Inspect a local Entry .ent file without changing the browser project.',
  inputSchema: z.object({ path: z.string().min(1) }),
}, guarded(async ({ path }) => {
  if (!path.toLowerCase().endsWith('.ent')) throw new Error('ENT_EXTENSION_REQUIRED');
  const value = await readEntProject(path);
  const fileHash = createHash('sha256').update(await readFile(path)).digest('hex');
  return { status: 'PASS', hash: hashProject(value), fileHash, summary: summarizeProject(value) };
}));

serveStdio(() => server);
