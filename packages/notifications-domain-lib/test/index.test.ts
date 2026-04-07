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
  test('create notification', async () => {
    await notificationDomainService.createNotification();
  });

  describe('get notification', async () => {
    test('returns notification when exists', async () => {
      const notificationId =
        await notificationDomainService.createNotification();

      const notification =
        await notificationDomainService.getNotification(notificationId);

      assert.ok(notification);
      assert.equal(notification.status, NotificationStatus.CREATED);
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

  describe('send notification', async () => {
    test('sends notification', async () => {
      const notificationId =
        await notificationDomainService.createNotification();

      await notificationDomainService.sendNotification(notificationId);
      const sentNotification =
        await notificationDomainService.getNotification(notificationId);

      assert.ok(sentNotification);
      assert.equal(sentNotification.status, NotificationStatus.SENT);
    });

    test('fails when notification does not exist', async () => {
      await assert.rejects(
        notificationDomainService.sendNotification('invalid-id')
      );
    });

    test('fails when notification sender fails', async () => {
      const notificationId =
        await notificationDomainService.createNotification();
      const error = new Error('SMTP Timeout');
      mock.method(notificationSenderService, 'send', async () => {
        throw error;
      });
      await assert.rejects(
        notificationDomainService.sendNotification(notificationId),
        error
      );

      const sentNotification =
        await notificationDomainService.getNotification(notificationId);
      assert.ok(sentNotification);
      assert.equal(sentNotification.status, NotificationStatus.FAILED);
    });
  });
});
