import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { WebSocket } from 'ws';

const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const children = [];
function launch() {
  const child = spawn(process.execPath, ['server_bridge.mjs'], {
    cwd: import.meta.dirname,
    env: { ...process.env, ENTRY_MCP_BRIDGE_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  const pending = new Map();
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); callback(message); }
  });
  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP_TIMEOUT ${method}: ${stderr}`)), 10000);
    pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { child, request, get stderr() { return stderr; } };
}
const owner = launch();
const token = (await readFile(new URL('./pairing-secret', import.meta.url), 'utf8')).trim();
let socket;
const tabs = [8, 9].map((tabId) => ({ tabId, title: `mock editor ${tabId}`, url: 'https://playentry.org/ws/new' }));
let selectedTabId;

async function connectBrowser() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      socket = await new Promise((resolve, reject) => {
        const candidate = new WebSocket(`ws://127.0.0.1:${port}`, {
          origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        });
        candidate.once('open', () => resolve(candidate));
        candidate.once('error', reject);
      });
      break;
    } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.ok(socket, `bridge did not start: ${owner.stderr}`);
  const ready = new Promise((resolve) => socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'ready') { resolve(); return; }
    let result;
    if (message.method === 'tabs') result = tabs;
    else if (message.method === 'selectTab') {
      assert.ok(tabs.some((tab) => tab.tabId === message.params.tabId));
      selectedTabId = message.params.tabId;
      result = { tabId: selectedTabId };
    } else if (message.method === 'status') result = { tabId: selectedTabId };
    else throw new Error(`unexpected browser method: ${message.method}`);
    socket.send(JSON.stringify({ id: message.id, ok: true, result }));
  }));
  socket.send(JSON.stringify({ type: 'hello', token }));
  await ready;
}

try {
  await connectBrowser();
  const rejected = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'http://127.0.0.1' });
  await new Promise((resolve) => rejected.once('open', resolve));
  const rejectedClose = new Promise((resolve) => rejected.once('close', resolve));
  rejected.send(JSON.stringify({ type: 'hello', role: 'peer', token: 'wrong' }));
  assert.equal(await rejectedClose, 1008);
  const peer = launch();
  const third = launch();
  const initialize = {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'entry-bridge-smoke', version: '0.1.0' },
  };
  const initialized = await owner.request(1, 'initialize', initialize);
  assert.ok(initialized.result, JSON.stringify({ initialized, stderr: owner.stderr }));
  assert.equal(initialized.result.serverInfo.name, 'personal-entry-bridge');
  assert.match(initialized.result.instructions, /entry_help/);
  assert.ok((await peer.request(1, 'initialize', initialize)).result, peer.stderr);
  assert.ok((await third.request(1, 'initialize', initialize)).result, third.stderr);
  for (const { child } of [owner, peer, third]) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const tools = await peer.request(2, 'tools/list');
  assert.ok(tools.result.tools.some((tool) => tool.name === 'entry_rename_object'));
  for (const name of ['entry_help','entry_edit','entry_script','entry_control','entry_preview','entry_undo']) assert.ok(tools.result.tools.some(tool=>tool.name===name));
  const call = async (client, id, name, args = {}) => JSON.parse((await client.request(id, 'tools/call', { name, arguments: args })).result.content[0].text);
  const guide = await call(peer, 20, 'entry_help');
  assert.ok(guide.examples.changeOneInput);
  assert.ok(guide.recovery.UNKNOWN_ENTRY_ACTION);
  assert.equal((await call(peer, 3, 'entry_tabs')).tabs.length, 2);
  await call(owner, 3, 'entry_select_tab', { tabId: 8 });
  await call(peer, 4, 'entry_select_tab', { tabId: 9 });
  await call(third, 3, 'entry_select_tab', { tabId: 8 });
  assert.equal((await call(owner, 4, 'entry_status')).tabId, 8);
  assert.equal((await call(peer, 5, 'entry_status')).tabId, 9);
  assert.equal((await call(third, 4, 'entry_status')).tabId, 8);
  assert.equal((await call(owner, 5, 'entry_tabs')).tabs.find((tab) => tab.selected).tabId, 8);
  assert.equal((await call(peer, 6, 'entry_tabs')).tabs.find((tab) => tab.selected).tabId, 9);
  if (process.argv[2]) {
    assert.equal((await call(peer, 7, 'entry_read_ent', { path: process.argv[2] })).status, 'PASS');
  }
  owner.child.kill();
  await new Promise((resolve) => owner.child.once('exit', resolve));
  assert.equal((await call(peer, 8, 'entry_tabs')).status, 'BLOCKED');
  socket = undefined;
  await connectBrowser();
  assert.equal((await call(peer, 9, 'entry_status')).tabId, 9);
  assert.equal((await call(third, 5, 'entry_status')).tabId, 8);
  process.stdout.write(JSON.stringify({ status: 'PASS', scope: 'three MCP processes, one browser bridge, isolated tab selection and owner recovery', tools: tools.result.tools.length }) + '\n');
} finally {
  socket?.close();
  for (const child of children) {
    child.stdin.end();
    setTimeout(() => child.kill(), 1000).unref();
  }
}
