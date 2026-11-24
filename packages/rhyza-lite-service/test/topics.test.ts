import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { IKafkaAdmin } from 'implementations-lib';
import { LITE_TOPICS, ensureTopics } from '../src/topics';

type Topic = { topic: string; numPartitions: number; replicationFactor: number };

class FakeAdmin implements IKafkaAdmin {
  readonly calls: string[] = [];
  readonly created: Topic[] = [];
  readonly checked: string[][] = [];

  constructor(
    private readonly createError?: Error,
    private readonly allExist = false
  ) {}

  async connect(): Promise<void> {
    this.calls.push('connect');
  }
  async disconnect(): Promise<void> {
    this.calls.push('disconnect');
  }
  async createTopics(topics: Topic[]): Promise<void> {
    this.calls.push('createTopics');
    if (this.createError) throw this.createError;
    this.created.push(...topics);
  }
  async hasAllTopics(topics: string[]): Promise<boolean> {
    this.calls.push('hasAllTopics');
    this.checked.push(topics);
    return this.allExist;
  }
}

test('lite topics match init-kafka in docker-compose.yaml', () => {
  const compose = readFileSync(
    path.resolve(__dirname, '../../../docker/docker-compose.yaml'),
    'utf8'
  );
  const initKafka = compose.slice(
    compose.indexOf('\n  init-kafka:\n'),
    compose.indexOf('\n  redis:\n')
  );
  const expected = [
    ...initKafka.matchAll(/--create --if-not-exists(?: --partitions (\d+))? --topic (\S+)/g)
  ].map((m) => ({ topic: m[2], numPartitions: m[1] ? Number(m[1]) : 1 }));
  assert.ok(expected.length > 0);
  assert.deepEqual([...LITE_TOPICS], expected);
});

test('ensureTopics creates every topic with replication factor 1 and disconnects', async () => {
  const admin = new FakeAdmin();
  await ensureTopics(admin);
  assert.equal(admin.calls[0], 'connect');
  assert.deepEqual(
    admin.created,
    LITE_TOPICS.map((t) => ({ ...t, replicationFactor: 1 }))
  );
  assert.equal(admin.calls.at(-1), 'disconnect');
});

test('ensureTopics succeeds when topics already exist', async () => {
  const admin = new FakeAdmin(new Error('topic exists'), true);
  await ensureTopics(admin);
  assert.deepEqual(admin.checked, [LITE_TOPICS.map((t) => t.topic)]);
  assert.equal(admin.calls.at(-1), 'disconnect');
});

test('ensureTopics disconnects even when createTopics throws', async () => {
  const admin = new FakeAdmin(new Error('boom'), false);
  await assert.rejects(ensureTopics(admin), /boom/);
  assert.equal(admin.calls.at(-1), 'disconnect');
});
