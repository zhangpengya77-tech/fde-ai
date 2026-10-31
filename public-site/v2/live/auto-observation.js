(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FdeAutoObservation = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function createAutoObservationScheduler({
    intervalMs = 1000,
    captureAndSend,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    onMetrics = () => {},
    onResult = () => {},
    onError = () => {},
    clock = Date.now
  }) {
    let running = false;
    let inFlight = false;
    let timer = null;
    let generation = 0;
    let requestCount = 0;
    let skippedFrameCount = 0;
    let totalRoundTripMs = 0;
    let maxInFlight = 0;
    let errorCount = 0;

    function metrics() {
      return {
        running,
        inFlight,
        requestCount,
        skippedFrameCount,
        averageRoundTripMs: requestCount ? Number((totalRoundTripMs / requestCount).toFixed(1)) : 0,
        maxInFlight,
        errorCount,
        queueLength: 0
      };
    }

    function report() { onMetrics(metrics()); }

    function schedule(token) {
      if (!running || token !== generation || timer !== null) return;
      timer = setTimeoutImpl(() => {
        timer = null;
        tick();
      }, intervalMs);
    }

    async function tick() {
      const token = generation;
      if (!running) return false;
      if (inFlight) {
        skippedFrameCount += 1;
        report();
        schedule(token);
        return false;
      }
      inFlight = true;
      schedule(token);
      maxInFlight = Math.max(maxInFlight, 1);
      const started = clock();
      report();
      try {
        const value = await captureAndSend();
        requestCount += 1;
        totalRoundTripMs += Math.max(0, clock() - started);
        if (running && token === generation) onResult(value);
      } catch (error) {
        errorCount += 1;
        if (running && token === generation) onError(error);
      } finally {
        inFlight = false;
        report();
      }
      return true;
    }

    function start() {
      if (running) return false;
      running = true;
      generation += 1;
      schedule(generation);
      report();
      return true;
    }

    function stop() {
      if (!running && timer === null) return false;
      running = false;
      generation += 1;
      if (timer !== null) clearTimeoutImpl(timer);
      timer = null;
      report();
      return true;
    }

    return { start, stop, tick, getMetrics: metrics };
  }

  return { createAutoObservationScheduler };
});
