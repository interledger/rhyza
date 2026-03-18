/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

export function parseAddressToDomainAndPathName(address: string): {
  domain: string | null;
  pathName: string;
} {
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
