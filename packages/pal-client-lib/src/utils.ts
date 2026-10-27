export function parseAddressToDomainAndPathName(address: string): {
  domain: string | null;
  pathName: string;
} {
  // without path separator we assume it to be a name
  if (!address.includes('/')) {
    return {
      domain: null,
      pathName: address
    };
  }

  const toParseAddress = address.includes('://')
    ? address
    : 'http://' + address;

  let url: URL;
  try {
    url = new URL(toParseAddress);
    // eslint-disable-next-line
  } catch (err) {
    // not url, must be all pathname
    return { domain: null, pathName: address };
  }

  const pathName = url.pathname.startsWith('/')
    ? url.pathname.substring(1)
    : url.pathname;
  if (pathName.length <= 0)
    throw new Error('Invalid address, if a URL it must include a path name');

  // if a domain doesn't look like a FQDN, we don't consider it a domain
  if (
    // eslint-disable-next-line
    !/^(((?!\-))(xn\-\-)?[a-z0-9\-_]{0,61}[a-z0-9]{1,1}\.)*(xn\-\-)?([a-z0-9\-]{1,61}|[a-z0-9\-]{1,30})\.[a-z]{2,}$/i.test(
      url.hostname
    )
  ) {
    return { domain: null, pathName: address };
  }

  return {
    domain: url.hostname,
    pathName: pathName
  };
}

/**
 * Extract the wallet address pathName for pathName-only alias lookup.
 * Accepts a bare pathName or a full wallet address URL.
 */
export function pathNameFromWalletAddress(walletAddress: string): string {
  if (!walletAddress.includes('/') && !walletAddress.includes('://')) {
    return walletAddress;
  }

  const toParse = walletAddress.includes('://')
    ? walletAddress
    : `http://${walletAddress}`;

  try {
    const url = new URL(toParse);
    const pathName = url.pathname.startsWith('/')
      ? url.pathname.substring(1)
      : url.pathname;
    if (pathName.length <= 0) {
      throw new Error('Invalid address, if a URL it must include a path name');
    }
    return pathName;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid address')) {
      throw err;
    }
    return walletAddress;
  }
}

export function assertValidWalletAddressPathName(pathName: string): void {
  if (
    !pathName ||
    pathName.includes('/') ||
    pathName.includes('://') ||
    pathName.includes('\\')
  ) {
    throw new Error(
      'pathName must be a single path segment without "/" or "://"'
    );
  }
}
