import {
  AseExchangeServiceRateNotFoundError,
  AseExchangeServiceTimeoutError,
  AseExchangeServiceUnknownError,
  IPalAseFxService
} from 'pal-domain-lib';
import { ILogger } from 'common-types-lib';

export class AseFxServiceAdapter implements IPalAseFxService {
  private _aseEndpointUrl: string;
  private _timeoutMs: number;
  private _rateTtlMs: number;
  private _logger: ILogger;

  constructor(
    aseEndpointUrl: string,
    timeoutMs: number,
    rateTtlMs: number,
    logger: ILogger
  ) {
    this._aseEndpointUrl = aseEndpointUrl;
    this._timeoutMs = timeoutMs;
    this._rateTtlMs = rateTtlMs;
    this._logger = logger;
  }

  /*
   * Specs for exchange-rates ASE endpoint:
   * https://github.com/interledger/rafiki/blob/main/packages/backend/src/openapi/specs/exchange-rates.yaml
   *
   * Request must include the following query parameters:
   * base: the base asset code
   *
   * Response is an object with the following properties:
   * {
   *   "base": "USD",
   *   "rates": {
   *     "EUR": 0.813399,
   *   }
   * }
   *
   * */

  private async _getDataFromAse(
    sourceAssetCode: string,
    destinationAssetCode: string,
    peerId?: string
  ): Promise<{ rate: number; expiresAt: number }> {
    const controller: AbortController = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let respData: any;

    try {
      const url = new URL(this._aseEndpointUrl);
      url.searchParams.append('base', sourceAssetCode);

      if (peerId) {
        url.searchParams.append('peerId', peerId);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new AseExchangeServiceUnknownError(
          `HTTP error! status: ${response.status}`
        );
      }

      respData = await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const msg = `Request to ASE rates endpoint timed out after ${this._timeoutMs}ms`;
        this._logger.error(msg);
        throw new AseExchangeServiceTimeoutError(msg);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    // Validate the response structure
    if (
      !respData ||
      respData.base.toUpperCase() != sourceAssetCode.toUpperCase() ||
      !respData.rates ||
      Object.keys(respData.rates).length === 0
    ) {
      const msg = 'Invalid response format from ASE rates endpoint';
      this._logger.error(msg);
      throw new AseExchangeServiceUnknownError(msg);
    }

    const key = Object.keys(respData.rates).find(
      (key) => key.toUpperCase() === destinationAssetCode.toUpperCase()
    );
    if (!key) {
      this._logger.warn(
        `Could not get fx rate from ASE endpoint for ${sourceAssetCode} -> ${destinationAssetCode}.`
      );
      throw new AseExchangeServiceRateNotFoundError('');
    }

    this._logger.debug(
      `Got fx rate from ASE endpoint for ${sourceAssetCode} -> ${destinationAssetCode}`
    );

    return {
      rate: respData.rates[key],
      expiresAt: Date.now() + this._rateTtlMs
    };
  }

  async getIntraAseFxRate(
    sourceAssetCode: string,
    destinationAssetCode: string
  ): Promise<{ rate: number; expiresAt: number }> {
    this._logger.info(
      `Getting Intra ASE fx rate from ASE endpoint for ${sourceAssetCode} -> ${destinationAssetCode}...`
    );
    return await this._getDataFromAse(sourceAssetCode, destinationAssetCode);
  }

  async getPeerFxFromAse(
    sourceAssetCode: string,
    destinationAssetCode: string,
    peerId: string
  ): Promise<{ rate: number; expiresAt: number }> {
    this._logger.info(
      `Getting Peer fx rate from ASE endpoint for ${sourceAssetCode} -> ${destinationAssetCode}...`
    );
    return await this._getDataFromAse(
      sourceAssetCode,
      destinationAssetCode,
      peerId
    );
  }
}
