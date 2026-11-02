import { afterEach, describe, mock, test } from 'node:test';
import {
  NotificationAggregate,
  NotificationStatus,
  NotificationType
} from '../src';
import { NullLogger } from 'common-types-lib';
import { MockNotificationRepo } from './mocks';
import { MockNotificationSenderService } from './mocks/mock-notification-sender-service';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert';

const notificationRepository = new MockNotificationRepo();
const notificationSenderService = new MockNotificationSenderService();
const notificationAggregate = new NotificationAggregate(
  notificationRepository,
  notificationSenderService,
  new NullLogger()
);

describe('notification aggregate', () => {
  afterEach(() => {
    notificationRepository.clear();
    mock.restoreAll();
  });

  const id = randomUUID();
  const type = NotificationType.PaymentCreated;
  const data = {};

  test('creates and sends notification successfully', async () => {
    const notification = await notificationAggregate.createAndSendNotification(
      id,
      type,
      data
    );
    assert.equal(notification.id, id);
    assert.equal(notification.status, NotificationStatus.SENT);
    assert.equal(notification.attempts, 1);
    assert.ok(notification.sentAt);
  });

  describe('retry notification', () => {
    test('throws error if notification is not found in repository', async () => {
      mock.method(notificationRepository, 'get', async () => null);

      await assert.rejects(
        async () => notificationAggregate.retryNotification(id),
        { message: `Notification not found: ${id}` }
      );
    });

    test('logs error and does not send if status is not PENDING_RETRY', async () => {
      mock.method(notificationRepository, 'get', async () => ({
        id,
        type,
        data,
        status: NotificationStatus.SENT,
        attempts: 1
      }));

      let sendCalls = 0;
      mock.method(notificationSenderService, 'send', async () => {
        sendCalls++;
      });

      await notificationAggregate.retryNotification(id);

      assert.equal(sendCalls, 0);
    });

    test('resends notification if status is PENDING_RETRY', async () => {
      mock.method(notificationRepository, 'get', async () => ({
        id,
        type,
        data,
        status: NotificationStatus.PENDING_RETRY,
        attempts: 1
      }));

      let storeCalls = 0;
      mock.method(notificationRepository, 'store', async () => {
        storeCalls++;
      });

      let sendCalls = 0;
      mock.method(notificationSenderService, 'send', async () => {
        sendCalls++;
      });

      await notificationAggregate.retryNotification(id);

      assert.equal(sendCalls, 1);
      assert.ok(storeCalls > 0);
    });
  });
});
