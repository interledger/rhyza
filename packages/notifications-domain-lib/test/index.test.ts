'use strict';

import { before, describe, mock, test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  INotificationRepository,
  INotificationSenderService,
  NotificationAggregate,
  NotificationDomainService,
  NotificationStatus
} from '../src';
import { MockNotificationRepo } from './mocks';
import { MockNotificationSenderService } from './mocks/mock-notification-sender-service';

let notificationAggregate: NotificationAggregate;
let notificationRepository: INotificationRepository;

let notificationDomainService: NotificationDomainService;
let notificationSenderService: INotificationSenderService;

before(async () => {
  notificationRepository = new MockNotificationRepo();

  notificationSenderService = new MockNotificationSenderService();

  notificationAggregate = new NotificationAggregate(
    notificationRepository,
    notificationSenderService
  );

  notificationDomainService = new NotificationDomainService(
    notificationAggregate
  );
});

describe('notifications domain', async () => {
  describe('get notification', async () => {
    test('returns notification when exists', async () => {
      const notificationId =
        await notificationDomainService.createAndSendNotification();

      const notification =
        await notificationDomainService.getNotification(notificationId);

      assert.ok(notification);
      assert.equal(notification.status, NotificationStatus.SENT);
      assert.equal(notification.attempts, 0);
      assert.ok(notification.id);
    });

    test('returns null when notification does not exist', async () => {
      const notification = await notificationDomainService.getNotification(
        'non-existing-notification'
      );

      assert.ok(notification === null);
    });
  });

  describe('create and send notification', async () => {
    test('sends notification', async () => {
      const notificationId =
        await notificationDomainService.createAndSendNotification();

      const sentNotification =
        await notificationDomainService.getNotification(notificationId);

      assert.ok(sentNotification);
      assert.equal(sentNotification.status, NotificationStatus.SENT);
    });

    test('fails when notification sender fails', async () => {
      const error = new Error('SMTP Timeout');
      mock.method(notificationSenderService, 'send', async () => {
        throw error;
      });
      await assert.rejects(
        notificationDomainService.createAndSendNotification(),
        error
      );

      const notifications = await notificationRepository.fetchAll();
      assert.ok(notifications);
      assert.equal(notifications.length, 3);

      const sentNotification = await notificationDomainService.getNotification(
        notifications[notifications.length - 1].id
      );
      assert.ok(sentNotification);
      assert.equal(sentNotification.status, NotificationStatus.FAILED);
    });
  });
});
