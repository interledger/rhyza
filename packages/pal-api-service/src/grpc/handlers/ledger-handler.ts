import { ILogger, IMessageProducer } from 'common-types-lib';
import {
  CreateLedgerAccountCmd,
  CreateLedgerCmd,
  ILedgerReadSideRepository
} from 'pal-domain-lib';
import { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { Status } from '@grpc/grpc-js/build/src/constants';

import { PendingResponseRegistry } from '../registries/pending-response-registry';
import { PendingResponse, UnaryResponse } from '../types';
import { Empty } from 'google-protobuf/google/protobuf/empty_pb';
import {
  LedgerDomainEvent,
  PbCreateLedgerAccountRequest,
  PbCreateLedgerRequest,
  PbGetLedgerAccountsRequest,
  PbGetLedgerAccountsResponse,
  PbLedgerAccount
} from 'pal-public-types-lib';

/**
 * Ledger related request and event handlers (only low-level API not SAGA based)
 */
export class LedgerGrpcHandler {
  private readonly _logger: ILogger;
  private readonly _ledgerReadSideRepo: ILedgerReadSideRepository;
  private readonly _msgProducer: IMessageProducer;
  private readonly _responseRegistry: PendingResponseRegistry;

  constructor(
    ledgerReadSideRepo: ILedgerReadSideRepository,
    responseRegistry: PendingResponseRegistry,
    msgProducer: IMessageProducer,
    logger: ILogger
  ) {
    this._ledgerReadSideRepo = ledgerReadSideRepo;
    this._responseRegistry = responseRegistry;
    this._msgProducer = msgProducer;
    this._logger = logger;

    this._logger.info('LedgerGrpcHandler created');
  }

  async handleCreateLedgerRequest(
    call: ServerUnaryCall<PbCreateLedgerRequest, Empty>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: sendUnaryData<any | undefined>
  ): Promise<void> {
    const cmd = new CreateLedgerCmd({
      id: call.request.getLedgerAssetCode()
    });
    cmd.requestId = crypto.randomUUID();

    await this._msgProducer.send(cmd);

    this._responseRegistry.store(cmd.requestId, call, callback);
  }

  async handleCreateLedgerResponseEvent(
    pendingResp: PendingResponse,
    event: LedgerDomainEvent
  ): Promise<void> {
    let error = null;
    let response = null;

    if (LedgerDomainEvent.isLedgerCreatedEvent(event)) {
      // success response
      response = new Empty();
    } else if (LedgerDomainEvent.isLedgerCreationFailedEvent(event)) {
      // error response, check what to put in the error message
      let code: Status;
      if (event.payload.reason === 'DUPLICATE_ASSET_CODE') {
        code = Status.ALREADY_EXISTS;
      } else {
        code = Status.UNKNOWN;
      }

      error = {
        code: code,
        message: event.payload.reason
      };
    }

    // respond to the client
    this._responseRegistry.resolve(pendingResp, error, response);
  }

  async handleCreateLedgerAccountRequest(
    call: ServerUnaryCall<PbCreateLedgerAccountRequest, Empty>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: sendUnaryData<any | undefined>
  ): Promise<void> {
    const cmd = new CreateLedgerAccountCmd(call.request.getAssetCode(), {
      id: call.request.getId(),
      name: call.request.getName(),
      assetCode: call.request.getAssetCode(),
      assetDisplayScale: call.request.getAssetDisplayScale()
    });
    cmd.requestId = crypto.randomUUID();

    await this._msgProducer.send(cmd);

    this._responseRegistry.store(cmd.requestId, call, callback);
  }

  async handleCreateLedgerAccountResponseEvent(
    pendingResp: PendingResponse,
    event: LedgerDomainEvent
  ): Promise<void> {
    let error = null;
    let response = null;

    if (LedgerDomainEvent.isLedgerAccountCreatedEvent(event)) {
      // success response
      response = new Empty();
    } else if (LedgerDomainEvent.isLedgerAccountCreationFailedEvent(event)) {
      // error response, check what to put in the error message
      let code: Status;
      if (event.payload.reason === 'DUPLICATE_ACCOUNT_ID') {
        code = Status.ALREADY_EXISTS;
      } else if (event.payload.reason === 'ASSET_CODE_MISMATCH') {
        code = Status.INVALID_ARGUMENT;
      } else {
        code = Status.UNKNOWN;
      }

      error = {
        code: code,
        message: event.payload.reason
      };
    }

    // respond to the client
    this._responseRegistry.resolve(pendingResp, error, response);
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

    resp.setAccountsList(
      accounts.map((account) => {
        const pbAcc = new PbLedgerAccount()
          .setId(account.id)
          .setAssetCode(account.assetCode)
          .setName(account.name)
          .setDebitedAmount(account.debitedAmount.toString())
          .setCreditedAmount(account.creditedAmount.toString())
          .setAssetDisplayScale(account.assetDisplayScale);
        if (account.externalId) {
          pbAcc.setExternalId(account.externalId);
        }
        return pbAcc;
      })
    );

    return { resp: resp };
  }
}
