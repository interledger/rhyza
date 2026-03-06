/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import {
  AssetAggregate,
  WalletAddressAggregate,
  WalletAddressAliasAggregate,
  WalletDomainService
} from 'pal-domain-lib';
import { PalServiceServer } from './grpc/grpc-service';
import process from 'process';
import {
  MongoDbAssetRepo,
  MongoDbWalletRepoRepo,
  MongoWalletAddressAliasRepo
} from 'pal-implementations-lib';

const MONGO_URL = process.env['MONGO_URL'] || 'mongodb://localhost:27017/';

export class PalApiService {
  private static grpcService: PalServiceServer;

  static async start(): Promise<void> {
    const assetRepo = new MongoDbAssetRepo(MONGO_URL);
    await assetRepo.init();

    const walletRepo = new MongoDbWalletRepoRepo(MONGO_URL);
    await walletRepo.init();

    const walletAliasRepo = new MongoWalletAddressAliasRepo(MONGO_URL);
    await walletAliasRepo.init();

    const assetAggregate = new AssetAggregate(assetRepo);
    const walletAggregate = new WalletAddressAggregate(walletRepo);
    const walletAddressAliasAggregate = new WalletAddressAliasAggregate(
      walletAliasRepo
    );

    const walletDomainService = new WalletDomainService(
      walletAggregate,
      walletAddressAliasAggregate
    );

    this.grpcService = new PalServiceServer(
      '1',
      '0.0.0.0:50051',
      assetAggregate,
      walletAggregate,
      walletAddressAliasAggregate,
      walletDomainService
    );

    await this.grpcService.start();
  }

  static async stop(): Promise<void> {
    await this.grpcService.stop();
  }
}
