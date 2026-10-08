import { LedgerPrecisionLossError } from './errors';

// Allows optional negative sign, digits, and optional decimal point with digits
const STRICT_NUMBER_REGEX = /^\d*$/;

/*
export function stringToBigint(stringValue: string, decimals: number): bigint {
  const num = Number(stringValue);
  const floatNum = +(num * (10**decimals)).toFixed(8);
  const intNum = Math.trunc(floatNum);
  if(intNum != floatNum)
    throw new AccountsAndBalancesError("Provided string number has more decimals than the decimals param, stringToBigint() would lose precision");
  return BigInt(intNum);
}

export function bigintToString(bigintValue: bigint, decimals: number): string {
  let num = Number(bigintValue);
  num = num / (10**decimals);
  return num.toString();
}
*/

/**
 * Converts a string-represented amount with a given source scale into a BigInt scaled to targetScale.
 *
 * @param sourceAmount - Integer amount string (e.g., "123456", "-1", "100")
 * @param sourceScale - Decimal precision of sourceAmount (e.g., 2 if "123.45" represents 123.456)
 * @param targetScale - Destination decimal precision of output integer string
 * @returns BigInt scaled to DEFAULT_DISPLAY_ASSET_SCALE (20)
 */

export function amountToBigIntOfSize(
  sourceAmount: string,
  sourceScale: number,
  targetScale: number
): bigint {
  if (sourceAmount === '0') return 0n;

  const trimmed = sourceAmount.trim();
  const isNegative = trimmed.startsWith('-');
  const absoluteAmount = isNegative ? trimmed.slice(1) : trimmed;

  if (absoluteAmount.length < sourceScale) {
    throw new LedgerPrecisionLossError(
      `Amount input error: sourceAmount (${sourceAmount}) is smaller than sourceScale (${sourceScale}).`
    );
  }

  // Validate that the input is strictly an integer
  if (!STRICT_NUMBER_REGEX.test(absoluteAmount)) {
    throw new Error(`Invalid integer amount: "${sourceAmount}"`);
  }

  const scaleDiff = targetScale - sourceScale;

  if (scaleDiff < 0) {
    throw new LedgerPrecisionLossError(
      `Loss of precision: sourceScale (${sourceScale}) cannot exceed targetScale (${targetScale}).`
    );
  }

  // Parse directly as BigInt
  let baseAmount = BigInt(absoluteAmount);
  if (isNegative) {
    baseAmount = -baseAmount;
  }

  // Apply scale difference multiplier
  if (scaleDiff > 0) {
    return baseAmount * 10n ** BigInt(scaleDiff);
  }

  return baseAmount;
}

/**
 * Converts a raw BigInt amount from `sourceScale` into a formatted decimal string scaled to `targetScale`.
 *
 * @param sourceAmount - BigInt amount (e.g., 10n, 10000n, 10000000000000000000n)
 * @param sourceScale - The precision scale of the incoming BigInt
 * @param targetScale - Desired decimal precision in the output string (defaults to 20)
 * @returns Formatted decimal string (e.g., "0.10", "10.000")
 */
export function amountFromBigIntOfSize(
  sourceAmount: bigint,
  sourceScale: number,
  targetScale: number
): string {
  if (sourceAmount === 0n) return '0';

  const scaleDiff = targetScale - sourceScale;

  if (scaleDiff < 0) {
    const divisor = 10n ** BigInt(Math.abs(scaleDiff));
    const remainder = sourceAmount % divisor;

    // Check if non-zero digits are being lost
    if (remainder !== 0n) {
      throw new LedgerPrecisionLossError(
        `Precision loss error: Cannot convert amount ${sourceAmount} from scale ${sourceScale} to ${targetScale} without discarding non-zero digits (${remainder}).`
      );
    }

    return (sourceAmount / divisor).toString();
  }

  if (scaleDiff > 0) {
    return (sourceAmount * 10n ** BigInt(scaleDiff)).toString();
  }

  return sourceAmount.toString();
}

export function convertAmountScale(
  sourceAmount: bigint,
  sourceScale: number,
  targetScale: number
): bigint {
  if (sourceAmount === 0n) return 0n;
  const scaleDiff = BigInt(targetScale - sourceScale);
  if (scaleDiff < 0n) {
    throw new LedgerPrecisionLossError(
      `Precision loss error: Cannot convert amount ${sourceAmount} from scale ${sourceScale} to ${targetScale} without discarding non-zero digits.`
    );
  }
  return sourceAmount * 10n ** scaleDiff;
}
