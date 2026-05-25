'use strict';

import { afterEach, describe, mock, test } from 'node:test';
import { NotificationAggregate, NotificationStatus } from '../src';
import { MockNotificationRepo } from './mocks';
import { MockNotificationSenderService } from './mocks/mock-notification-sender-service';
import assert from 'node:assert';

const notificationRepository = new MockNotificationRepo();
const notificationSenderService = new MockNotificationSenderService();
const notificationAggregate = new NotificationAggregate(
  notificationRepository,
  notificationSenderService
);

describe('notification aggregate', () => {
  afterEach(() => {
    notificationRepository.clear();
    mock.restoreAll();
  });

  const data = {};

  describe('create and send notification', () => {
    test('creates and sends notification successfully', async () => {
      const notificationId =
        await notificationAggregate.createAndSendNotification(data);
      assert.ok(notificationId);
    });

    test('fails when notification sender fails', async () => {
      const error = new Error('SMTP Timeout');
      mock.method(notificationSenderService, 'send', async () => {
        throw error;
      });
      await assert.rejects(
        () => notificationAggregate.createAndSendNotification(data),
        error
      );

      const notifications = await notificationRepository.fetchAll();
      assert.ok(notifications);
      assert.equal(notifications.length, 1);

      const sentNotification = await notificationRepository.fetch(
        notifications[0].id
      );
      assert.ok(sentNotification);
      assert.equal(sentNotification.status, NotificationStatus.FAILED);
      assert.ok(!sentNotification.sentAt);
    });
  });
});
