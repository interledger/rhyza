import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PaymentIntentAggregate } from '../src/payment-intent/aggregate';
import {
  PaymentIntentCreatedEvent,
  PaymentIntentCreateFailedEvent
} from '../src/payment-intent/events';
import { CreatePaymentIntentCmd } from '../src/commands';
import { MockPaymentIntentRepo } from './mocks/mock-payment-intent-repo';
import { MockWalletAddressAdapter } from './mocks/mock-wallet-address-adapter';
import { IPaymentIntent } from '../src/payment-intent/interfaces';

function makeCmd(
  overrides: Partial<{
    id: string;
    receiverWalletAddressId: string;
    receiverWalletAddress: string;
    expiresAt: string;
    incomingAmount: number;
  }> = {}
): CreatePaymentIntentCmd {
  return new CreatePaymentIntentCmd(
    {
      id: overrides.id ?? crypto.randomUUID(),
      receiverWalletAddressId: overrides.receiverWalletAddressId ?? 'wallet-1',
      receiverWalletAddress:
        overrides.receiverWalletAddress ?? 'domain.com/alice',
      expiresAt: overrides.expiresAt,
      incomingAmount: overrides.incomingAmount
    },
    crypto.randomUUID()
  );
}

describe('PaymentIntentAggregate.handleBatch', () => {
  let repo: MockPaymentIntentRepo;
  let walletAddressAdapter: MockWalletAddressAdapter;
  let aggregate: PaymentIntentAggregate;

  beforeEach(() => {
    repo = new MockPaymentIntentRepo();
    walletAddressAdapter = new MockWalletAddressAdapter();
    walletAddressAdapter.addWalletAddress({
      id: 'wallet-1',
      isActive: true,
      assetCode: 'USD',
      assetScale: 2
    });
    aggregate = new PaymentIntentAggregate(repo, walletAddressAdapter);
  });

  describe('handleBatch', async () => {
    it('creates a payment intent', async () => {
      const cmd = makeCmd();
      const { events, updatedEntities } = await aggregate.handleBatch([cmd]);

      assert.equal(events.length, 1);
      assert.equal(events[0].msgName, PaymentIntentCreatedEvent.name);
      assert.equal(
        (events[0] as PaymentIntentCreatedEvent).payload.id,
        cmd.payload.id
      );
      assert.equal(updatedEntities.length, 1);
      assert.equal(updatedEntities[0].id, cmd.payload.id);
      assert.equal(updatedEntities[0].receiverWalletAddressId, 'wallet-1');
      assert.equal(
        updatedEntities[0].receiverWalletAddress,
        'domain.com/alice'
      );
      assert.equal(updatedEntities[0].assetCode, 'USD');
      assert.equal(updatedEntities[0].assetScale, 2);
      assert.equal(updatedEntities[0].state, 'CREATED');
    });

    it('rejects duplicate payment intent id', async () => {
      const id = crypto.randomUUID();
      const cmd1 = makeCmd({ id });
      const cmd2 = makeCmd({ id });
      const { events, updatedEntities } = await aggregate.handleBatch([
        cmd1,
        cmd2
      ]);

      assert.equal(events.length, 2);
      assert.equal(events[0].msgName, PaymentIntentCreatedEvent.name);
      assert.equal(events[1].msgName, PaymentIntentCreateFailedEvent.name);
      const payload = (events[1] as PaymentIntentCreateFailedEvent).payload;
      assert.equal(
        payload.errorName,
        'CannotCreateDuplicatePaymentIntentError'
      );

      assert.equal(updatedEntities.length, 1);
    });

    it('rejects when wallet address not found', async () => {
      const cmd = makeCmd({ receiverWalletAddressId: 'nonexistent' });
      const { events } = await aggregate.handleBatch([cmd]);

      assert.equal(events.length, 1);
      assert.equal(events[0].msgName, PaymentIntentCreateFailedEvent.name);
      const payload = (events[0] as PaymentIntentCreateFailedEvent).payload;
      assert.equal(payload.errorName, 'WalletAddressNotFoundError');
    });

    it('rejects when wallet address is inactive', async () => {
      walletAddressAdapter.addWalletAddress({
        id: 'inactive-wallet',
        isActive: false,
        assetCode: 'USD',
        assetScale: 2
      });
      const cmd = makeCmd({ receiverWalletAddressId: 'inactive-wallet' });
      const { events } = await aggregate.handleBatch([cmd]);

      assert.equal(events.length, 1);
      assert.equal(events[0].msgName, PaymentIntentCreateFailedEvent.name);
      const payload = (events[0] as PaymentIntentCreateFailedEvent).payload;
      assert.equal(payload.errorName, 'WalletAddressInactiveError');
    });

    it('rejects expiry in the past', async () => {
      const pastDate = new Date(Date.now() - 60_000).toISOString();
      const cmd = makeCmd({ expiresAt: pastDate });
      const { events } = await aggregate.handleBatch([cmd]);

      assert.equal(events.length, 1);
      assert.equal(events[0].msgName, PaymentIntentCreateFailedEvent.name);
      const payload = (events[0] as PaymentIntentCreateFailedEvent).payload;
      assert.equal(payload.errorName, 'InvalidPaymentIntentExpiryError');
      assert.match(payload.message, /future/);
    });

    it('rejects expiry too far in the future', async () => {
      const farFuture = new Date(
        Date.now() + 1000 * 60 * 60 * 24 * 31
      ).toISOString(); // 31 days
      const cmd = makeCmd({ expiresAt: farFuture });
      const { events } = await aggregate.handleBatch([cmd]);

      assert.equal(events.length, 1);
      assert.equal(events[0].msgName, PaymentIntentCreateFailedEvent.name);
      const payload = (events[0] as PaymentIntentCreateFailedEvent).payload;
      assert.equal(payload.errorName, 'InvalidPaymentIntentExpiryError');
      assert.match(payload.message, /30 days/);
    });
  });

  describe('flush', async () => {
    it('creates a payment intent', async () => {
      const paymentIntent: IPaymentIntent = {
        id: crypto.randomUUID(),
        receiverWalletAddressId: 'wallet-1',
        receiverWalletAddress: 'domain.com/alice',
        expiresAt: new Date(),
        state: 'CREATED',
        destination: 'LOCAL',
        assetCode: 'USD',
        assetScale: 2,
        receivedAmount: 0n,
        incomingAmount: null
      };
      await aggregate.flush([paymentIntent]);

      const stored = repo.getAll();
      assert.equal(stored.length, 1);
      assert.deepStrictEqual(stored[0], paymentIntent);
    });
  });
});
