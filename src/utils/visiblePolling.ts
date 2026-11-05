interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}
interface Clock {
  setTimeout(fn: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
}

// Each visible page requests the same shared feed. Hidden pages have no outstanding request or timer.
export function startVisiblePolling(
  task: (signal: AbortSignal) => Promise<number | void>,
  interval = 5000,
  visibility: VisibilitySource = document,
  clock: Clock = globalThis,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: AbortController | undefined;
  const pause = () => {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
    current?.abort(); current = undefined;
  };
  const run = async () => {
    if (stopped || visibility.hidden || current) return;
    const controller = new AbortController(); current = controller;
    let delay = interval;
    try { delay = Math.max(interval, await task(controller.signal) || interval); }
    catch { /* A later visible poll can recover; tasks present their own feed error. */ }
    finally {
      if (current === controller) {
        current = undefined;
        if (!stopped && !visibility.hidden) timer = clock.setTimeout(() => { timer = undefined; void run(); }, delay);
      }
    }
  };
  const changed = () => { pause(); if (!visibility.hidden) void run(); };
  visibility.addEventListener('visibilitychange', changed);
  if (!visibility.hidden) void run();
  return () => { stopped = true; pause(); visibility.removeEventListener('visibilitychange', changed); };
}
