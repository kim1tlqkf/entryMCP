importScripts('pairing.js');
importScripts('authoring.js');

const ADDRESS = 'ws://127.0.0.1:9442';
let socket;
let selectedTabId;

const editorTabs = () => chrome.tabs.query({ url: 'https://playentry.org/ws/*' });

async function entryAction(method, args) {
  try {
  if (!location.pathname.startsWith('/ws/') || location.hostname !== 'playentry.org') throw new Error('NOT_ENTRY_EDITOR');
  if (!window.Entry?.engine || !Entry.container) throw new Error('ENTRY_NOT_READY');
  const stopped = () => {
    if (Entry.engine.state !== 'stop') throw new Error(`EDITOR_RUNNING: ${Entry.engine.state}`);
  };
  const stableProject = () => {
    stopped();
    return Entry.exportProject({});
  };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  if (method === 'status') return {
    url: location.href,
    engineState: Entry.engine.state,
    selectedObjectId: Entry.container.selectedObject?.id || null,
    objectCount: Entry.container.getAllObjects?.().length ?? null,
    sceneCount: Entry.scene?.scenes_?.length ?? null,
    blockDefinitionCount: Object.keys(Entry.block || {}).length,
  };
  if (method === 'colliderTab') {
    const inspect = () => {
      const root = document.getElementById('entryPainter');
      const native = [...(root?.querySelectorAll('.CommonPanel .modeSpace > button') || [])];
      const tab = document.querySelector('[data-entryroot-native-painter-tab]');
      // ★콜라이더 surface는 EntryPaint DOM 바깥의 body에 붙고, sandbox iframe의
      // 내부 문서는 페이지에서 읽을 수 없다. 존재/가시성만 이 경계에서 판정한다.
      const frame = document.querySelector('iframe[data-entryroot-collider-editor]');
      const shell = frame?.closest('[data-entryroot-surface-slot]');
      const tabRect = tab?.getBoundingClientRect();
      return {
        pictureVisible: Boolean(root?.getClientRects().length),
        nativeTabs: native.map(button => button.textContent.trim()),
        colliderTab: tab ? {
          label: tab.textContent.trim(), state: tab.dataset.entryrootNativePainterState || null,
          visible: Boolean(tabRect?.width && tabRect?.height && getComputedStyle(tab).visibility !== 'hidden'),
          parentIsBody: tab.parentElement === document.body,
          insideNativeModeSpace: Boolean(root?.querySelector('.CommonPanel .modeSpace')?.contains(tab)),
        } : null,
        nativeMode: Entry.playground?.painter?.entryPaint?.mode || null,
        nativeModified: Entry.playground?.painter?.file?.modified ?? null,
        frameCount: document.querySelectorAll('iframe[data-entryroot-collider-editor]').length,
        frameVisible: Boolean(frame?.getClientRects().length && !shell?.hidden
          && getComputedStyle(frame).visibility !== 'hidden'),
        frameCanvas: null,
        frameCanvasEvidence: 'CROSS_ORIGIN_IFRAME_NOT_OBSERVABLE_FROM_ENTRY_PAGE',
        surfaceCode: document.documentElement.dataset.entryrootSurfaceCode || null,
        surfaceFailure: document.documentElement.dataset.entryrootNativeSurfaceFailure || null,
        modalVisible: Boolean(document.querySelector('#EntryModal')?.getClientRects().length),
      };
    };
    const before = inspect();
    if (args.openPicture && !before.pictureVisible) {
      const pictureTab = document.getElementById('entryPictureTab');
      if (!pictureTab?.getClientRects().length) throw new Error('PICTURE_TAB_NOT_VISIBLE');
      pictureTab.click();
      await pause(500);
    }
    const offered = inspect();
    if (args.click) {
      if (!offered.pictureVisible || !offered.colliderTab?.visible) throw new Error('COLLIDER_TAB_NOT_VISIBLE');
      if (offered.nativeModified !== false || offered.modalVisible) {
        throw new Error('EDITOR_NATIVE_CHANGE_STATE_UNSAFE');
      }
      document.querySelector('[data-entryroot-native-painter-tab]').click();
      for (let i = 0; i < 40; i++) {
        await pause(250);
        const state = inspect();
        if (state.surfaceFailure || (state.colliderTab?.state === 'active'
          && state.frameCount === 1 && state.frameVisible)) break;
      }
    }
    return { before, offered, after: inspect(), clickMethod: args.click ? 'DOM-click' : null };
  }
  if (method === 'snapshot') return JSON.stringify(stableProject());
  if (method === 'loadCheckpoint') {
    // ★loadProject만 부르면 같은 id 오브젝트가 더해진다(HARNESS.md) — 비운 뒤 불러온다. 확장(EntryRoot)이 감싼 loadProject를 그대로 탄다.
    stopped();
    const data = JSON.parse(args.text);
    if (!Array.isArray(data?.objects) || !Array.isArray(data?.scenes)) throw new Error('CHECKPOINT_NOT_A_PROJECT');
    Entry.clearProject();
    Entry.loadProject(data);
    // 불러오기 뒤 EntryRoot 표시 단계가 비동기로 이어진다 — 오브젝트 수가 맞고 잠시 바뀌지 않을 때까지 기다린다
    let stable = 0;
    let last = -1;
    for (let i = 0; i < 120 && stable < 4; i++) {
      await pause(500);
      const count = Entry.container.getAllObjects?.().length ?? 0;
      stable = count === last && count >= data.objects.length ? stable + 1 : 0;
      last = count;
    }
    return { objectCount: Entry.container.getAllObjects?.().length ?? null, expectedObjects: data.objects.length };
  }
  if (method === 'blockSchema') {
    const definitions = Entry.block || {};
    const names = Object.keys(definitions).filter((name) => definitions[name] && typeof definitions[name] === 'object'
      && (!args.query || name.toLowerCase().includes(args.query.toLowerCase()))).sort();
    if (!args.type) return { total: names.length, types: names.slice(args.offset, args.offset + args.limit),
      nextOffset: args.offset + args.limit < names.length ? args.offset + args.limit : null };
    const block = definitions[args.type];
    if (!block) return { found: false, type: args.type };
    const seen = new WeakSet();
    const safe = (value, depth = 0) => {
      if (typeof value === 'function') return '[function]';
      if (!value || typeof value !== 'object' || depth > 5) return depth > 5 ? '[deep]' : value;
      if (seen.has(value)) return '[circular]';
      seen.add(value);
      if (Array.isArray(value)) return value.slice(0, 100).map((item) => safe(item, depth + 1));
      return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, safe(item, depth + 1)]));
    };
    const fields = ['def', 'paramsKeyMap', 'params', 'statements', 'events', 'class', 'syntax', 'color', 'skeleton', 'isFor', 'isNotFor'];
    return { found: true, type: args.type, keys: Object.keys(block),
      definition: safe(Object.fromEntries(fields.filter((key) => key in block).map((key) => [key, block[key]]))) };
  }
  if (method === 'rename') {
    stopped();
    if (Entry.container.getAllObjects().filter((object) => object.id === args.objectId).length !== 1) throw new Error('OBJECT_ID_NOT_UNIQUE_OR_MISSING');
    const row = [...document.querySelectorAll('li.entryContainerListElementWorkspace')].find((item) => item.id === args.objectId);
    const input = row?.querySelector('input.entryObjectNameWorkspace');
    if (!input || !input.getClientRects().length) throw new Error('OBJECT_NOT_VISIBLE_IN_EDITOR');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, args.newName);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
    for (let i = 0; i < 40; i++) {
      if (Entry.container.getObject(args.objectId)?.name === args.newName) {
        return { persisted: true, visibleName: input.value };
      }
      await pause(50);
    }
    throw new Error('RENAME_NOT_PERSISTED');
  }
  if (method === 'runStop') {
    stopped();
    const id = args.objectId || Entry.container.selectedObject?.id;
    const readX = () => {
      const row = id && [...document.querySelectorAll('li.entryContainerListElementWorkspace')].find((item) => item.id === id);
      return row?.querySelector('input.entryObjectCoordinateInputWorkspace')?.value ?? null;
    };
    const beforeX = readX();
    const run = document.querySelector('button.entryRunButtonWorkspace_w');
    if (!run || !run.getClientRects().length) throw new Error('RUN_BUTTON_NOT_VISIBLE');
    let duringX = null;
    try {
      run.click();
      await pause(args.durationMs);
      duringX = readX();
    } finally {
      const stop = document.querySelector('button.entryStopButtonWorkspace_w');
      if (stop?.getClientRects().length) stop.click();
      else if (Entry.engine.state !== 'stop') Entry.engine.toggleStop();
    }
    for (let i = 0; i < 40 && Entry.engine.state !== 'stop'; i++) await pause(50);
    stopped();
    return { objectId: id || null, x: { before: beforeX, running: duringX, stopped: readX() } };
  }
  throw new Error('UNKNOWN_ENTRY_ACTION');
  } catch (error) {
    return { __entryMcpError: String(error?.message || error) };
  }
}

async function handle(method, params) {
  const tabs = await editorTabs();
  if (method === 'tabs') return tabs.map(({ id, title, url }) => ({ tabId: id, title, url, selected: id === selectedTabId }));
  if (method === 'selectTab') {
    if (!tabs.some((tab) => tab.id === params.tabId)) throw new Error('ENTRY_TAB_NOT_FOUND');
    selectedTabId = params.tabId;
    return { tabId: selectedTabId };
  }
  if (selectedTabId && !tabs.some((tab) => tab.id === selectedTabId)) selectedTabId = undefined;
  if (!selectedTabId && tabs.length === 1) selectedTabId = tabs[0].id;
  if (!selectedTabId) throw new Error(`ENTRY_TAB_SELECTION_REQUIRED: ${tabs.length} tabs`);
  const result = await chrome.scripting.executeScript({
    target: { tabId: selectedTabId }, world: 'MAIN',
    func: ['hash','context','script','edit','control','state','preview','upload','upload_batch','upload_sound','undo','journal','diagnose_save','diagnose_run','perf'].includes(method) ? entryAuthoringAction : entryAction,
    args: [method, params],
  });
  const value = result[0]?.result;
  if (value === null || value === undefined) throw new Error('ENTRY_SCRIPT_NO_RESULT');
  if (value?.__entryMcpError) throw new Error(value.__entryMcpError);
  return value;
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  socket = new WebSocket(ADDRESS);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', token: self.ENTRY_MCP_PAIRING }));
  socket.onmessage = async ({ data }) => {
    let message;
    try { message = JSON.parse(data); }
    catch { return; }
    if (!Number.isInteger(message.id)) return;
    try {
      const result = await handle(message.method, message.params || {});
      socket.send(JSON.stringify({ id: message.id, ok: true, result }));
    } catch (error) {
      socket.send(JSON.stringify({ id: message.id, ok: false, error: String(error?.message || error) }));
    }
  };
  socket.onclose = () => { socket = undefined; setTimeout(connect, 5000); };
  socket.onerror = () => {};
}

chrome.alarms.create('entry-mcp-connect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'entry-mcp-connect') connect(); });
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url?.startsWith('https://playentry.org/ws/')) connect(); });
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' })); }, 20000);
connect();
