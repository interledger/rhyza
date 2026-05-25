import { before, test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MockLedgerEventSourcingRepository,
  MockMessageProducer
} from './mocks/';

import {
  CheckBalanceAndReserveTransferCmd,
  CommitTransferCmd,
  CreateLedgerAccountForAssetCmd,
  CreateLedgerAccountsForPeerCmd,
  CreateLedgerCmd,
  IPalPeerAccounts,
  LedgerAccountsCreatedStateEvent,
  LedgerAccountsCreatedStatePayload,
  LedgerAggregate,
  LedgerCreatedStateEvent,
  LedgerTransactionRecordedStateEvent,
  PostTransactionCmd,
  RejectTransferCmd,
  ReserveTransferCmd
} from '../src';
import { ConsoleLogger, DomainEvent } from 'common-types-lib';
import {
  LedgerAccountsCreatedForPeerEvent,
  LedgerTransactionPostedEvent,
  LedgerTransferCommitedEvent,
  LedgerTransferInsufficientFundsErrorEvent,
  LedgerTransferRejectedEvent,
  LedgerTransferReservedEvent
} from 'pal-public-types-lib';
import { LedgerAccountCreatedForAssetEvent } from 'pal-public-types-lib/dist';

let mockRepo: MockLedgerEventSourcingRepository;
let mockProducer: MockMessageProducer;
let aggregate: LedgerAggregate;

let aggExpectedVersion = 0;

const EUR_LEDGER_ID = 'EUR';
const PEER_ONE_ID = 'peer1';
const AMOUNT = BigInt(1000);

const assetSystemAccId = crypto.randomUUID();

const peerOneAccounts: IPalPeerAccounts = {
  peerLiquidityAccId: 'peerLiquidityAccId',
  peerClearingAccId: 'peerClearingAccId',
  aseLiquidityAccId: 'aseLiquidityAccId',
  aseClearingAccId: 'aseClearingAccId',
  suspenseAccId: 'suspenseAccId'
};

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

test('PAL Ledger Domain LowLevel API - create ledger account for asset', async () => {
  const cmd = new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
    id: assetSystemAccId,
    assetCode: EUR_LEDGER_ID
  });

  await aggregate.processCommands(cmd);

  const stateEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  const lastStateEvent = stateEvents.at(-1) as LedgerAccountsCreatedStateEvent;

  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.msgName, LedgerAccountsCreatedStateEvent.name);
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  assert.ok(lastStateEvent.payload.accounts);
  assert.equal(lastStateEvent.payload.accounts[0].assetCode, EUR_LEDGER_ID);
  assert.equal(lastStateEvent.payload.accounts[0].id, assetSystemAccId);

  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.ok(lastDomainEvent);
  assert.equal(lastDomainEvent.msgName, LedgerAccountCreatedForAssetEvent.name);
  const fetchedAccounts = aggregate.getAccounts([assetSystemAccId]);
  assert.ok(fetchedAccounts.length === 1);
  assert.ok(fetchedAccounts[0].id === assetSystemAccId);

  assert.equal(
    lastStateEvent.aggregateVersion,
    (++aggExpectedVersion).toString()
  );
  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain LowLevel API - create ledger account for peer one', async () => {
  const cmd = new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
    ...peerOneAccounts,
    peerId: PEER_ONE_ID,
    assetCode: EUR_LEDGER_ID
  });

  await aggregate.processCommands(cmd);

  const stateEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  const lastStateEvent = stateEvents.at(-1);
  assert.ok(lastStateEvent);

  assert.equal(
    lastStateEvent.aggregateVersion,
    (++aggExpectedVersion).toString()
  );

  assert.equal(lastStateEvent.msgName, LedgerAccountsCreatedStateEvent.name);
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  const payload = lastStateEvent.payload as LedgerAccountsCreatedStatePayload;

  assert.ok(payload.accounts);
  const payloadAccounts = payload.accounts;
  assert.ok(payloadAccounts.length == 5);

  // get the accounts from the aggregate
  const ids = Object.values(peerOneAccounts);
  const fetchedAccounts = aggregate.getAccounts(ids);
  ids.forEach((id) => {
    const payloadAccount = payloadAccounts.find((acc) => acc.id === id);
    assert.ok(payloadAccount);
    const fetchedAccount = fetchedAccounts.find((acc) => acc.id === id);
    assert.ok(fetchedAccount);

    assert.ok(payloadAccount.name.includes(PEER_ONE_ID));
    assert.equal(payloadAccount.assetCode, EUR_LEDGER_ID);
    assert.equal(payloadAccount.assetDisplayScale, 2);
    assert.equal(payloadAccount.debitedAmount, '0');
    assert.equal(payloadAccount.creditedAmount, '0');

    assert.equal(payloadAccount.name, fetchedAccount.name);
    assert.equal(payloadAccount.assetCode, fetchedAccount.assetCode);
    assert.equal(
      payloadAccount.assetDisplayScale,
      fetchedAccount.assetDisplayScale
    );
    assert.equal(
      payloadAccount.debitedAmount,
      fetchedAccount.debitedAmount.toString()
    );
    assert.equal(
      payloadAccount.creditedAmount,
      fetchedAccount.creditedAmount.toString()
    );
  });

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(
    -1
  ) as LedgerAccountsCreatedForPeerEvent;
  assert.equal(lastDomainEvent.msgName, LedgerAccountsCreatedForPeerEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
});

/*

test('PAL Ledger Domain LowLevel API - create a ledger account for peer two', async () => {
  const cmd = new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
    ...peerTwoAccounts,
    peerId: PEER_TWO_ID,
    assetCode: EUR_LEDGER_ID
  });

  await aggregate.processCommands(cmd);

  const stateEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  const lastStateEvent = stateEvents.at(-1);
  assert.ok(lastStateEvent);

  assert.equal(
    lastStateEvent.aggregateVersion,
    (++aggExpectedVersion).toString()
  );

  assert.equal(lastStateEvent.msgName, LedgerAccountsCreatedStateEvent.name);
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  const payload = lastStateEvent.payload as LedgerAccountsCreatedStatePayload;

  assert.ok(payload.accounts);
  const payloadAccounts = payload.accounts;
  assert.ok(payloadAccounts.length == 5);

  // get the accounts from the aggregate
  const ids =  Object.values(peerTwoAccounts);
  const fetchedAccounts = aggregate.getAccounts(ids);
  ids.forEach((id) => {
    const payloadAccount = payloadAccounts.find((acc) => acc.id === id);
    assert.ok(payloadAccount);
    const fetchedAccount = fetchedAccounts.find((acc) => acc.id === id);
    assert.ok(fetchedAccount);

    assert.ok(payloadAccount.name.includes(PEER_TWO_ID));
    assert.equal(payloadAccount.assetCode, EUR_LEDGER_ID);
    assert.equal(payloadAccount.assetDisplayScale, 2);
    assert.equal(payloadAccount.debitedAmount, "0");
    assert.equal(payloadAccount.creditedAmount, "0");

    assert.equal(payloadAccount.name, fetchedAccount.name);
    assert.equal(payloadAccount.assetCode, fetchedAccount.assetCode);
    assert.equal(payloadAccount.assetDisplayScale, fetchedAccount.assetDisplayScale);
    assert.equal(payloadAccount.debitedAmount, fetchedAccount.debitedAmount.toString());
    assert.equal(payloadAccount.creditedAmount, fetchedAccount.creditedAmount.toString());
  });

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as LedgerAccountsCreatedForPeerEvent;
  assert.equal(lastDomainEvent.msgName, LedgerAccountsCreatedForPeerEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
});


test.skip('PAL Ledger Domain LowLevel API - post transaction between peers', async () => {
  const strAmount = AMOUNT.toString();
  const cmd: PostTransactionCmd = new PostTransactionCmd(EUR_LEDGER_ID, {
    id: '1',
    amount:strAmount,
    amountScale: 2,
    debitedAccountId: peerOneAccounts.peerClearingAccId,
    creditedAccountId: peerTwoAccounts.peerClearingAccId
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
  assert.equal(payload.transaction.amount,strAmount);
  assert.equal(payload.transaction.amountScale, 2);
  assert.equal(payload.transaction.debitedAccountId, peerOneAccounts.peerClearingAccId);
  assert.equal(payload.transaction.creditedAccountId, peerTwoAccounts.peerClearingAccId);

  const [debitedAcc, creditedAcc] = aggregate.getAccounts([
    peerOneAccounts.peerClearingAccId,
    peerTwoAccounts.peerClearingAccId
  ]);
  assert.ok(debitedAcc);
  assert.ok(creditedAcc);

  assert.equal(debitedAcc.id, peerOneAccounts.peerClearingAccId);
  assert.equal(creditedAcc.id, peerTwoAccounts.peerClearingAccId);
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
  assert.equal(lastDomainEvent.payload.amount,strAmount);
  assert.equal(lastDomainEvent.payload.debitedAccountId, peerOneAccounts.peerClearingAccId);
  assert.equal(lastDomainEvent.payload.creditedAccountId, peerTwoAccounts.peerClearingAccId);

  assert.ok(aggregate.verify());
});
*/

/*
 * High Level API Calls
 * */

test('PAL Ledger Domain HighLevel API - Check Balance And Reserve Transfer cmd should fail before deposit', async () => {
  const cmd: CheckBalanceAndReserveTransferCmd =
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req1',
      transactionId: '1',
      amount: AMOUNT.toString(),
      amountScale: 2,
      payerClearingAccountId: peerOneAccounts.peerClearingAccId,
      payerLiquidityAccountId: peerOneAccounts.peerLiquidityAccId,
      suspenseAccountId: peerOneAccounts.suspenseAccId
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
    debitedAccountId: assetSystemAccId,
    creditedAccountId: peerOneAccounts.aseLiquidityAccId
  });

  await aggregate.processCommands(cmd);

  const lastEvents = await mockRepo.fetchStateEvents(EUR_LEDGER_ID);
  assert.ok(lastEvents.length > 0);
  assert.equal(
    lastEvents[lastEvents.length - 1].msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastEvents[lastEvents.length - 1].aggregateId, EUR_LEDGER_ID);

  const [assetSystemAcc, peerLiquidityAcc] = aggregate.getAccounts([
    assetSystemAccId,
    peerOneAccounts.aseLiquidityAccId
  ]);
  assert.ok(assetSystemAcc);
  assert.equal(assetSystemAcc.id, assetSystemAccId);
  assert.ok(peerLiquidityAcc);
  assert.equal(peerLiquidityAcc.id, peerOneAccounts.aseLiquidityAccId);

  assert.equal(assetSystemAcc.debitedAmount, depositAmount);
  assert.equal(assetSystemAcc.creditedAmount, BigInt(0));
  assert.equal(peerLiquidityAcc.debitedAmount, BigInt(0));
  assert.equal(peerLiquidityAcc.creditedAmount, depositAmount);

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(lastDomainEvent.msgName, LedgerTransactionPostedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.amount, depositAmount.toString());
  assert.equal(lastDomainEvent.payload.debitedAccountId, assetSystemAccId);
  assert.equal(
    lastDomainEvent.payload.creditedAccountId,
    peerOneAccounts.aseLiquidityAccId
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
      payerClearingAccountId: peerOneAccounts.aseClearingAccId,
      payerLiquidityAccountId: peerOneAccounts.aseLiquidityAccId,
      suspenseAccountId: peerOneAccounts.suspenseAccId
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
    peerOneAccounts.aseClearingAccId,
    peerOneAccounts.suspenseAccId
  ]);

  assert.ok(payerClearing);
  assert.equal(payerClearing.id, peerOneAccounts.aseClearingAccId);

  assert.ok(suspense);
  assert.equal(suspense.id, peerOneAccounts.suspenseAccId);

  assert.equal(payerClearing.debitedAmount, AMOUNT);
  assert.equal(payerClearing.creditedAmount, BigInt(0));

  assert.equal(suspense.debitedAmount, BigInt(0));
  assert.equal(suspense.creditedAmount, AMOUNT);

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
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
    payerClearingAccountId: peerOneAccounts.aseClearingAccId,
    suspenseAccountId: peerOneAccounts.suspenseAccId,
    payeeClearingAccountId: peerOneAccounts.peerClearingAccId
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
    peerOneAccounts.aseClearingAccId,
    peerOneAccounts.suspenseAccId,
    peerOneAccounts.peerClearingAccId
  ]);

  assert.ok(payerClearing);
  assert.equal(payerClearing.id, peerOneAccounts.aseClearingAccId);

  assert.ok(suspense);
  assert.equal(suspense.id, peerOneAccounts.suspenseAccId);

  assert.ok(payeeClearing);
  assert.equal(payeeClearing.id, peerOneAccounts.peerClearingAccId);

  assert.equal(payerClearing.debitedAmount, AMOUNT * BigInt(2)); //debited went up by amount twice
  assert.equal(payerClearing.creditedAmount, AMOUNT); //credited went up by amount once

  assert.equal(suspense.debitedAmount, AMOUNT);
  assert.equal(suspense.creditedAmount, AMOUNT);

  assert.equal(payeeClearing.debitedAmount, BigInt(0));
  assert.equal(payeeClearing.creditedAmount, AMOUNT);

  assert.ok(aggregate.verify());

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
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
      payerClearingAccountId: peerOneAccounts.aseClearingAccId,
      payerLiquidityAccountId: peerOneAccounts.aseLiquidityAccId,
      suspenseAccountId: peerOneAccounts.suspenseAccId
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
    peerOneAccounts.aseClearingAccId,
    peerOneAccounts.suspenseAccId
  ]);

  assert.ok(payerClearing);
  assert.equal(payerClearing.id, peerOneAccounts.aseClearingAccId);

  assert.ok(suspense);
  assert.equal(suspense.id, peerOneAccounts.suspenseAccId);

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
    payerClearingAccountId: peerOneAccounts.aseClearingAccId,
    suspenseAccountId: peerOneAccounts.suspenseAccId
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
    peerOneAccounts.aseClearingAccId,
    peerOneAccounts.suspenseAccId,
    peerOneAccounts.peerClearingAccId
  ]);

  assert.ok(payerClearing);
  assert.equal(payerClearing.id, peerOneAccounts.aseClearingAccId);

  assert.ok(suspense);
  assert.equal(suspense.id, peerOneAccounts.suspenseAccId);

  assert.ok(payeeClearing);
  assert.equal(payeeClearing.id, peerOneAccounts.peerClearingAccId);

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
    payerClearingAccountId: peerOneAccounts.aseClearingAccId,
    suspenseAccountId: peerOneAccounts.suspenseAccId
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
    peerOneAccounts.aseClearingAccId,
    peerOneAccounts.suspenseAccId
  ]);

  assert.ok(payerClearing);
  assert.equal(payerClearing.id, peerOneAccounts.aseClearingAccId);

  assert.ok(suspense);
  assert.equal(suspense.id, peerOneAccounts.suspenseAccId);

  assert.equal(payerClearing.debitedAmount, AMOUNT * BigInt(4)); //debited went up 4 times
  assert.equal(payerClearing.creditedAmount, AMOUNT * BigInt(2)); //credited went up 2 times

  assert.equal(suspense.debitedAmount, AMOUNT * BigInt(2)); //credited went up 2 times
  assert.equal(suspense.creditedAmount, AMOUNT * BigInt(3)); //credited went up 3 times

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
