export interface IPalWalletAddressDto {
  id: string;
  publicName: string;
  assetCode: string;
  assetScale: number;
  isActive: boolean;

  aliases: IPalWalletAddressAliasDto[];
}

export interface IPalWalletAddressAliasDto {
  domain: string | null;
  pathName: string;
  walletId: string;
}
