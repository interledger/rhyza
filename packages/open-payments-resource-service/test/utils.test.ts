import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { allowEmptyJsonBody } from '../src/utils';

async function appWithEmptyJsonBody() {
  const app = Fastify();
  allowEmptyJsonBody(app);
  app.post('/echo', async (request) => ({
    hasBody: request.body !== undefined,
    body: request.body ?? null
  }));
  await app.ready();
  return app;
}

test('allowEmptyJsonBody leaves an empty JSON body undefined', async () => {
  const app = await appWithEmptyJsonBody();
  const res = await app.inject({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' }
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { hasBody: false, body: null });
});

test('allowEmptyJsonBody still parses a non-empty JSON body', async () => {
  const app = await appWithEmptyJsonBody();
  const res = await app.inject({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    payload: '{"a":1}'
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { hasBody: true, body: { a: 1 } });
});

test('allowEmptyJsonBody still rejects malformed JSON', async () => {
  const app = await appWithEmptyJsonBody();
  const res = await app.inject({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    payload: '{not json'
  });
  assert.equal(res.statusCode, 400);
});

test('allowEmptyJsonBody keeps prototype poisoning protection', async () => {
  const app = await appWithEmptyJsonBody();
  const res = await app.inject({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    payload: '{"__proto__":{"polluted":true}}'
  });
  assert.equal(res.statusCode, 400);
});
