'use strict';

import { after, before, describe, mock, test } from 'node:test';
import assert from 'node:assert';
import {
  INotification,
  Notification,
  NotificationOptions,
  NotificationStatus
} from '../src';
import { NotificationType } from '../dist';

describe('notification entity', () => {
  const id = crypto.randomUUID();
  const fixedDate = new Date('2026-01-01T12:00:00.000Z');
  const type = NotificationType.PaymentCreated;

  before(() => {
    mock.timers.enable({ apis: ['Date'] });
    mock.timers.setTime(fixedDate.getTime());
  });

  after(() => {
    mock.timers.reset();
  });
  describe('constructor', () => {
    test('should create an instance with default values', () => {
      const notification = new Notification(id, type);

      assert.strictEqual(notification.id, id);
      assert.strictEqual(notification.type, type);
      assert.deepStrictEqual(notification.data, {});
      assert.strictEqual(notification.attempts, 0);
      assert.strictEqual(notification.status, NotificationStatus.SENDING);
      assert.deepStrictEqual(notification.createdAt, fixedDate);
      assert.strictEqual(notification.sentAt, null);
      assert.strictEqual(notification.maxAttempts, 3);
    });

    test('should create an instance with provided options', () => {
      const customDate = new Date('2025-01-01T00:00:00.000Z');
      const options: NotificationOptions = {
        data: { userId: 456 },
        attempts: 2,
        status: NotificationStatus.PENDING_RETRY,
        createdAt: customDate,
        sentAt: customDate,
        maxAttempts: 5
      };

      const notification = new Notification(id, type, options);

      assert.deepStrictEqual(notification.data, { userId: 456 });
      assert.strictEqual(notification.attempts, 2);
      assert.strictEqual(notification.status, NotificationStatus.PENDING_RETRY);
      assert.deepStrictEqual(notification.createdAt, customDate);
      assert.deepStrictEqual(notification.sentAt, customDate);
      assert.strictEqual(notification.maxAttempts, 5);
    });
  });

  describe('methods', () => {
    test('should mark as sending', () => {
      const notification = new Notification(id, type);
      notification.markAsSending();
      assert.strictEqual(notification.status, NotificationStatus.SENDING);
    });

    test('should mark as sent and set sentAt to current date', () => {
      const notification = new Notification(id, type);

      notification.markAsSent();

      assert.strictEqual(notification.status, NotificationStatus.SENT);
      assert.deepStrictEqual(notification.sentAt, fixedDate);
    });

    test('should increment attempts by 1', () => {
      const notification = new Notification(id, type);

      assert.strictEqual(notification.attempts, 0);
      notification.incrementAttempts();
      assert.strictEqual(notification.attempts, 1);
    });

    test('should mark as PENDING_RETRY if attempts are less than maxAttempts', () => {
      const notification = new Notification(id, type, {
        attempts: 1,
        maxAttempts: 3
      });

      notification.markAsFailed();

      assert.strictEqual(notification.status, NotificationStatus.PENDING_RETRY);
    });

    test('should mark as FAILED if attempts equal or exceed maxAttempts', () => {
      const notification = new Notification(id, type, {
        attempts: 3,
        maxAttempts: 3
      });

      notification.markAsFailed();

      assert.strictEqual(notification.status, NotificationStatus.FAILED);
    });
  });

  test('should return a plain object representing the state', () => {
    const notification = new Notification(id, type);
    const obj = notification.toObject();

    assert.deepStrictEqual(obj, {
      id,
      type,
      data: {},
      attempts: 0,
      status: NotificationStatus.SENDING,
      maxAttempts: 3,
      createdAt: fixedDate,
      sentAt: null
    });
  });

  test('should create a valid class instance from a plain object', () => {
    const plainObj: INotification = {
      id,
      type,
      data: { paymentId: '123' },
      attempts: 1,
      status: NotificationStatus.PENDING_RETRY,
      maxAttempts: 5,
      createdAt: fixedDate,
      sentAt: null
    };

    const notification = Notification.fromObject(plainObj);

    assert.ok(notification instanceof Notification);
    assert.strictEqual(notification.id, id);
    assert.strictEqual(notification.type, type);
    assert.deepStrictEqual(notification.data, { paymentId: '123' });
    assert.strictEqual(notification.status, NotificationStatus.PENDING_RETRY);
    assert.strictEqual(notification.maxAttempts, 5);
  });
});
