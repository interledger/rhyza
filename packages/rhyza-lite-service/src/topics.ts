import type { ILogger } from 'common-types-lib';
import type { IKafkaAdmin } from 'implementations-lib';

// Keep in sync with the `init-kafka` service in docker/docker-compose.yaml
// (same topics, same order, partition counts as the broker default when unset).
export const LITE_TOPICS: readonly { readonly topic: string; readonly numPartitions: number }[] = [
  { topic: 'audits', numPartitions: 1 },
  { topic: 'logs', numPartitions: 1 },
  { topic: 'payment-commands', numPartitions: 3 },
  { topic: 'payment-domain-events', numPartitions: 3 },
  { topic: 'asset-domain-events', numPartitions: 3 },
  { topic: 'peer-domain-events', numPartitions: 3 },
  { topic: 'ledger-commands', numPartitions: 3 },
  { topic: 'ledger-domain-events', numPartitions: 3 },
  { topic: 'ledger-snapshot-events', numPartitions: 3 },
  { topic: 'ledger-state-events', numPartitions: 3 },
  { topic: 'ledger-timer-events', numPartitions: 3 },
  { topic: 'wallet-address-domain-events', numPartitions: 3 },
  { topic: 'fxrate-domain-events', numPartitions: 3 },
  { topic: 'ilp-domain-events', numPartitions: 3 },
  { topic: 'ilp-commands', numPartitions: 3 },
  { topic: 'ilp-connector-commands', numPartitions: 3 },
  { topic: 'notification-commands', numPartitions: 3 },
  { topic: 'auth-commands', numPartitions: 3 },
  { topic: 'auth-domain-events', numPartitions: 3 }
];

export async function ensureTopics(admin: IKafkaAdmin, logger?: ILogger): Promise<void> {
  await admin.connect();
  try {
    try {
      await admin.createTopics(LITE_TOPICS.map((t) => ({ ...t, replicationFactor: 1 })));
    } catch (error) {
      // createTopics fails when topics exist (e.g. restart against a persisted broker)
      if (!(await admin.hasAllTopics(LITE_TOPICS.map((t) => t.topic)))) throw error;
      logger?.info('Kafka topics already exist');
    }
  } finally {
    await admin.disconnect();
  }
}
