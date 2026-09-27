import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../cloudflare/dev-phase1a/worker.mjs';

test('health degrades gracefully when development live origin is unavailable', async () => {
  const response = await worker.fetch(
    new Request('https://dev.example.test/api/live/health'),
    { LIVE_ORIGIN_URL: 'https://live-dev.example.test' },
    { fetch: async () => { throw new Error('offline'); } }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'offline',
    components: { live_backend: 'offline', vision: 'unknown' }
  });
});

test('live snapshot is routed only to LIVE_ORIGIN_URL with path and body intact', async () => {
  let target;
  let forwardedBody;
  const response = await worker.fetch(
    new Request('https://dev.example.test/api/live/sessions/demo/snapshot?trace=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frame_id: 'one' })
    }),
    {
      LIVE_ORIGIN_URL: 'https://live-dev.example.test',
      ORIGIN_URL: 'https://production-must-not-be-used.example.test'
    },
    {
      fetch: async (request) => {
        target = request.url;
        forwardedBody = await request.text();
        return new Response(JSON.stringify({ detections: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }
  );

  assert.equal(response.status, 200);
  assert.equal(target, 'https://live-dev.example.test/api/live/sessions/demo/snapshot?trace=1');
  assert.equal(JSON.parse(forwardedBody).frame_id, 'one');
  assert.ok(!target.includes('production-must-not-be-used'));
});

test('non-live paths never fall through to a production origin', async () => {
  let called = false;
  const response = await worker.fetch(
    new Request('https://dev.example.test/student/'),
    { ORIGIN_URL: 'https://production-must-not-be-used.example.test' },
    { fetch: async () => { called = true; } }
  );

  assert.equal(response.status, 404);
  assert.equal(called, false);
});
