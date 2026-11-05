import assert from 'node:assert/strict';
import test from 'node:test';
import { startVisiblePolling } from '../src/utils/visiblePolling';

function fixture(hidden = false) {
  const listeners = new Set<() => void>();
  const queued = new Map<number, { fn: () => void; delay: number }>(); let id = 0;
  const visibility = {
    hidden,
    addEventListener(_type: string, fn: () => void) { listeners.add(fn); },
    removeEventListener(_type: string, fn: () => void) { listeners.delete(fn); },
  };
  const clock = {
    setTimeout(fn: () => void, delay: number) { queued.set(++id, { fn, delay }); return id as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout(timer: ReturnType<typeof setTimeout>) { queued.delete(timer as unknown as number); },
  };
  return { visibility, clock, queued, change(hidden: boolean) { visibility.hidden = hidden; listeners.forEach(fn => fn()); } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('hidden tabs do not poll; visible tabs start immediately and stop on hide/cleanup', async () => {
  const f = fixture(true); let calls = 0;
  const stop = startVisiblePolling(async () => { calls++; }, 5000, f.visibility, f.clock);
  await settle(); assert.equal(calls, 0); assert.equal(f.queued.size, 0);
  f.change(false); await settle(); assert.equal(calls, 1);
  assert.equal([...f.queued.values()][0].delay, 5000);
  f.change(true); assert.equal(f.queued.size, 0);
  f.change(false); await settle(); assert.equal(calls, 2);
  stop(); assert.equal(f.queued.size, 0);
  f.change(false); await settle(); assert.equal(calls, 2);
});

test('hiding aborts an in-flight request and its late completion cannot create another timer', async () => {
  const f = fixture(); let signal: AbortSignal | undefined; let finish!: () => void;
  const stop = startVisiblePolling(async s => { signal = s; await new Promise<void>(resolve => { finish = resolve; }); }, 5000, f.visibility, f.clock);
  f.change(true); assert.equal(signal?.aborted, true);
  finish(); await settle(); assert.equal(f.queued.size, 0); stop();
});

test('provider backoff controls the next visible request', async () => {
  const f = fixture();
  const stop = startVisiblePolling(async () => 120000, 5000, f.visibility, f.clock);
  await settle(); assert.equal([...f.queued.values()][0].delay, 120000); stop();
});
