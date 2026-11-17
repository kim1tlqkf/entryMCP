// 평소 크롬의 엔트리 탭에서 플레이 기록(읽기 전용)을 켜고 회수한다. 브리지 확장 0.4.4 이상이 필요하다.
// 사용: node perf.mjs tabs | node perf.mjs <탭번호> start [--no-functions] | node perf.mjs <탭번호> read [저장.json] | node perf.mjs <탭번호> stop
import { writeFile } from 'node:fs/promises';
import { EntryBrowserBridge } from './bridge_runtime.mjs';

const [first, action, out] = process.argv.slice(2);
const bridge = new EntryBrowserBridge();
try {
    if (first === 'tabs') {
        console.log(JSON.stringify(await bridge.request('tabs'), null, 1));
    } else {
        const tabId = Number(first);
        if (!Number.isInteger(tabId) || !['start', 'read', 'stop'].includes(action)) throw new Error('USAGE: node perf.mjs <tabId> start|read|stop');
        await bridge.request('selectTab', { tabId });
        const functions = !process.argv.includes('--no-functions');
        const result = await bridge.request('perf', { action, functions, raw: action === 'read' && Boolean(out) }, { timeoutMs: 60000 });
        if (action === 'read' && out) {
            await writeFile(out, JSON.stringify(result));
            console.log(JSON.stringify({ saved: out, summary: result.summary, engineState: result.engineState }));
        } else console.log(JSON.stringify(result));
    }
} catch (error) {
    console.log(JSON.stringify({ error: String(error?.message || error) }));
    process.exitCode = 1;
} finally {
    await bridge.close().catch(() => {});
}
