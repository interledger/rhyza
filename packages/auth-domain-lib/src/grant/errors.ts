import { InvalidArgument } from 'common-types-lib';

export class NonInteractiveGrantError extends Error {}
export class InvalidInteractionError extends Error {}
export class UnknownInteractionError extends Error {}
export class UnknownAccessTokenError extends Error {}
export class InvalidGrantError extends Error {}
export class InvalidGrantInputError extends Error {}
export class DuplicateGrantError extends Error {}
export class GrantNotFoundError extends Error {}
export class UnauthorizedRequestError extends Error {}

/** A cursor that is malformed, unknown, or issued for a different query. */
export class InvalidCursorError extends InvalidArgument {
  constructor(message?: string) {
    super(message);
    this.name = 'InvalidCursorError';
  }
}
