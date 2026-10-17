import { beforeEach, test } from 'node:test';
import * as assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  MockLedgerEventSourcingRepository,
  MockMessageProducer,
  MockTelemetryService
} from './mocks/';

import {
  CheckBalanceAndReserveTransferCmd,
  CommitTransferCmd,
  CreateLedgerAccountForAssetCmd,
  CreateLedgerAccountsForPeerCmd,
  CreateLedgerCmd,
  DepositToAseCmd,
  LEDGER_INTERNAL_ASSET_SCALE,
  DepositToPeerCmd,
  IPalPeerAccounts,
  LedgerAccountsCreatedStateEvent,
  LedgerAccountsCreatedStatePayload,
  LedgerAggregate,
  LedgerCommand,
  LedgerCreatedStateEvent,
  LedgerCreatedStatePayload,
  LedgerTransactionRecordedStateEvent,
  LedgerTransactionRecordedStatePayload,
  RejectTransferCmd,
  ReserveTransferCmd,
  WithdrawFromAseCmd,
  WithdrawFromPeerCmd
} from '../src';
import { DomainEvent, IMessage, NullLogger } from 'common-types-lib';
import {
  LedgerAccountsCreatedForPeerEvent,
  LedgerOutgoingTransferCommittedEvent,
  LedgerOutgoingTransferInsufficientFundsErrorEvent,
  LedgerOutgoingTransferRejectedEvent,
  LedgerOutgoingTransferReservedEvent,
  LedgerIncomingTransferReservedEvent,
  LedgerIncomingTransferInsufficientFundsErrorEvent,
  LedgerIncomingTransferRejectedEvent,
  LedgerDepositToAseSucceededEvent,
  LedgerDepositToPeerSucceededEvent,
  LedgerIncomingTransferCommittedEvent,
  LedgerWithdrawFromAseSucceededEvent,
  LedgerWithdrawFromPeerSucceededEvent,
  LedgerWithdrawFromAseFailedWithInsufficientFundsEvent,
  LedgerWithdrawFromPeerFailedWithInsufficientFundsEvent,
  LedgerAccountCreatedForAssetEvent,
  LedgerOutgoingTransferCommitFailedEvent,
  LedgerIncomingTransferCommitFailedEvent,
  LedgerIncomingTransferRejectFailedEvent,
  LedgerOutgoingTransferRejectFailedEvent,
  LedgerCreatedEvent
} from 'pal-public-types-lib';

import {
  amountFromBigIntOfSize,
  convertAmountScale
} from '../src/liquidity/utils';

const mockMessageStore: IMessage[] = [];

let mockRepo: MockLedgerEventSourcingRepository;
let mockProducer: MockMessageProducer;
let aggregate: LedgerAggregate;

const EUR_LEDGER_ID = 'EUR';
const PEER_ONE_ID = 'peer1';
const AMOUNT = BigInt(1000);
const DEPOSIT_AMOUNT = AMOUNT * BigInt(5);
const AMOUNT_SCALE = 2;

const assetSystemAccId = crypto.randomUUID();

const peerOneAccounts: IPalPeerAccounts = {
  peerLiquidityAccId: 'peerLiquidityAccId',
  peerClearingAccId: 'peerClearingAccId',
  aseLiquidityAccId: 'aseLiquidityAccId',
  aseClearingAccId: 'aseClearingAccId',
  suspenseAccId: 'suspenseAccId'
};

const peerOneAccountsIdList = Object.values(peerOneAccounts);

function assertAccountsBalances(
  requiredBalances: {
    accId: string;
    debitedBalance: bigint;
    creditedBalance: bigint;
  }[]
) {
  const accounts = aggregate.getAccounts([
    ...peerOneAccountsIdList,
    assetSystemAccId
  ]);
  requiredBalances.forEach((reqBalanceItem) => {
    const account = accounts.find((acc) => acc.id === reqBalanceItem.accId);
    assert.ok(account);
    assert.equal(
      account.debitedAmount,
      convertAmountScale(
        reqBalanceItem.debitedBalance,
        AMOUNT_SCALE,
        LEDGER_INTERNAL_ASSET_SCALE
      )
    );
    assert.equal(
      account.creditedAmount,
      convertAmountScale(
        reqBalanceItem.creditedBalance,
        AMOUNT_SCALE,
        LEDGER_INTERNAL_ASSET_SCALE
      )
    );
  });
}

beforeEach(() => {
  mockRepo = new MockLedgerEventSourcingRepository(mockMessageStore);
  mockProducer = new MockMessageProducer(mockMessageStore);
  aggregate = new LedgerAggregate(
    mockRepo,
    mockProducer,
    new NullLogger(),
    new MockTelemetryService()
  );

  // Shouldn't be required because we just created the agg... still good
  // practice to do all we can to ensure tests are meaningful.
  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain LowLevel API - Create ledger', async () => {
  const cmd: LedgerCommand = new CreateLedgerCmd({ id: EUR_LEDGER_ID });

  await aggregate.processCommands(cmd);

  // check state event
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '1');
  assert.equal(lastStateEvent.msgName, LedgerCreatedStateEvent.name);
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload = lastStateEvent.payload as LedgerCreatedStatePayload;
  assert.ok(payload);
  assert.equal(payload.id, EUR_LEDGER_ID);
  assert.equal(payload.assetScale, LEDGER_INTERNAL_ASSET_SCALE);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.ok(lastDomainEvent);
  assert.equal(lastDomainEvent.msgName, LedgerCreatedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.ok(lastDomainEvent.payload);
  assert.equal(lastDomainEvent.payload.assetCode, EUR_LEDGER_ID);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain LowLevel API - Create ledger account for asset', async () => {
  // run setup commands
  await aggregate.processCommands([new CreateLedgerCmd({ id: EUR_LEDGER_ID })]);

  // run test

  const cmd = new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
    id: assetSystemAccId,
    assetCode: EUR_LEDGER_ID
  });

  await aggregate.processCommands(cmd);

  const stateEvents = await mockProducer.fetchStateEvents(EUR_LEDGER_ID);
  const lastStateEvent = stateEvents.at(-1) as LedgerAccountsCreatedStateEvent;
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '2');
  assert.equal(lastStateEvent.msgName, LedgerAccountsCreatedStateEvent.name);
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  assert.ok(lastStateEvent.payload.accounts);
  assert.equal(lastStateEvent.payload.accounts[0].assetCode, EUR_LEDGER_ID);
  assert.equal(lastStateEvent.payload.accounts[0].id, assetSystemAccId);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.ok(lastDomainEvent);
  assert.equal(lastDomainEvent.msgName, LedgerAccountCreatedForAssetEvent.name);
  const fetchedAccounts = aggregate.getAccounts([assetSystemAccId]);
  assert.ok(fetchedAccounts.length === 1);
  assert.ok(fetchedAccounts[0].id === assetSystemAccId);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain LowLevel API - Create ledger accounts for peer one', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    })
  ]);

  // run test

  const cmd = new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
    ...peerOneAccounts,
    peerId: PEER_ONE_ID,
    assetCode: EUR_LEDGER_ID
  });

  await aggregate.processCommands(cmd);

  const stateEvents = await mockProducer.fetchStateEvents(EUR_LEDGER_ID);
  const lastStateEvent = stateEvents.at(-1);
  assert.ok(lastStateEvent);

  assert.equal(lastStateEvent.aggregateVersion, '3');

  assert.equal(lastStateEvent.msgName, LedgerAccountsCreatedStateEvent.name);
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  const payload = lastStateEvent.payload as LedgerAccountsCreatedStatePayload;

  assert.ok(payload.accounts);
  const payloadAccounts = payload.accounts;
  assert.ok(payloadAccounts.length == 5);

  // get the accounts from the aggregate
  const fetchedAccounts = aggregate.getAccounts(peerOneAccountsIdList);
  peerOneAccountsIdList.forEach((id) => {
    const payloadAccount = payloadAccounts.find((acc) => acc.id === id);
    assert.ok(payloadAccount);
    const fetchedAccount = fetchedAccounts.find((acc) => acc.id === id);
    assert.ok(fetchedAccount);

    assert.ok(payloadAccount.name.includes(PEER_ONE_ID));
    assert.equal(payloadAccount.assetCode, EUR_LEDGER_ID);
    assert.equal(payloadAccount.assetDisplayScale, AMOUNT_SCALE);
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

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(
    -1
  ) as LedgerAccountsCreatedForPeerEvent;
  assert.equal(lastDomainEvent.msgName, LedgerAccountsCreatedForPeerEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);

  assert.ok(aggregate.verify());
});

/*
 * High Level API Calls
 * */
test('PAL Ledger Domain HighLevel API - Outgoing - Check Balance And Reserve Transfer cmd should fail before deposit', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    })
  ]);

  // run test

  const cmd: CheckBalanceAndReserveTransferCmd =
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req1',
      transferId: '1',
      peerId: PEER_ONE_ID,
      amount: AMOUNT.toString(),
      amountScale: AMOUNT_SCALE,
      transferDirection: 'OUTGOING',
      paymentIntentId: 'intent-1',
      paymentId: 'payment-1'
    });

  await aggregate.processCommands(cmd);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.ok(lastDomainEvent);
  assert.equal(
    lastDomainEvent.msgName,
    LedgerOutgoingTransferInsufficientFundsErrorEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.isErrorEvent, true);
  assert.equal(lastDomainEvent.payload.requestId, 'req1');
  assert.equal(lastDomainEvent.payload.transferId, '1');
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Outgoing - Deposit ASE liquidity', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    })
  ]);

  // run test
  const cmd: DepositToAseCmd = new DepositToAseCmd({
    requestId: '1',
    peerId: PEER_ONE_ID,
    assetCode: EUR_LEDGER_ID,
    amount: DEPOSIT_AMOUNT.toString(),
    amountScale: AMOUNT_SCALE
  });

  await aggregate.processCommands(cmd);

  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '4');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.ok(lastDomainEvent);
  assert.equal(lastDomainEvent.msgName, LedgerDepositToAseSucceededEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.peerId, PEER_ONE_ID);
  assert.equal(lastDomainEvent.payload.requestId, '1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Outgoing - Check Balance And Reserve Transfer', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    // deposit
    new DepositToAseCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    })
  ]);

  // run test
  const reqId = 'req1';
  const txId = '1';
  const cmd: CheckBalanceAndReserveTransferCmd =
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: reqId,
      transferId: txId,
      amount: AMOUNT.toString(),
      amountScale: AMOUNT_SCALE,
      peerId: PEER_ONE_ID,
      transferDirection: 'OUTGOING',
      paymentIntentId: 'intent-1',
      paymentId: 'payment-1'
    });

  await aggregate.processCommands(cmd);

  // check state event
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '5');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(AMOUNT, AMOUNT_SCALE, LEDGER_INTERNAL_ASSET_SCALE)
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, true);
  assert.equal(payload.transaction.voidsReservation, false);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    CheckBalanceAndReserveTransferCmd.name
  );
  assert.equal(payload.transaction.transferId, txId);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerOutgoingTransferReservedEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transferId, txId);
  assert.equal(lastDomainEvent.payload.isError, undefined);
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: AMOUNT
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Outgoing - Commit Transfer', async () => {
  const transferId = crypto.randomUUID();
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    // deposit
    new DepositToAseCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    }),
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req-1',
      transferId: transferId,
      amount: AMOUNT.toString(),
      amountScale: AMOUNT_SCALE,
      peerId: PEER_ONE_ID,
      transferDirection: 'OUTGOING',
      paymentIntentId: 'intent-1',
      paymentId: 'payment-1'
    })
  ]);

  // run test
  const reqId = 'req1';

  const cmd: CommitTransferCmd = new CommitTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transferId: transferId,
    transferDirection: 'OUTGOING',
    paymentIntentId: 'intent-1',
    paymentId: 'payment-1'
  });

  await aggregate.processCommands(cmd);

  // check state event
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '7');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(AMOUNT, AMOUNT_SCALE, LEDGER_INTERNAL_ASSET_SCALE)
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, false);
  assert.equal(payload.transaction.voidsReservation, true);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    CommitTransferCmd.name
  );
  assert.equal(payload.transaction.transferId, transferId);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerOutgoingTransferCommittedEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transferId, transferId);
  assert.equal(lastDomainEvent.payload.isError, undefined);
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: AMOUNT * 2n,
      creditedBalance: AMOUNT
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: AMOUNT
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: AMOUNT,
      creditedBalance: AMOUNT
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Outgoing - Reject Transfer', async () => {
  const transferId = crypto.randomUUID();
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    // deposit
    new DepositToAseCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    }),
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req1',
      transferId: transferId,
      amount: AMOUNT.toString(),
      amountScale: AMOUNT_SCALE,
      peerId: PEER_ONE_ID,
      transferDirection: 'OUTGOING',
      paymentIntentId: 'intent-1',
      paymentId: 'payment-1'
    })
  ]);

  // run test
  const reqId = 'req1';
  const cmd: RejectTransferCmd = new RejectTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transferId: transferId,
    transferDirection: 'OUTGOING',
    paymentIntentId: 'intent-1',
    paymentId: 'payment-1'
  });

  await aggregate.processCommands(cmd);

  // check state event
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '6');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(AMOUNT, AMOUNT_SCALE, LEDGER_INTERNAL_ASSET_SCALE)
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, false);
  assert.equal(payload.transaction.voidsReservation, true);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    RejectTransferCmd.name
  );
  assert.equal(payload.transaction.transferId, transferId);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerOutgoingTransferRejectedEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transferId, transferId);
  assert.equal(lastDomainEvent.payload.isError, undefined);
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: AMOUNT,
      creditedBalance: AMOUNT
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: AMOUNT,
      creditedBalance: AMOUNT
    }
  ]);
  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Outgoing - Commit Transfer with wrong transferId should fail', async () => {
  const transferId = crypto.randomUUID();
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    // deposit
    new DepositToAseCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    }),
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req-1',
      transferId: transferId,
      amount: AMOUNT.toString(),
      amountScale: AMOUNT_SCALE,
      peerId: PEER_ONE_ID,
      transferDirection: 'OUTGOING',
      paymentIntentId: 'intent-1',
      paymentId: 'payment-1'
    })
  ]);

  // run test
  const reqId = 'req1';

  const cmd: CommitTransferCmd = new CommitTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transferId: 'otherTransferId',
    transferDirection: 'OUTGOING',
    paymentIntentId: 'intent-1',
    paymentId: 'payment-1'
  });

  await aggregate.processCommands(cmd);

  // check state event - should the state of the CheckBalanceAndReserveTransferCmd
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '5');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(AMOUNT, AMOUNT_SCALE, LEDGER_INTERNAL_ASSET_SCALE)
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, true);
  assert.equal(payload.transaction.voidsReservation, false);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    CheckBalanceAndReserveTransferCmd.name
  );
  assert.equal(payload.transaction.transferId, transferId);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerOutgoingTransferCommitFailedEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transferId, 'otherTransferId');
  assert.equal(lastDomainEvent.payload.isError, undefined);
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: AMOUNT
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Outgoing - Reject Transfer with wrong transferId should fail', async () => {
  const transferId = crypto.randomUUID();
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    // deposit
    new DepositToAseCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    }),
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req1',
      transferId: transferId,
      amount: AMOUNT.toString(),
      amountScale: AMOUNT_SCALE,
      peerId: PEER_ONE_ID,
      transferDirection: 'OUTGOING',
      paymentIntentId: 'intent-1',
      paymentId: 'payment-1'
    })
  ]);

  // run test
  const reqId = 'req1';
  const cmd: RejectTransferCmd = new RejectTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transferId: 'otherTransferId',
    transferDirection: 'OUTGOING',
    paymentIntentId: 'intent-1',
    paymentId: 'payment-1'
  });

  await aggregate.processCommands(cmd);

  // check state event - should the state of the CheckBalanceAndReserveTransferCmd
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '5');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(AMOUNT, AMOUNT_SCALE, LEDGER_INTERNAL_ASSET_SCALE)
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, true);
  assert.equal(payload.transaction.voidsReservation, false);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    CheckBalanceAndReserveTransferCmd.name
  );
  assert.equal(payload.transaction.transferId, transferId);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerOutgoingTransferRejectFailedEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transferId, 'otherTransferId');
  assert.equal(lastDomainEvent.payload.isError, undefined);
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: AMOUNT
    }
  ]);
  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Outgoing - Reserve Transfer', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    // deposit
    new DepositToAseCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    })
  ]);

  // run test

  const reqId = 'req3';
  const transferId = '1';
  const cmd: ReserveTransferCmd = new ReserveTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transferId: transferId,
    amount: AMOUNT.toString(),
    amountScale: AMOUNT_SCALE,
    peerId: PEER_ONE_ID,
    transferDirection: 'OUTGOING',
    paymentIntentId: 'intent-1',
    paymentId: 'payment-1'
  });

  await aggregate.processCommands(cmd);

  // check state event
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '5');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(AMOUNT, AMOUNT_SCALE, LEDGER_INTERNAL_ASSET_SCALE)
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, true);
  assert.equal(payload.transaction.voidsReservation, false);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    ReserveTransferCmd.name
  );
  assert.equal(payload.transaction.transferId, transferId);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerOutgoingTransferReservedEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transferId, transferId);
  assert.equal(lastDomainEvent.payload.isError, undefined);
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: AMOUNT
    }
  ]);
  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Outgoing - Withdraw ASE liquidity', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    new DepositToAseCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    })
  ]);

  // run test
  const cmd = new WithdrawFromAseCmd({
    requestId: '1',
    peerId: PEER_ONE_ID,
    assetCode: EUR_LEDGER_ID,
    amount: DEPOSIT_AMOUNT.toString(),
    amountScale: AMOUNT_SCALE
  });

  await aggregate.processCommands(cmd);

  // check state event
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '5');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(
      DEPOSIT_AMOUNT,
      AMOUNT_SCALE,
      LEDGER_INTERNAL_ASSET_SCALE
    )
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, false);
  assert.equal(payload.transaction.voidsReservation, false);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    WithdrawFromAseCmd.name
  );
  assert.equal(payload.transaction.transferId, undefined);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerWithdrawFromAseSucceededEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.peerId, PEER_ONE_ID);
  assert.equal(lastDomainEvent.payload.requestId, '1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Outgoing - Withdraw ASE liquidity in excess should fail', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    new DepositToAseCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    })
  ]);

  // run test
  const cmd = new WithdrawFromAseCmd({
    requestId: '1',
    peerId: PEER_ONE_ID,
    assetCode: EUR_LEDGER_ID,
    amount: (DEPOSIT_AMOUNT + 1n).toString(),
    amountScale: AMOUNT_SCALE
  });

  await aggregate.processCommands(cmd);

  // check state event - should be the state after the deposit
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '4');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.originatingCommandName,
    DepositToAseCmd.name
  );
  assert.equal(payload.transaction.transferId, undefined);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerWithdrawFromAseFailedWithInsufficientFundsEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.peerId, PEER_ONE_ID);
  assert.equal(lastDomainEvent.payload.requestId, '1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Incoming - Check Balance And Reserve Transfer cmd should fail before deposit', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    })
  ]);

  // run test
  const cmd: CheckBalanceAndReserveTransferCmd =
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req1',
      transferId: '1',
      amount: (DEPOSIT_AMOUNT * 2n).toString(),
      amountScale: AMOUNT_SCALE,
      peerId: PEER_ONE_ID,
      transferDirection: 'INCOMING',
      paymentIntentId: 'intent-1',
      paymentId: 'payment-1'
    });

  await aggregate.processCommands(cmd);

  // check state event - should be the state after the create ledger
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '3');
  assert.equal(lastStateEvent.msgName, LedgerAccountsCreatedStateEvent.name);
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerIncomingTransferInsufficientFundsErrorEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.isErrorEvent, true);
  assert.equal(lastDomainEvent.payload.requestId, 'req1');
  assert.equal(lastDomainEvent.payload.transferId, '1');

  // verify accounts' balances
  assertAccountsBalances([
    { accId: assetSystemAccId, debitedBalance: 0n, creditedBalance: 0n },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    }
  ]);
  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Incoming - Deposit Peer liquidity', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    })
  ]);

  // run test
  const cmd: DepositToPeerCmd = new DepositToPeerCmd({
    requestId: '1',
    peerId: PEER_ONE_ID,
    assetCode: EUR_LEDGER_ID,
    amount: DEPOSIT_AMOUNT.toString(),
    amountScale: AMOUNT_SCALE
  });

  await aggregate.processCommands(cmd);

  // check state event
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '4');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(
      DEPOSIT_AMOUNT,
      AMOUNT_SCALE,
      LEDGER_INTERNAL_ASSET_SCALE
    )
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, false);
  assert.equal(payload.transaction.voidsReservation, false);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    DepositToPeerCmd.name
  );
  assert.equal(payload.transaction.transferId, undefined);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(lastDomainEvent.msgName, LedgerDepositToPeerSucceededEvent.name);
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.peerId, PEER_ONE_ID);
  assert.equal(lastDomainEvent.payload.requestId, '1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Incoming - Check Balance And Reserve Transfer', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    // deposit
    new DepositToPeerCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    })
  ]);

  // run test
  const cmd: CheckBalanceAndReserveTransferCmd =
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req2',
      transferId: '1',
      amount: AMOUNT.toString(),
      amountScale: AMOUNT_SCALE,
      peerId: PEER_ONE_ID,
      transferDirection: 'INCOMING',
      paymentIntentId: 'intent-1',
      paymentId: 'payment-1'
    });

  await aggregate.processCommands(cmd);

  // check state event
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '5');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(AMOUNT, AMOUNT_SCALE, LEDGER_INTERNAL_ASSET_SCALE)
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, true);
  assert.equal(payload.transaction.voidsReservation, false);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    CheckBalanceAndReserveTransferCmd.name
  );
  assert.equal(payload.transaction.transferId, '1');

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerIncomingTransferReservedEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.requestId, 'req2');
  assert.equal(lastDomainEvent.payload.transferId, '1');
  assert.equal(lastDomainEvent.payload.isError, undefined);
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: AMOUNT
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Incoming - Commit Transfer', async () => {
  const transferId = crypto.randomUUID();
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    // deposit
    new DepositToPeerCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    }),
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req-1',
      transferId: transferId,
      amount: AMOUNT.toString(),
      amountScale: AMOUNT_SCALE,
      peerId: PEER_ONE_ID,
      transferDirection: 'INCOMING',
      paymentIntentId: 'intent-1',
      paymentId: 'payment-1'
    })
  ]);

  // run test
  const reqId = 'req1';

  const cmd: CommitTransferCmd = new CommitTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transferId: transferId,
    transferDirection: 'INCOMING',
    paymentIntentId: 'intent-1',
    paymentId: 'payment-1'
  });

  await aggregate.processCommands(cmd);

  // check state event
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '7');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(AMOUNT, AMOUNT_SCALE, LEDGER_INTERNAL_ASSET_SCALE)
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, false);
  assert.equal(payload.transaction.voidsReservation, true);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    CommitTransferCmd.name
  );
  assert.equal(payload.transaction.transferId, transferId);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerIncomingTransferCommittedEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transferId, transferId);
  assert.equal(lastDomainEvent.payload.isError, undefined);
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: AMOUNT
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: AMOUNT * 2n,
      creditedBalance: AMOUNT
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: AMOUNT,
      creditedBalance: AMOUNT
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Incoming - Reject Transfer', async () => {
  const transferId = crypto.randomUUID();
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    // deposit
    new DepositToPeerCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    }),
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req2',
      transferId: transferId,
      amount: AMOUNT.toString(),
      amountScale: AMOUNT_SCALE,
      peerId: PEER_ONE_ID,
      transferDirection: 'INCOMING',
      paymentIntentId: 'intent-1',
      paymentId: 'payment-1'
    })
  ]);

  // run test

  const reqId = 'req1';

  const cmd: RejectTransferCmd = new RejectTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transferId: transferId,
    transferDirection: 'INCOMING',
    paymentIntentId: 'intent-1',
    paymentId: 'payment-1'
  });

  await aggregate.processCommands(cmd);

  // check state event
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '6');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(AMOUNT, AMOUNT_SCALE, LEDGER_INTERNAL_ASSET_SCALE)
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, false);
  assert.equal(payload.transaction.voidsReservation, true);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    RejectTransferCmd.name
  );
  assert.equal(payload.transaction.transferId, transferId);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerIncomingTransferRejectedEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transferId, transferId);
  assert.equal(lastDomainEvent.payload.isError, undefined);
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: AMOUNT,
      creditedBalance: AMOUNT
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: AMOUNT,
      creditedBalance: AMOUNT
    }
  ]);
});

test('PAL Ledger Domain HighLevel API - Incoming - Commit Transfer with wrong transferId should fail', async () => {
  const transferId = crypto.randomUUID();
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    // deposit
    new DepositToPeerCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    }),
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req-1',
      transferId: transferId,
      amount: AMOUNT.toString(),
      amountScale: AMOUNT_SCALE,
      peerId: PEER_ONE_ID,
      transferDirection: 'INCOMING',
      paymentIntentId: 'intent-1',
      paymentId: 'payment-1'
    })
  ]);

  // run test
  const reqId = 'req1';

  const cmd: CommitTransferCmd = new CommitTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transferId: 'otherTransferId',
    transferDirection: 'INCOMING',
    paymentIntentId: 'intent-1',
    paymentId: 'payment-1'
  });

  await aggregate.processCommands(cmd);

  // check state event - should be the CheckBalanceAndReserveTransferCmd
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '5');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(AMOUNT, AMOUNT_SCALE, LEDGER_INTERNAL_ASSET_SCALE)
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, true);
  assert.equal(payload.transaction.voidsReservation, false);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    CheckBalanceAndReserveTransferCmd.name
  );
  assert.equal(payload.transaction.transferId, transferId);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerIncomingTransferCommitFailedEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transferId, 'otherTransferId');
  assert.equal(lastDomainEvent.payload.isError, undefined);
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: AMOUNT
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Incoming - Reject Transfer with wrong transferId should fail', async () => {
  const transferId = crypto.randomUUID();
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    // deposit
    new DepositToPeerCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    }),
    new CheckBalanceAndReserveTransferCmd(EUR_LEDGER_ID, {
      requestId: 'req-1',
      transferId: transferId,
      amount: AMOUNT.toString(),
      amountScale: AMOUNT_SCALE,
      peerId: PEER_ONE_ID,
      transferDirection: 'INCOMING',
      paymentIntentId: 'intent-1',
      paymentId: 'payment-1'
    })
  ]);

  // run test
  const reqId = 'req1';

  const cmd: RejectTransferCmd = new RejectTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transferId: 'otherTransferId',
    transferDirection: 'INCOMING',
    paymentIntentId: 'intent-1',
    paymentId: 'payment-1'
  });

  await aggregate.processCommands(cmd);

  // check state event - should be the CheckBalanceAndReserveTransferCmd
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '5');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(AMOUNT, AMOUNT_SCALE, LEDGER_INTERNAL_ASSET_SCALE)
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, true);
  assert.equal(payload.transaction.voidsReservation, false);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    CheckBalanceAndReserveTransferCmd.name
  );
  assert.equal(payload.transaction.transferId, transferId);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerIncomingTransferRejectFailedEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transferId, 'otherTransferId');
  assert.equal(lastDomainEvent.payload.isError, undefined);
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: AMOUNT
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Incoming - Reserve Transfer', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    // deposit
    new DepositToPeerCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    })
  ]);

  // run test
  const reqId = 'req3';
  const txId = '1';
  const cmd: ReserveTransferCmd = new ReserveTransferCmd(EUR_LEDGER_ID, {
    requestId: reqId,
    transferId: txId,
    amount: AMOUNT.toString(),
    amountScale: AMOUNT_SCALE,
    peerId: PEER_ONE_ID,
    transferDirection: 'INCOMING',
    paymentIntentId: 'intent-1',
    paymentId: 'payment-1'
  });

  await aggregate.processCommands(cmd);

  // check state event - should be the CheckBalanceAndReserveTransferCmd
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '5');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(AMOUNT, AMOUNT_SCALE, LEDGER_INTERNAL_ASSET_SCALE)
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, true);
  assert.equal(payload.transaction.voidsReservation, false);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    ReserveTransferCmd.name
  );
  assert.equal(payload.transaction.transferId, txId);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages.at(-1) as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerIncomingTransferReservedEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.requestId, reqId);
  assert.equal(lastDomainEvent.payload.requestId, reqId);
  assert.equal(lastDomainEvent.payload.transferId, txId);
  assert.equal(lastDomainEvent.payload.isError, undefined);
  assert.equal(lastDomainEvent.payload.paymentId, 'payment-1');
  assert.equal(lastDomainEvent.payload.paymentIntentId, 'intent-1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: AMOUNT
    }
  ]);
});

test('PAL Ledger Domain HighLevel API - Incoming - Withdraw Peer liquidity', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    new DepositToPeerCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    })
  ]);

  // run test
  const cmd = new WithdrawFromPeerCmd({
    requestId: '1',
    peerId: PEER_ONE_ID,
    assetCode: EUR_LEDGER_ID,
    amount: DEPOSIT_AMOUNT.toString(),
    amountScale: AMOUNT_SCALE
  });

  await aggregate.processCommands(cmd);

  // check state event
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '5');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(
      DEPOSIT_AMOUNT,
      AMOUNT_SCALE,
      LEDGER_INTERNAL_ASSET_SCALE
    )
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, false);
  assert.equal(payload.transaction.voidsReservation, false);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    WithdrawFromPeerCmd.name
  );
  assert.equal(payload.transaction.transferId, undefined);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerWithdrawFromPeerSucceededEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.peerId, PEER_ONE_ID);
  assert.equal(lastDomainEvent.payload.requestId, '1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    }
  ]);

  assert.ok(aggregate.verify());
});

test('PAL Ledger Domain HighLevel API - Incoming - Withdraw Peer liquidity in excess should fail', async () => {
  // run setup commands
  await aggregate.processCommands([
    new CreateLedgerCmd({ id: EUR_LEDGER_ID }),
    new CreateLedgerAccountForAssetCmd(EUR_LEDGER_ID, {
      id: assetSystemAccId,
      assetCode: EUR_LEDGER_ID
    }),
    new CreateLedgerAccountsForPeerCmd(EUR_LEDGER_ID, {
      ...peerOneAccounts,
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID
    }),
    new DepositToPeerCmd({
      requestId: '1',
      peerId: PEER_ONE_ID,
      assetCode: EUR_LEDGER_ID,
      amount: DEPOSIT_AMOUNT.toString(),
      amountScale: AMOUNT_SCALE
    })
  ]);

  // run test
  const cmd = new WithdrawFromPeerCmd({
    requestId: '1',
    peerId: PEER_ONE_ID,
    assetCode: EUR_LEDGER_ID,
    amount: (DEPOSIT_AMOUNT + 1n).toString(),
    amountScale: AMOUNT_SCALE
  });

  await aggregate.processCommands(cmd);

  // check state event - should be the state of the DepositToPeerCmd
  const lastStateEvent = (
    await mockProducer.fetchStateEvents(EUR_LEDGER_ID)
  ).at(-1);
  assert.ok(lastStateEvent);
  assert.equal(lastStateEvent.aggregateVersion, '4');
  assert.equal(
    lastStateEvent.msgName,
    LedgerTransactionRecordedStateEvent.name
  );
  assert.equal(lastStateEvent.aggregateId, EUR_LEDGER_ID);
  // check state event payload
  const payload =
    lastStateEvent.payload as LedgerTransactionRecordedStatePayload;
  assert.ok(payload);
  assert.ok(payload.transaction);
  assert.equal(
    payload.transaction.amount,
    amountFromBigIntOfSize(
      DEPOSIT_AMOUNT,
      AMOUNT_SCALE,
      LEDGER_INTERNAL_ASSET_SCALE
    )
  );
  assert.equal(payload.transaction.amountScale, LEDGER_INTERNAL_ASSET_SCALE);
  assert.equal(payload.transaction.isReservation, false);
  assert.equal(payload.transaction.voidsReservation, false);
  assert.equal(payload.transaction.peerId, PEER_ONE_ID);
  assert.equal(
    payload.transaction.originatingCommandName,
    DepositToPeerCmd.name
  );
  assert.equal(payload.transaction.transferId, undefined);

  // check domain/integration events
  const lastDomainEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.equal(
    lastDomainEvent.msgName,
    LedgerWithdrawFromPeerFailedWithInsufficientFundsEvent.name
  );
  assert.equal(lastDomainEvent.aggregateId, EUR_LEDGER_ID);
  assert.equal(lastDomainEvent.payload.peerId, PEER_ONE_ID);
  assert.equal(lastDomainEvent.payload.requestId, '1');

  // verify accounts' balances
  assertAccountsBalances([
    {
      accId: assetSystemAccId,
      debitedBalance: DEPOSIT_AMOUNT,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.aseClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.peerLiquidityAccId,
      debitedBalance: 0n,
      creditedBalance: DEPOSIT_AMOUNT
    },
    {
      accId: peerOneAccounts.peerClearingAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    },
    {
      accId: peerOneAccounts.suspenseAccId,
      debitedBalance: 0n,
      creditedBalance: 0n
    }
  ]);

  assert.ok(aggregate.verify());
});
