import {
  AseExchangeServiceRateNotFoundError,
  AseExchangeServiceTimeoutError,
  AseExchangeServiceUnknownError,
  IPalPeerAseFxService
} from 'pal-domain-lib';
import { ILogger } from 'common-types-lib';

export class AseFxServiceAdapter implements IPalPeerAseFxService {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _getDataFromAse(baseAssetCode: string): Promise<any> {
    const controller: AbortController = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeoutMs);

    try {
      const url = new URL(this._aseEndpointUrl);
      url.searchParams.append('base', baseAssetCode);

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await response.json();
      return data;
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
  }

  async getFxFromAse(
    sourceAssetCode: string,
    destinationAssetCode: string
  ): Promise<{ rate: number; expiresAt: number }> {
    this._logger.info(
      `Getting fx rate from ASE endpoint for ${sourceAssetCode} -> ${destinationAssetCode}...`
    );
    const respData = await this._getDataFromAse(sourceAssetCode);

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
}
