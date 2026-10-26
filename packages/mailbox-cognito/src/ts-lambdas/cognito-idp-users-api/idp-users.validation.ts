import { InvalidInputError }                                                         from '@serverlessinbox/mailbox-addon-sdk';

import type { CreateIdpUserRequest, ListIdpUsersRequest, SetIdpUserPasswordRequest } from './generated/idp_users_pb';

const MIN_PASSWORD_LENGTH   = 8;
const MIN_PAGE_SIZE         = 1;
const MAX_PAGE_SIZE         = 1000;
const MAX_PAGE_TOKEN_LENGTH = 2048;

/** A request that names one user. */
interface UserNamedRequest {
  readonly username: string;
}

/**
 * Rejects, as invalid input, a decoded IdP user request the API cannot act on. The shape of the body is decoded
 * by the service wrapper; authorization and existence of the user are not decided here.
 */
export class IdpUsersRequestValidator {
  public validateListIdpUsers(request: ListIdpUsersRequest): void {
    if (request.pageSize !== undefined) {
      const pageSize = request.pageSize;
      if (!Number.isInteger(pageSize) || pageSize < MIN_PAGE_SIZE || pageSize > MAX_PAGE_SIZE) {
        throw new InvalidInputError(`pageSize must be an integer between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}`);
      }
    }
    if (request.pageToken && request.pageToken.length > MAX_PAGE_TOKEN_LENGTH) {
      throw new InvalidInputError('pageToken too long');
    }
  }

  public validateGetIdpUser(request: UserNamedRequest): void {
    this.assertHasUsername(request);
  }

  public validateCreateIdpUser(request: CreateIdpUserRequest): void {
    this.assertHasUsername(request);
    this.assertPassword(request.password);
  }

  public validateSetIdpUserEnabled(request: UserNamedRequest): void {
    this.assertHasUsername(request);
  }

  public validateSetIdpUserPassword(request: SetIdpUserPasswordRequest): void {
    this.assertHasUsername(request);
    this.assertPassword(request.password);
  }

  public validateDeleteIdpUser(request: UserNamedRequest): void {
    this.assertHasUsername(request);
  }

  private assertHasUsername(request: UserNamedRequest): void {
    if (!request.username || request.username.trim().length === 0) {
      throw new InvalidInputError('Missing/invalid username');
    }
  }

  private assertPassword(password: string): void {
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      throw new InvalidInputError('Missing/invalid password');
    }
  }
}
