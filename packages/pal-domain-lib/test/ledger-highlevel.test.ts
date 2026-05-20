import { before, test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  CheckBalanceAndReserveTransferCmd,
  CommitTransferCmd,
  CreateLedgerCmd,
  LedgerAggregate,
  LedgerCreatedStateEvent,
  LedgerTransactionRecordedStateEvent,
  PostTransactionCmd,
  RejectTransferCmd,
  ReserveTransferCmd
} from '../src';
import { ConsoleLogger, DomainEvent } from 'common-types-lib';
import { MockMessageProducer, MockLedgerEventSourcingRepository } from './mocks';
import {
  LedgerCreatedEvent,
  LedgerTransactionPostedEvent,
  LedgerTransferCommitedEvent,
  LedgerTransferInsufficientFundsErrorEvent,
  LedgerTransferRejectedEvent,
  LedgerTransferReservedEvent
} from 'pal-public-types-lib';

let mockRepo: MockLedgerEventSourcingRepository;
let mockProducer: MockMessageProducer;
let aggregate: LedgerAggregate;

const EUR_LEDGER_ID = 'EUR';

const EUR_PAYER_CLEARING_ACCOUNT_ID = 'payerClearing';
const EUR_PAYER_LIQUIDITY_ACCOUNT_ID = 'payer_liquidity';
const EUR_PAYEE_CLEARING_ACCOUNT_ID = 'payeeClearing';
const EUR_SUSPENSE_ACCOUNT_ID = 'suspense';
const EUR_CASH_ACCOUNT_ID = 'cash';

const AMOUNT = BigInt(1000);

before(() => {
  mockRepo = new MockLedgerEventSourcingRepository();
  mockProducer = new MockMessageProducer();
  aggregate = new LedgerAggregate(mockRepo, mockProducer, new ConsoleLogger());

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Create ledger', async () => {
  const cmd: CreateLedgerCmd = new CreateLedgerCmd({ id: EUR_LEDGER_ID });

  await aggregate.processCommands(cmd);

  const lastEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  assert.ok(lastEvents.length > 0);
  assert.equal(
    lastEvents[lastEvents.length - 1].msgName,
    LedgerCreatedStateEvent.name
  );
  assert.equal(lastEvents[lastEvents.length - 1].aggregateId, EUR_LEDGER_ID);
  assert.equal(lastEvents[lastEvents.length - 1].aggregateVersion, '1');

  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.ok(lastDomainEvent);
  assert.equal(lastDomainEvent.msgName, LedgerCreatedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
});

test('PAL Ledger Domain HighLevel API - Check Balance And Reserve Transfer cmd should fail before deposit', async () => {
  const cmd: CheckBalanceAndReserveTransferCmd =
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req1',
      transactionId: '1',
      amount: AMOUNT.toString(),
      amountScale: 2,
      payerClearingAccountId: EUR_PAYER_CLEARING_ACCOUNT_ID,
      payerLiquidityAccountId: EUR_PAYER_LIQUIDITY_ACCOUNT_ID,
      suspenseAccountId: EUR_SUSPENSE_ACCOUNT_ID
    });

  await aggregate.processCommands(cmd);

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerTransferInsufficientFundsErrorEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.requestId, 'req1');
  assert.equal(lastDomainEvent.payload.transactionId, '1');
  assert.equal(lastDomainEvent.payload.isError, true);
});

test('PAL Ledger Domain HighLevel API - Deposit payer liquidity', async () => {
  const depositAmount = AMOUNT * BigInt(5);
  const cmd: PostTransactionCmd = new PostTransactionCmd(EUR_LEDGER_ID, {
    id: '1',
    amount: depositAmount.toString(),
    amountScale: 2,
    debitedAccountId: EUR_CASH_ACCOUNT_ID,
    creditedAccountId: EUR_PAYER_LIQUIDITY_ACCOUNT_ID
  });

  await aggregate.processCommands(cmd);

  const lastEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  assert.ok(lastEvents.length > 0);
  assert.equal(
    lastEvents[lastEvents.length - 1].msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastEvents[lastEvents.length - 1].aggregateId, EUR_LEDGER_ID);

  const [cashAcc, payerLiqAcc] = aggregate.getAccounts([
    EUR_CASH_ACCOUNT_ID,
    EUR_PAYER_LIQUIDITY_ACCOUNT_ID
  ]);
  assert.ok(cashAcc);
  assert.equal(cashAcc.id, EUR_CASH_ACCOUNT_ID);
  assert.ok(payerLiqAcc);
  assert.equal(payerLiqAcc.id, EUR_PAYER_LIQUIDITY_ACCOUNT_ID);

  assert.equal(cashAcc.debitedAmount, depositAmount);
  assert.equal(cashAcc.creditedAmount, BigInt(0));
  assert.equal(payerLiqAcc.debitedAmount, BigInt(0));
  assert.equal(payerLiqAcc.creditedAmount, depositAmount);

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(lastDomainEvent.msgName, LedgerTransactionPostedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.amount, depositAmount.toString());
  assert.equal(lastDomainEvent.payload.debitedAccountId, EUR_CASH_ACCOUNT_ID);
  assert.equal(
    lastDomainEvent.payload.creditedAccountId,
    EUR_PAYER_LIQUIDITY_ACCOUNT_ID
  );
});

test('PAL Ledger Domain HighLevel API - Check Balance And Reserve Transfer', async () => {
  const reqId = 'req1';
  const txId = '1';
  const cmd: CheckBalanceAndReserveTransferCmd =
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: reqId,
      transactionId: txId,
      amount: AMOUNT.toString(),
      amountScale: 2,
      payerClearingAccountId: EUR_PAYER_CLEARING_ACCOUNT_ID,
      payerLiquidityAccountId: EUR_PAYER_LIQUIDITY_ACCOUNT_ID,
      suspenseAccountId: EUR_SUSPENSE_ACCOUNT_ID
    });

  await aggregate.processCommands(cmd);

  const lastEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  assert.ok(lastEvents.length > 0);
  assert.equal(
    lastEvents[lastEvents.length - 1].msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastEvents[lastEvents.length - 1].aggregateId, EUR_LEDGER_ID);

  const [payerClearing, suspense] = aggregate.getAccounts([
    EUR_PAYER_CLEARING_ACCOUNT_ID,
    EUR_SUSPENSE_ACCOUNT_ID
  ]);

  assert.ok(payerClearing);
  assert.equal(payerClearing.id, EUR_PAYER_CLEARING_ACCOUNT_ID);

  assert.ok(suspense);
  assert.equal(suspense.id, EUR_SUSPENSE_ACCOUNT_ID);

  assert.equal(payerClearing.debitedAmount, AMOUNT);
  assert.equal(payerClearing.creditedAmount, BigInt(0));

  assert.equal(suspense.debitedAmount, BigInt(0));
  assert.equal(suspense.creditedAmount, AMOUNT);

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(lastDomainEvent.msgName, LedgerTransferReservedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transactionId, txId);
  assert.equal(lastDomainEvent.payload.isError, false);
});

test('PAL Ledger Domain HighLevel API - Commit Transfer', async () => {
  const reqId = 'req1';
  const txId = '1';

  const cmd: CommitTransferCmd = new CommitTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transactionId: txId,
    amount: AMOUNT.toString(),
    amountScale: 2,
    payerClearingAccountId: EUR_PAYER_CLEARING_ACCOUNT_ID,
    suspenseAccountId: EUR_SUSPENSE_ACCOUNT_ID,
    payeeClearingAccountId: EUR_PAYEE_CLEARING_ACCOUNT_ID
  });

  await aggregate.processCommands(cmd);

  const lastEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  assert.ok(lastEvents.length > 0);
  assert.equal(
    lastEvents[lastEvents.length - 1].msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastEvents[lastEvents.length - 1].aggregateId, EUR_LEDGER_ID);

  const [payerClearing, suspense, payeeClearing] = aggregate.getAccounts([
    EUR_PAYER_CLEARING_ACCOUNT_ID,
    EUR_SUSPENSE_ACCOUNT_ID,
    EUR_PAYEE_CLEARING_ACCOUNT_ID
  ]);

  assert.ok(payerClearing);
  assert.equal(payerClearing.id, EUR_PAYER_CLEARING_ACCOUNT_ID);

  assert.ok(suspense);
  assert.equal(suspense.id, EUR_SUSPENSE_ACCOUNT_ID);

  assert.ok(payeeClearing);
  assert.equal(payeeClearing.id, EUR_PAYEE_CLEARING_ACCOUNT_ID);

  assert.equal(payerClearing.debitedAmount, AMOUNT * BigInt(2)); //debited went up by amount twice
  assert.equal(payerClearing.creditedAmount, AMOUNT); //credited went up by amount once

  assert.equal(suspense.debitedAmount, AMOUNT);
  assert.equal(suspense.creditedAmount, AMOUNT);

  assert.equal(payeeClearing.debitedAmount, BigInt(0));
  assert.equal(payeeClearing.creditedAmount, AMOUNT);

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(lastDomainEvent.msgName, LedgerTransferCommitedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transactionId, txId);
  assert.equal(lastDomainEvent.payload.isError, false);
});

test('PAL Ledger Domain HighLevel API - Check Balance And Reserve Transfer to reject', async () => {
  const reqId = 'req1';
  const txId = '1';

  const cmd: CheckBalanceAndReserveTransferCmd =
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: reqId,
      transactionId: txId,
      amount: AMOUNT.toString(),
      amountScale: 2,
      payerClearingAccountId: EUR_PAYER_CLEARING_ACCOUNT_ID,
      payerLiquidityAccountId: EUR_PAYER_LIQUIDITY_ACCOUNT_ID,
      suspenseAccountId: EUR_SUSPENSE_ACCOUNT_ID
    });

  await aggregate.processCommands(cmd);

  const lastEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  assert.ok(lastEvents.length > 0);
  assert.equal(
    lastEvents[lastEvents.length - 1].msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastEvents[lastEvents.length - 1].aggregateId, EUR_LEDGER_ID);

  const [payerClearing, suspense] = aggregate.getAccounts([
    EUR_PAYER_CLEARING_ACCOUNT_ID,
    EUR_SUSPENSE_ACCOUNT_ID
  ]);

  assert.ok(payerClearing);
  assert.equal(payerClearing.id, EUR_PAYER_CLEARING_ACCOUNT_ID);

  assert.ok(suspense);
  assert.equal(suspense.id, EUR_SUSPENSE_ACCOUNT_ID);

  assert.equal(payerClearing.debitedAmount, AMOUNT * BigInt(3));
  assert.equal(payerClearing.creditedAmount, AMOUNT * BigInt(1));

  assert.equal(suspense.debitedAmount, AMOUNT * BigInt(1));
  assert.equal(suspense.creditedAmount, AMOUNT * BigInt(2));

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(lastDomainEvent.msgName, LedgerTransferReservedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transactionId, txId);
  assert.equal(lastDomainEvent.payload.isError, false);
});

test('PAL Ledger Domain HighLevel API - Reject Transfer', async () => {
  const reqId = 'req1';
  const txId = '1';
  const cmd: RejectTransferCmd = new RejectTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transactionId: txId,
    amount: AMOUNT.toString(),
    amountScale: 2,
    payerClearingAccountId: EUR_PAYER_CLEARING_ACCOUNT_ID,
    suspenseAccountId: EUR_SUSPENSE_ACCOUNT_ID
  });

  await aggregate.processCommands(cmd);

  const lastEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  assert.ok(lastEvents.length > 0);
  assert.equal(
    lastEvents[lastEvents.length - 1].msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastEvents[lastEvents.length - 1].aggregateId, EUR_LEDGER_ID);

  const [payerClearing, suspense, payeeClearing] = aggregate.getAccounts([
    EUR_PAYER_CLEARING_ACCOUNT_ID,
    EUR_SUSPENSE_ACCOUNT_ID,
    EUR_PAYEE_CLEARING_ACCOUNT_ID
  ]);

  assert.ok(payerClearing);
  assert.equal(payerClearing.id, EUR_PAYER_CLEARING_ACCOUNT_ID);

  assert.ok(suspense);
  assert.equal(suspense.id, EUR_SUSPENSE_ACCOUNT_ID);

  assert.ok(payeeClearing);
  assert.equal(payeeClearing.id, EUR_PAYEE_CLEARING_ACCOUNT_ID);

  assert.equal(payerClearing.debitedAmount, AMOUNT * BigInt(3)); //debited went up 3 times
  assert.equal(payerClearing.creditedAmount, AMOUNT * BigInt(2)); //credited went up 2 times

  assert.equal(suspense.debitedAmount, AMOUNT * BigInt(2)); //credited went up 2 times
  assert.equal(suspense.creditedAmount, AMOUNT * BigInt(2)); //credited went up 2 times

  assert.equal(payeeClearing.debitedAmount, BigInt(0)); // still the same
  assert.equal(payeeClearing.creditedAmount, AMOUNT); // still the same

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(lastDomainEvent.msgName, LedgerTransferRejectedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transactionId, txId);
  assert.equal(lastDomainEvent.payload.isError, false);
});

test('PAL Ledger Domain HighLevel API - Reserve Transfer', async () => {
  const reqId = 'req3';
  const txId = '1';
  const cmd: ReserveTransferCmd = new ReserveTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transactionId: txId,
    amount: AMOUNT.toString(),
    amountScale: 2,
    payerClearingAccountId: EUR_PAYER_CLEARING_ACCOUNT_ID,
    suspenseAccountId: EUR_SUSPENSE_ACCOUNT_ID
  });

  await aggregate.processCommands(cmd);

  const lastEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  assert.ok(lastEvents.length > 0);
  assert.equal(
    lastEvents[lastEvents.length - 1].msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastEvents[lastEvents.length - 1].aggregateId, EUR_LEDGER_ID);

  const [payerClearing, suspense, payeeClearing] = aggregate.getAccounts([
    EUR_PAYER_CLEARING_ACCOUNT_ID,
    EUR_SUSPENSE_ACCOUNT_ID,
    EUR_PAYEE_CLEARING_ACCOUNT_ID
  ]);

  assert.ok(payerClearing);
  assert.equal(payerClearing.id, EUR_PAYER_CLEARING_ACCOUNT_ID);

  assert.ok(suspense);
  assert.equal(suspense.id, EUR_SUSPENSE_ACCOUNT_ID);

  assert.ok(payeeClearing);
  assert.equal(payeeClearing.id, EUR_PAYEE_CLEARING_ACCOUNT_ID);

  assert.equal(payerClearing.debitedAmount, AMOUNT * BigInt(4)); //debited went up 4 times
  assert.equal(payerClearing.creditedAmount, AMOUNT * BigInt(2)); //credited went up 2 times

  assert.equal(suspense.debitedAmount, AMOUNT * BigInt(2)); //credited went up 2 times
  assert.equal(suspense.creditedAmount, AMOUNT * BigInt(3)); //credited went up 3 times

  assert.equal(payeeClearing.debitedAmount, BigInt(0)); // still the same
  assert.equal(payeeClearing.creditedAmount, AMOUNT); // still the same

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(lastDomainEvent.msgName, LedgerTransferReservedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transactionId, txId);
  assert.equal(lastDomainEvent.payload.isError, false);
});
