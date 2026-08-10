import { create } from '@bufbuild/protobuf';

import { createValidator, InvalidInputError } from '@serverlessinbox/mailbox-admin-api';

import type { CreateIdpUserRequest, DeleteIdpUserRequest, GetIdpUserRequest, ListIdpUsersRequest, SetIdpUserEnabledRequest, SetIdpUserPasswordRequest } from './generated/idp_users_pb';
import { CreateIdpUserRequestSchema, DeleteIdpUserRequestSchema, GetIdpUserRequestSchema, ListIdpUsersRequestSchema, SetIdpUserEnabledRequestSchema, SetIdpUserPasswordRequestSchema } from './generated/idp_users_pb';

export class IdpUsersRequestValidator {
  validateListIdpUsers = createValidator<ListIdpUsersRequest>((req) => create(ListIdpUsersRequestSchema, (req ?? {}) as any), (msg) => this.assertListIdpUsers(msg));

  validateGetIdpUser = createValidator<GetIdpUserRequest>((req) => create(GetIdpUserRequestSchema, (req ?? {}) as any), (msg) => this.assertHasUsername(msg));

  validateCreateIdpUser = createValidator<CreateIdpUserRequest>((req) => create(CreateIdpUserRequestSchema, (req ?? {}) as any), (msg) => this.assertCreateIdpUser(msg));

  validateSetIdpUserEnabled = createValidator<SetIdpUserEnabledRequest>((req) => create(SetIdpUserEnabledRequestSchema, (req ?? {}) as any), (msg) => this.assertHasUsername(msg));

  validateSetIdpUserPassword = createValidator<SetIdpUserPasswordRequest>((req) => create(SetIdpUserPasswordRequestSchema, (req ?? {}) as any), (msg) => this.assertSetIdpUserPassword(msg));

  validateDeleteIdpUser = createValidator<DeleteIdpUserRequest>((req) => create(DeleteIdpUserRequestSchema, (req ?? {}) as any), (msg) => this.assertHasUsername(msg));

  private assertListIdpUsers(msg: ListIdpUsersRequest): void {
    // Note: this currently enforces typing via schema creation; validate.rules are not executed at runtime.
    // We still apply a few pragmatic checks below.
    if (msg.pageSize !== undefined) {
      const n = msg.pageSize;
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        throw new InvalidInputError('pageSize must be an integer between 1 and 1000');
      }
    }
    if (msg.pageToken && msg.pageToken.length > 2048) {
      throw new InvalidInputError('pageToken too long');
    }
  }

  private assertHasUsername(msg: { username?: string }): void {
    if (!msg.username || msg.username.trim().length === 0) throw new InvalidInputError('Missing/invalid username');
  }

  private assertCreateIdpUser(msg: CreateIdpUserRequest): void {
    this.assertHasUsername(msg);
    if (!msg.password || msg.password.length < 8) throw new InvalidInputError('Missing/invalid password');
  }

  private assertSetIdpUserPassword(msg: SetIdpUserPasswordRequest): void {
    this.assertHasUsername(msg);
    if (!msg.password || msg.password.length < 8) throw new InvalidInputError('Missing/invalid password');
  }
}
