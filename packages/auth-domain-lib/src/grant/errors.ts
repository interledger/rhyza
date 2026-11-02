import {
  AlreadyExists,
  FailedPrecondition,
  InvalidArgument,
  NotFound,
  PermissionDenied
} from 'common-types-lib';

export class NonInteractiveGrantError extends FailedPrecondition {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidInteractionError extends FailedPrecondition {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UnknownInteractionError extends NotFound {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UnknownAccessTokenError extends NotFound {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidGrantError extends FailedPrecondition {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidGrantInputError extends InvalidArgument {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class DuplicateGrantError extends AlreadyExists {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class GrantNotFoundError extends NotFound {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UnauthorizedRequestError extends PermissionDenied {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
