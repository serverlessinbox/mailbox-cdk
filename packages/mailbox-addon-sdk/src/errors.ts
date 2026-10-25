/** A request that is malformed or fails validation. */
export class InvalidInputError extends Error {
  readonly name = 'InvalidInputError';
}

/** The request carries no valid identity: the authorizer supplied no tenant or no subject. */
export class UnauthenticatedError extends Error {
  readonly name = 'UnauthenticatedError';
}

/** The entity a request would create already exists. */
export class AlreadyExistsError extends Error {
  readonly name = 'AlreadyExistsError';
}

/** The entity a request names does not exist. */
export class NotFoundError extends Error {
  readonly name = 'NotFoundError';
}

/** The caller is not allowed to make the request. */
export class ForbiddenError extends Error {
  readonly name = 'ForbiddenError';
}

/** The request conflicts with the current state of the entity; `reason` names the conflict when the message does not. */
export class ConflictError extends Error {
  readonly name = 'ConflictError';

  constructor(
    message: string,
    public readonly reason?: string,
  ) {
    super(message);
  }
}
