import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const PEER_ORIGIN = 'http://127.0.0.1';
const MiB = 1024 * 1024;
// ★체크포인트는 작품 전체를 한 메시지로 받는다. 상한은 큰 작품이 들어가되 문자열 한계보다는 작게 둔다.
const MAX_MESSAGE = Math.min(Math.max(Number(process.env.ENTRY_MCP_MAX_MESSAGE_MIB) || 256, 1), 384) * MiB;
const closeReason = (socket, limit) => socket.lastError?.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
  ? `BRIDGE_MESSAGE_TOO_LARGE: one bridge message exceeded ${Math.round(limit / MiB)} MiB; set ENTRY_MCP_MAX_MESSAGE_MIB higher and restart the MCP server`
  : 'BRIDGE_DISCONNECTED';

export class EntryBrowserBridge {
  constructor({ port = Number(process.env.ENTRY_MCP_BRIDGE_PORT || 9442), maxPayload = MAX_MESSAGE } = {}) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('BRIDGE_PORT_INVALID');
    this.port = port;
    this.maxPayload = maxPayload;
    this.pending = new Map();
    this.nextId = 1;
    this.queue = Promise.resolve();
  }

  async start() {
    if (this.server || this.peer?.readyState === WebSocket.OPEN) return this.port;
    if (this.starting) return this.starting;
    this.starting = this.startOnce().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  async startOnce() {
    this.secret ||= (await readFile(join(import.meta.dirname, 'pairing-secret'), 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/.test(this.secret)) throw new Error('BRIDGE_PAIRING_REQUIRED');
    const server = new WebSocketServer({ host: '127.0.0.1', port: this.port, maxPayload: this.maxPayload });
    server.on('connection', (socket, request) => this.accept(socket, request));
    try {
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      return this.connectPeer();
    }
    this.server = server;
    return server.address().port;
  }

  connectPeer() {
    return new Promise((resolve, reject) => {
      const peer = new WebSocket(`ws://127.0.0.1:${this.port}`, { origin: PEER_ORIGIN, maxPayload: this.maxPayload });
      let ready = false;
      const timer = setTimeout(() => { peer.terminate(); reject(new Error('BRIDGE_PEER_TIMEOUT')); }, 3000);
      peer.on('open', () => peer.send(JSON.stringify({ type: 'hello', role: 'peer', token: this.secret })));
      peer.on('message', (raw) => {
        let message;
        try { message = JSON.parse(raw.toString()); } catch { return; }
        if (!ready && message.type === 'ready') {
          ready = true;
          clearTimeout(timer);
          this.peer = peer;
          resolve(this.port);
        } else if (ready) this.receive(message);
      });
      peer.on('close', () => {
        if (!ready) { clearTimeout(timer); reject(new Error('BRIDGE_PEER_UNAVAILABLE')); }
        if (this.peer === peer) {
          this.peer = undefined;
          this.rejectPending(closeReason(peer, this.maxPayload));
        }
      });
      peer.on('error', (error) => { peer.lastError = error; if (!ready) { clearTimeout(timer); reject(error); } });
    });
  }

  accept(socket, request) {
    const origin = request.headers.origin || '';
    const isPeer = origin === PEER_ORIGIN;
    if (!isPeer && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      socket.close(1008, 'extension or local peer origin required');
      return;
    }
    let authenticated = false;
    // ★ws는 크기 초과 같은 수신 오류를 'error'로 알린 뒤 소켓을 닫는다. 듣는 쪽이 없으면 MCP 서버 프로세스가 통째로 끝난다.
    socket.on('error', (error) => { socket.lastError = error; });
    socket.on('message', async (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { socket.close(1003, 'invalid json'); return; }
      if (!authenticated) {
        if (message.type !== 'hello' || message.token !== this.secret || (message.role === 'peer') !== isPeer) {
          socket.close(1008, 'pairing failed');
          return;
        }
        authenticated = true;
        if (!isPeer) {
          if (this.client && this.client !== socket) this.client.close(1000, 'replaced');
          this.client = socket;
        }
        socket.send(JSON.stringify({ type: 'ready' }));
        return;
      }
      if (isPeer) {
        if (!Number.isInteger(message.id) || typeof message.method !== 'string') return;
        try {
          const result = await this.dispatch(message.method, message.params || {}, message.selectedTabId, message.timeoutMs);
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: message.id, ok: true, result }));
        } catch (error) {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: message.id, ok: false, error: String(error?.message || error) }));
        }
        return;
      }
      if (message.type !== 'ping') this.receive(message);
    });
    socket.on('close', () => {
      if (this.client !== socket) return;
      this.client = undefined;
      this.rejectPending(closeReason(socket, this.maxPayload));
    });
  }

  receive(message) {
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.ok) waiter.resolve(message.result);
    else waiter.reject(new Error(message.error || 'BRIDGE_COMMAND_FAILED'));
  }

  rejectPending(reason) {
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  send(socket, method, params, selectedTabId, timeoutMs, extraWaitMs = 0) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('BRIDGE_NOT_CONNECTED: install and enable the paired extension in your usual Chrome profile');
    }
    const id = this.nextId++;
    const wait = (Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 1000), 120000) : 15000) + extraWaitMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`BRIDGE_TIMEOUT: ${method}`));
      }, wait);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, selectedTabId, timeoutMs }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  dispatch(method, params, selectedTabId, timeoutMs) {
    const run = async () => {
      if (method === 'tabs') {
        const tabs = await this.send(this.client, 'tabs', {});
        return tabs.map((tab) => ({ ...tab, selected: tab.tabId === selectedTabId }));
      }
      if (method === 'selectTab') return this.send(this.client, method, params);
      let tabId = selectedTabId;
      if (!tabId) {
        const tabs = await this.send(this.client, 'tabs', {});
        if (tabs.length !== 1) throw new Error(`ENTRY_TAB_SELECTION_REQUIRED: ${tabs.length} tabs`);
        tabId = tabs[0].tabId;
      }
      await this.send(this.client, 'selectTab', { tabId });
      return this.send(this.client, method, params, undefined, timeoutMs);
    };
    const current = this.queue.then(run, run);
    this.queue = current.catch(() => {});
    return current;
  }

  async request(method, params = {}, { timeoutMs } = {}) {
    if (!this.server && this.peer?.readyState !== WebSocket.OPEN) await this.start();
    // ★공유 브리지를 거치면 앞 요청 줄을 기다리므로 피어 쪽은 주인보다 조금 더 기다려야 주인이 보낸 결과·시간 초과를 받는다.
    const result = this.server
      ? await this.dispatch(method, params, this.selectedTabId, timeoutMs)
      : await this.send(this.peer, method, params, this.selectedTabId, timeoutMs, timeoutMs ? 5000 : 0);
    if (method === 'selectTab') this.selectedTabId = result.tabId;
    if (method === 'tabs' && result.length === 1) {
      this.selectedTabId = result[0].tabId;
      result[0].selected = true;
    }
    return result;
  }

  async close() {
    this.peer?.close();
    this.client?.close();
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
  }
}
