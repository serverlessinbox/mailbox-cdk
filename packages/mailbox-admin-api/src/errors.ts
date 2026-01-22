export class InvalidInputError extends Error {
  readonly name = 'InvalidInputError';
}

export class NotFoundError extends Error {
  readonly name = 'NotFoundError';
}

export class ForbiddenError extends Error {
  readonly name = 'ForbiddenError';
}

export class ConflictError extends Error {
  readonly name = 'ConflictError';

  constructor(
    message: string,
    public readonly reason?: string,
  ) {
    super(message);
  }
}

export function statusCodeForError(err: unknown): number {
  if (!err) return 200;

  if (err instanceof InvalidInputError) return 400;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ForbiddenError) return 403;

  if (err instanceof ConflictError) {
    const reason = (err.reason ?? err.message).toLowerCase();
    if (reason.includes('already exists')) return 400;
    return 409;
  }

  return 500;
}
