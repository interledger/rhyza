import { before, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { MockLedgerEventSourcingRepository, MockMessageProducer} from './mocks/';

import {
  CreateLedgerAccountsForPeerCmd,
  CreateLedgerCmd,
  LedgerAccountsCreatedStateEvent,
  LedgerAccountsCreatedStatePayload,
  LedgerAggregate,
  LedgerCreatedStateEvent,
  LedgerTransactionRecordedStateEvent,
  LedgerTransactionRecordedStatePayload,
  PostTransactionCmd
} from '../src';
import { ConsoleLogger, DomainEvent } from 'common-types-lib';
import {
  LedgerAccountsCreatedForPeerEvent,
  LedgerTransactionPostedEvent
} from 'pal-public-types-lib';

let mockRepo: MockLedgerEventSourcingRepository;
let mockProducer: MockMessageProducer;
let aggregate: LedgerAggregate;

let aggExpectedVersion = 0;

const EUR_LEDGER_ID = 'EUR';

const PEER_ONE_ID = 'peer1';
const PEER_ONE_LIQ_ACC_ID = 'peer1_liq_acc';
const PEER_ONE_CLE_ACC_ID = 'peer1_cle_acc';

const PEER_TWO_ID = 'peer2';
const PEER_TWO_LIQ_ACC_ID = 'peer2_liq_acc';
const PEER_TWO_CLE_ACC_ID = 'peer2_cle_acc';

before(() => {
  mockRepo = new MockLedgerEventSourcingRepository();
  mockProducer = new MockMessageProducer();
  aggregate = new LedgerAggregate(mockRepo, mockProducer, new ConsoleLogger());

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain LowLevel API - create ledger', async () => {
  const cmd: CreateLedgerCmd = new CreateLedgerCmd({ id: EUR_LEDGER_ID });

  await aggregate.processCommands(cmd);

  const stateEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  const lastStateEvent = stateEvents[stateEvents.length - 1];
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.msgName, LedgerCreatedStateEvent.name);
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(
    lastStateEvent.aggregateVersion,
    (++aggExpectedVersion).toString()
  );

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain LowLevel API - create ledger account for peer one', async () => {
  const cmd = new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
    liquidityAccountId: PEER_ONE_LIQ_ACC_ID,
    clearingAccountId: PEER_ONE_CLE_ACC_ID,
    peerId: PEER_ONE_ID,
    assetCode: EUR_LEDGER_ID
  });

  await aggregate.processCommands(cmd);

  const stateEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  const lastStateEvent = stateEvents[stateEvents.length - 1];
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.msgName, LedgerAccountsCreatedStateEvent.name);
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  const payload = lastStateEvent.payload as LedgerAccountsCreatedStatePayload;

  assert.ok(payload.accounts);
  assert.ok(payload.accounts.length == 2);

  // order is guaranteed
  const [liqAcc, cleAcc] = payload.accounts;
  assert.ok(liqAcc);
  assert.equal(liqAcc.id, PEER_ONE_LIQ_ACC_ID);
  assert.ok(liqAcc.name.includes(PEER_ONE_ID));
  assert.equal(liqAcc.assetCode, EUR_LEDGER_ID);
  assert.equal(liqAcc.assetDisplayScale, 2);
  assert.ok(cleAcc);
  assert.equal(cleAcc.id, PEER_ONE_CLE_ACC_ID);
  assert.ok(cleAcc.name.includes(PEER_ONE_ID));
  assert.equal(cleAcc.assetCode, EUR_LEDGER_ID);
  assert.equal(cleAcc.assetDisplayScale, 2);

  assert.equal(
    lastStateEvent.aggregateVersion,
    (++aggExpectedVersion).toString()
  );

  const accs = aggregate.getAccounts([liqAcc.id, cleAcc.id]);
  assert.ok(accs);
  assert.equal(accs.length, 2);
  assert.equal(accs[0].id, liqAcc.id);
  assert.equal(accs[0].creditedAmount, BigInt(0));
  assert.equal(accs[0].debitedAmount, BigInt(0));
  assert.equal(accs[1].id, cleAcc.id);
  assert.equal(accs[1].creditedAmount, BigInt(0));
  assert.equal(accs[1].debitedAmount, BigInt(0));

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as LedgerAccountsCreatedForPeerEvent;
  assert.equal(lastDomainEvent.msgName, LedgerAccountsCreatedForPeerEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.liquidityAccountId, PEER_ONE_LIQ_ACC_ID);
  assert.equal(lastDomainEvent.payload.clearingAccountId, PEER_ONE_CLE_ACC_ID);
  assert.equal(lastDomainEvent.payload.assetCode, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.peerId, PEER_ONE_ID);
});

test('PAL Ledger Domain LowLevel API - create a ledger account for peer two', async () => {
  const cmd = new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
    liquidityAccountId: PEER_TWO_LIQ_ACC_ID,
    clearingAccountId: PEER_TWO_CLE_ACC_ID,
    peerId: PEER_TWO_ID,
    assetCode: EUR_LEDGER_ID
  });

  await aggregate.processCommands(cmd);

  const stateEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  const lastStateEvent = stateEvents[stateEvents.length - 1];
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.msgName, LedgerAccountsCreatedStateEvent.name);
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  const payload = lastStateEvent.payload as LedgerAccountsCreatedStatePayload;

  assert.ok(payload.accounts);
  assert.ok(payload.accounts.length == 2);

  // order is guaranteed
  const [liqAcc, cleAcc] = payload.accounts;
  assert.ok(liqAcc);
  assert.equal(liqAcc.id, PEER_TWO_LIQ_ACC_ID);
  assert.ok(liqAcc.name.includes(PEER_TWO_ID));
  assert.equal(liqAcc.assetCode, EUR_LEDGER_ID);
  assert.equal(liqAcc.assetDisplayScale, 2);
  assert.ok(cleAcc);
  assert.equal(cleAcc.id, PEER_TWO_CLE_ACC_ID);
  assert.ok(cleAcc.name.includes(PEER_TWO_ID));
  assert.equal(cleAcc.assetCode, EUR_LEDGER_ID);
  assert.equal(cleAcc.assetDisplayScale, 2);

  assert.equal(
    lastStateEvent.aggregateVersion,
    (++aggExpectedVersion).toString()
  );

  const accs = aggregate.getAccounts([liqAcc.id, cleAcc.id]);
  assert.ok(accs);
  assert.equal(accs.length, 2);
  assert.equal(accs[0].id, liqAcc.id);
  assert.equal(accs[0].creditedAmount, BigInt(0));
  assert.equal(accs[0].debitedAmount, BigInt(0));
  assert.equal(accs[1].id, cleAcc.id);
  assert.equal(accs[1].creditedAmount, BigInt(0));
  assert.equal(accs[1].debitedAmount, BigInt(0));

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as LedgerAccountsCreatedForPeerEvent;
  assert.equal(lastDomainEvent.msgName, LedgerAccountsCreatedForPeerEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.liquidityAccountId, PEER_TWO_LIQ_ACC_ID);
  assert.equal(lastDomainEvent.payload.clearingAccountId, PEER_TWO_CLE_ACC_ID);
  assert.equal(lastDomainEvent.payload.assetCode, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.peerId, PEER_TWO_ID);
});

test('PAL Ledger Domain LowLevel API - post transaction between peers', async () => {
  const cmd: PostTransactionCmd = new PostTransactionCmd(EUR_LEDGER_ID, {
    id: '1',
    amount: '123',
    amountScale: 2,
    debitedAccountId: PEER_ONE_CLE_ACC_ID,
    creditedAccountId: PEER_TWO_CLE_ACC_ID
  });

  await aggregate.processCommands(cmd);

  const lastEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  assert.ok(lastEvents.length > 0);
  assert.equal(
    lastEvents[lastEvents.length - 1].msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastEvents[lastEvents.length - 1].aggregateId, EUR_LEDGER_ID);

  assert.equal(
    lastEvents[lastEvents.length - 1].aggregateVersion,
    (++aggExpectedVersion).toString()
  );

  const payload = lastEvents[lastEvents.length - 1]
    .payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.equal(payload.transaction.id, '1');
  assert.equal(payload.transaction.amount, '123');
  assert.equal(payload.transaction.amountScale, 2);
  assert.equal(payload.transaction.debitedAccountId, PEER_ONE_CLE_ACC_ID);
  assert.equal(payload.transaction.creditedAccountId, PEER_TWO_CLE_ACC_ID);

  const [debitedAcc, creditedAcc] = aggregate.getAccounts([
    PEER_ONE_CLE_ACC_ID,
    PEER_TWO_CLE_ACC_ID
  ]);
  assert.ok(debitedAcc);
  assert.ok(creditedAcc);

  assert.equal(debitedAcc.id, PEER_ONE_CLE_ACC_ID);
  assert.equal(creditedAcc.id, PEER_TWO_CLE_ACC_ID);
  assert.equal(debitedAcc.creditedAmount, BigInt(0));
  assert.equal(debitedAcc.debitedAmount, BigInt(123));
  assert.equal(creditedAcc.creditedAmount, BigInt(123));
  assert.equal(creditedAcc.debitedAmount, BigInt(0));

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(lastDomainEvent.msgName, LedgerTransactionPostedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.id, '1');
  assert.equal(lastDomainEvent.payload.amount, '123');
  assert.equal(lastDomainEvent.payload.debitedAccountId, PEER_ONE_CLE_ACC_ID);
  assert.equal(lastDomainEvent.payload.creditedAccountId, PEER_TWO_CLE_ACC_ID);
});
