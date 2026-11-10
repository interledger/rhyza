export type AppErrorType =
  | 'InvalidArgument'
  | 'NotFound'
  | 'AlreadyExists'
  | 'FailedPrecondition'
  | 'Internal'
  | 'Unavailable'
  | 'PermissionDenied'
  | 'Aborted';

export abstract class AppError extends Error {
  abstract readonly type: AppErrorType;

  constructor(message?: string) {
    super(message);
  }
}

export class InvalidArgument extends AppError {
  readonly type: AppErrorType = 'InvalidArgument';

  constructor(message?: string) {
    super(message);
    this.name = 'InvalidArgument';
  }
}

export class NotFound extends AppError {
  readonly type: AppErrorType = 'NotFound';

  constructor(message?: string) {
    super(message);
    this.name = 'NotFound';
  }
}

export class AlreadyExists extends AppError {
  readonly type: AppErrorType = 'AlreadyExists';

  constructor(message?: string) {
    super(message);
    this.name = 'AlreadyExists';
  }
}

export class FailedPrecondition extends AppError {
  readonly type: AppErrorType = 'FailedPrecondition';

  constructor(message?: string) {
    super(message);
    this.name = 'FailedPrecondition';
  }
}

export class Internal extends AppError {
  readonly type: AppErrorType = 'Internal';

  constructor(message?: string) {
    super(message);
    this.name = 'Internal';
  }
}

export class Unavailable extends AppError {
  readonly type: AppErrorType = 'Unavailable';

  constructor(message?: string) {
    super(message);
    this.name = 'Unavailable';
  }
}

export class PermissionDenied extends AppError {
  readonly type: AppErrorType = 'PermissionDenied';

  constructor(message?: string) {
    super(message);
    this.name = 'PermissionDenied';
  }
}

export class Aborted extends AppError {
  readonly type: AppErrorType = 'Aborted';

  constructor(message?: string) {
    super(message);
    this.name = 'Aborted';
  }
}

export function getErrorDetails(err: unknown): {
  errorName: string;
  errorType: AppErrorType;
  message: string;
} {
  if (err instanceof AppError) {
    return {
      errorName: err.name,
      errorType: err.type,
      message: err.message
    };
  }

  if (err instanceof Error) {
    return {
      errorName: err.name || err.constructor.name,
      errorType: 'Internal',
      message: err.message
    };
  }

  return {
    errorName: 'Error',
    errorType: 'Internal',
    message: String(err)
  };
}

/**
 * A pagination cursor that is malformed, unknown, or was issued for a
 * different query. An InvalidArgument so each transport maps it the same way
 * as any other bad input.
 */
export class InvalidCursorError extends InvalidArgument {
  constructor(message?: string) {
    super(message);
    this.name = 'InvalidCursorError';
  }
}
