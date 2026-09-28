const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutoObservationScheduler } = require('./auto-observation.js');

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('defaults to 1 FPS and starts and stops one timer', () => {
  const scheduled = [];
  const cleared = [];
  const scheduler = createAutoObservationScheduler({
    captureAndSend: async () => ({}),
    setTimeoutImpl: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; },
    clearTimeoutImpl: (id) => cleared.push(id)
  });
  scheduler.start();
  assert.equal(scheduled[0].ms, 1000);
  scheduler.stop();
  assert.deepEqual(cleared, [1]);
  assert.equal(scheduler.getMetrics().running, false);
});

test('one-in-flight drops busy ticks without queueing requests', async () => {
  const pending = deferred();
  let calls = 0;
  const scheduler = createAutoObservationScheduler({
    captureAndSend: () => { calls += 1; return pending.promise; },
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {}
  });
  scheduler.start();
  const first = scheduler.tick();
  await scheduler.tick();
  assert.equal(calls, 1);
  assert.equal(scheduler.getMetrics().skippedFrameCount, 1);
  assert.equal(scheduler.getMetrics().maxInFlight, 1);
  assert.equal(scheduler.getMetrics().queueLength, 0);
  pending.resolve({ frame: 'latest' });
  await first;
  assert.equal(scheduler.getMetrics().requestCount, 1);
});

test('stop ignores stale completion and prevents reschedule', async () => {
  const pending = deferred();
  const scheduled = [];
  const results = [];
  const scheduler = createAutoObservationScheduler({
    captureAndSend: () => pending.promise,
    setTimeoutImpl: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; },
    clearTimeoutImpl: () => {},
    onResult: (value) => results.push(value)
  });
  scheduler.start();
  const request = scheduler.tick();
  scheduler.stop();
  pending.resolve({ stale: true });
  await request;
  assert.deepEqual(results, []);
  assert.equal(scheduler.getMetrics().running, false);
});

test('each completed tick captures current latest frame', async () => {
  let current = 0;
  const seen = [];
  const scheduler = createAutoObservationScheduler({
    captureAndSend: async () => { current += 1; seen.push(current); return current; },
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {}
  });
  scheduler.start();
  await scheduler.tick();
  await scheduler.tick();
  assert.deepEqual(seen, [1, 2]);
});
