import { ILogger, IMessageProducer, ITelemetryService } from 'common-types-lib';
import {
  DepositToAseCmd,
  DepositToPeerCmd,
  ILedgerReadSideRepository,
  LiquidityManagementCmdPayload,
  WithdrawFromAseCmd,
  WithdrawFromPeerCmd
} from 'pal-domain-lib';
import { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';

import { PendingResponse, UnaryResponse } from '../types';
import {
  LedgerDepositToAseFailedEvent,
  LedgerDepositToAseSucceededEvent,
  LedgerDepositToPeerFailedEvent,
  LedgerDepositToPeerSucceededEvent,
  LedgerDomainEvent,
  LedgerLiquidityManagementFailureEventPayload,
  LedgerWithdrawFromAseFailedEvent,
  LedgerWithdrawFromAseFailedWithInsufficientFundsEvent,
  LedgerWithdrawFromAseSucceededEvent,
  LedgerWithdrawFromPeerFailedEvent,
  LedgerWithdrawFromPeerFailedWithInsufficientFundsEvent,
  LedgerWithdrawFromPeerSucceededEvent,
  PbGetLedgerAccountsRequest,
  PbGetLedgerAccountsResponse,
  PbLedgerAccount,
  PbLedgerLiquidityManagementFailureResponse,
  PbLedgerLiquidityManagementRequest,
  PbLedgerLiquidityManagementResponse
} from 'pal-public-types-lib';
import crypto from 'crypto';
import { PendingResponseRegistry } from '../registries/pending-response-registry';
import { Status } from '@grpc/grpc-js/build/src/constants';
import { Empty } from 'google-protobuf/google/protobuf/empty_pb';
import { amountFromBigIntOfSize } from 'pal-domain-lib/dist/liquidity/utils';

/**
 * Ledger related request and event handlers (only low-level API not SAGA based)
 */
export class LedgerGrpcHandler {
  private readonly _logger: ILogger;
  private readonly _ledgerReadSideRepo: ILedgerReadSideRepository;
  private readonly _msgProducer: IMessageProducer;
  private readonly _responseRegistry: PendingResponseRegistry;
  private readonly _perLedgerInternalAssetScales: Map<string, number>;
  private readonly _telemetryService: ITelemetryService;

  constructor(
    ledgerReadSideRepo: ILedgerReadSideRepository,
    responseRegistry: PendingResponseRegistry,
    msgProducer: IMessageProducer,
    logger: ILogger,
    telemetryService: ITelemetryService
  ) {
    this._ledgerReadSideRepo = ledgerReadSideRepo;
    this._responseRegistry = responseRegistry;
    this._msgProducer = msgProducer;
    this._logger = logger.child(this.constructor.name);
    this._telemetryService = telemetryService;
    this._perLedgerInternalAssetScales = new Map<string, number>();
    this._logger.info('LedgerGrpcHandler created');
  }

  private async _getLedgerInternalAssetScale(
    ledgerId: string
  ): Promise<number> {
    const scale = this._perLedgerInternalAssetScales.get(ledgerId);
    if (scale) {
      return scale;
    }

    const ledger = await this._ledgerReadSideRepo.fetchLedgers([ledgerId]);
    if (!ledger.length) {
      throw new Error(`Ledger with id ${ledgerId} not found`);
    }
    this._perLedgerInternalAssetScales.set(ledgerId, ledger[0].assetScale);
    return ledger[0].assetScale;
  }

  async handleGetLedgerAccountsRequest(
    call: ServerUnaryCall<
      PbGetLedgerAccountsRequest,
      PbGetLedgerAccountsResponse
    >
  ): Promise<UnaryResponse<PbGetLedgerAccountsResponse>> {
    const accountIds = call.request.getAccountIdsList();
    const accounts =
      await this._ledgerReadSideRepo.fetchLedgerAccounts(accountIds);

    const resp = new PbGetLedgerAccountsResponse();

    const pbList: PbLedgerAccount[] = [];
    for (const account of accounts) {
      const internalScale = await this._getLedgerInternalAssetScale(
        account.assetCode
      );

      const debitedAmount = amountFromBigIntOfSize(
        BigInt(account.debitedAmount),
        internalScale,
        account.assetDisplayScale
      );
      const creditedAmount = amountFromBigIntOfSize(
        BigInt(account.creditedAmount),
        internalScale,
        account.assetDisplayScale
      );

      const pbAcc = new PbLedgerAccount()
        .setId(account.id)
        .setType(account.type)
        .setAssetCode(account.assetCode)
        .setName(account.name)
        .setDebitedAmount(debitedAmount.toString())
        .setCreditedAmount(creditedAmount.toString())
        .setAssetDisplayScale(account.assetDisplayScale);
      if (account.peerId) {
        pbAcc.setPeerId(account.peerId);
      }
      pbList.push(pbAcc);
    }

    resp.setAccountsList(pbList);
    return { resp: resp };
  }

  async handleLiquidityRequest(
    call: ServerUnaryCall<
      PbLedgerLiquidityManagementRequest,
      PbLedgerLiquidityManagementResponse
    >,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: sendUnaryData<any | undefined>
    //,cmdClass: DepositToAseCmd| DepositToPeerCmd | WithdrawFromAseCmd | WithdrawFromPeerCmd
  ) {
    const reqType = call.request.getType();

    let cmd:
      | DepositToAseCmd
      | DepositToPeerCmd
      | WithdrawFromAseCmd
      | WithdrawFromPeerCmd;
    const payload: LiquidityManagementCmdPayload = {
      requestId: call.request.getRequestId(),
      amount: call.request.getAmount(),
      peerId: call.request.getPeerId(),
      assetCode: call.request.getAssetCode(),
      amountScale: call.request.getAmountScale(),
      externalId: call.request.getExternalId()
    };

    if (reqType == PbLedgerLiquidityManagementRequest.Type.DEPOSIT_TO_PEER) {
      cmd = new DepositToPeerCmd(payload);
    } else if (
      reqType == PbLedgerLiquidityManagementRequest.Type.DEPOSIT_TO_ASE
    ) {
      cmd = new DepositToAseCmd(payload);
    } else if (
      reqType == PbLedgerLiquidityManagementRequest.Type.WITHDRAW_FROM_PEER
    ) {
      cmd = new WithdrawFromPeerCmd(payload);
    } else if (
      reqType == PbLedgerLiquidityManagementRequest.Type.WITHDRAW_FROM_ASE
    ) {
      cmd = new WithdrawFromAseCmd(payload);
    } else {
      const msg =
        'Unhandled LiquidityRequest received in ledger handler with callName: ' +
        reqType +
        ' cannot continue';
      this._logger.warn(msg);
      callback({ code: Status.UNIMPLEMENTED, message: msg });
      return;
    }

    const requestId = crypto.randomUUID();
    cmd.requestId = requestId;
    // make sure the request id is passed on to any outgoing events
    this._responseRegistry.store(requestId, call, callback);

    await this._msgProducer.send(cmd);
  }

  /*
   * Liq management success events:
   * - LedgerDepositToPeerSucceededEvent
   * - LedgerDepositToAseSucceededEvent
   * - LedgerWithdrawFromPeerSucceededEvent
   * - LedgerWithdrawFromAseSucceededEvent
   *
   * Failure:
   * - LedgerDepositToPeerFailedEvent
   * - LedgerDepositToAseFailedEvent
   * - LedgerWithdrawFromPeerFailedEvent
   * - LedgerWithdrawFromAseFailedEvent
   * - LedgerWithdrawFromPeerFailedWithInsufficientFundsEvent
   * - LedgerWithdrawFromAseFailedWithInsufficientFundsEvent
   *
   * */

  async handleLiquidityRequestEvents(
    pendingResp: PendingResponse,
    evt:
      | LedgerDepositToPeerSucceededEvent
      | LedgerDepositToAseSucceededEvent
      | LedgerWithdrawFromPeerSucceededEvent
      | LedgerWithdrawFromAseSucceededEvent
      | LedgerDepositToPeerFailedEvent
      | LedgerDepositToAseFailedEvent
      | LedgerWithdrawFromPeerFailedEvent
      | LedgerWithdrawFromAseFailedEvent
      | LedgerWithdrawFromPeerFailedWithInsufficientFundsEvent
      | LedgerWithdrawFromAseFailedWithInsufficientFundsEvent
  ): Promise<void> {
    const pbResp = new PbLedgerLiquidityManagementResponse();
    pbResp.setRequestId(evt.payload.requestId);
    pbResp.setPeerId(evt.payload.peerId);
    if (evt.payload.externalId) {
      pbResp.setExternalId(evt.payload.externalId);
    }

    // respond to the client with success
    if (
      evt.msgName === LedgerDepositToPeerSucceededEvent.name ||
      evt.msgName === LedgerDepositToAseSucceededEvent.name ||
      evt.msgName === LedgerWithdrawFromPeerSucceededEvent.name ||
      evt.msgName === LedgerWithdrawFromAseSucceededEvent.name
    ) {
      pbResp.setSuccess(new Empty());
      this._responseRegistry.resolve(pendingResp, null, pbResp);
      return;
    }

    // respond to the client with failure
    const specificPayload =
      evt.payload as LedgerLiquidityManagementFailureEventPayload;
    const pbError = new PbLedgerLiquidityManagementFailureResponse();
    pbError.setErrorMessage(specificPayload.errorMessage);

    if (
      evt.msgName === LedgerDepositToPeerFailedEvent.name ||
      evt.msgName === LedgerDepositToAseFailedEvent.name ||
      evt.msgName === LedgerWithdrawFromPeerFailedEvent.name ||
      evt.msgName === LedgerWithdrawFromAseFailedEvent.name
    ) {
      pbResp.setGenericFailure(pbError);
    } else if (
      LedgerDomainEvent.isLedgerWithdrawFromPeerFailedWithInsufficientFundsEvent(
        evt
      ) ||
      LedgerDomainEvent.isLedgerWithdrawFromAseFailedWithInsufficientFundsEvent(
        evt
      )
    ) {
      pbResp.setInsufficientFundsFailure(pbError);
    } else {
      const msg =
        'Unhandled LiquidityResponse event received in ledger - cannot continue';
      this._logger.warn(msg);
      this._responseRegistry.resolve(pendingResp, {
        code: Status.UNIMPLEMENTED,
        message: msg
      });
      return;
    }

    this._responseRegistry.resolve(pendingResp, null, pbResp);
  }
}
