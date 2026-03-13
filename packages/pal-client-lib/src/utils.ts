/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

"use strict";

export function parseAddressToDomainAndPathName(address: string): { domain: string | null, pathName: string} {
  let toParseAddress = address.includes('://') ? address  : 'http://' + address;

  let url:URL;
  try{
    url = new URL(toParseAddress);
  }catch(err){
    // not url, must be all pathname
    return {domain: null, pathName: address};
  }
  const pathName = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
  if(pathName.length <= 0) throw new Error('Invalid address, if a URL it must include a path name');

  return {
    domain: url.hostname,
    pathName: pathName
  }
}
