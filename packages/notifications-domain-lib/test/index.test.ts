'use strict';

import { before, describe, mock, test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  EventAggregate,
  IEventRepository,
  INotificationRepository,
  INotificationSenderService,
  NotificationAggregate,
  NotificationDomainService,
  NotificationStatus
} from '../src';
import { MockEventRepo, MockNotificationRepo } from './mocks';
import { MockNotificationSenderService } from './mocks/mock-notification-sender-service';

let notificationAggregate: NotificationAggregate;
let notificationRepository: INotificationRepository;

let eventAggregate: EventAggregate;
let eventRepository: IEventRepository;

let notificationDomainService: NotificationDomainService;
let notificationSenderService: INotificationSenderService;

before(async () => {
  notificationRepository = new MockNotificationRepo();
  eventRepository = new MockEventRepo();

  notificationSenderService = new MockNotificationSenderService();

  notificationAggregate = new NotificationAggregate(
    notificationRepository,
    notificationSenderService
  );
  eventAggregate = new EventAggregate(eventRepository);

  notificationDomainService = new NotificationDomainService(
    eventAggregate,
    notificationAggregate
  );
});

describe('notifications domain', async () => {
  test('create notification', async () => {
    const eventId = await notificationDomainService.createEvent('test', {});
    await notificationDomainService.createNotification(eventId);
  });

  describe('get notification', async () => {
    test('returns notification when exists', async () => {
      const eventId = await notificationDomainService.createEvent('test', {});
      const notificationId =
        await notificationDomainService.createNotification(eventId);

      const notification =
        await notificationDomainService.getNotification(notificationId);

      assert.ok(notification);
      assert.equal(notification.eventId, eventId);
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

  test('create event', async () => {
    const data = {
      name: 'test',
      value: 'test'
    };
    const eventId = await notificationDomainService.createEvent('test', data);

    const event = await notificationDomainService.getEvent(eventId);

    assert.ok(event);
    assert.equal(event.type, 'test');
    assert.deepEqual(event.data, data);
    assert.ok(event.id);
    assert.equal(event.type, 'test');
    assert.deepEqual(event.data, data);
    assert.ok(event.id);
  });

  describe('get event', async () => {
    test('returns event when exists', async () => {
      const data = {
        name: 'test',
        value: 'test'
      };
      const eventId = await notificationDomainService.createEvent('test', data);

      const event = await notificationDomainService.getEvent(eventId);

      assert.ok(event);
      assert.equal(event.type, 'test');
      assert.deepEqual(event.data, data);
      assert.ok(event.id);
    });

    test('returns null when event does not exist', async () => {
      const event =
        await notificationDomainService.getEvent('non-existing-event');

      assert.ok(event === null);
    });
  });

  describe('send notification', async () => {
    test('sends notification', async () => {
      const eventId = await notificationDomainService.createEvent('test', {});
      const notificationId =
        await notificationDomainService.createNotification(eventId);

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
      const eventId = await notificationDomainService.createEvent('test', {});
      const notificationId =
        await notificationDomainService.createNotification(eventId);
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
