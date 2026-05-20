import { ILogger } from 'common-types-lib';
import { ILedgerReadSideRepository } from 'pal-domain-lib';
import { ServerUnaryCall } from '@grpc/grpc-js';

import { UnaryResponse } from '../types';
import {
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

  constructor(ledgerReadSideRepo: ILedgerReadSideRepository, logger: ILogger) {
    this._ledgerReadSideRepo = ledgerReadSideRepo;
    this._logger = logger;

    this._logger.info('LedgerGrpcHandler created');
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
