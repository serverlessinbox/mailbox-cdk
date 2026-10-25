import { create }                                                                                                                                                                      from '@bufbuild/protobuf';
import { createValidator, InvalidInputError }                                                                                                                                          from '@serverlessinbox/mailbox-addon-sdk';
import * as t                                                                                                                                                                          from 'typanion';

import type { CreateIdpUserRequest, DeleteIdpUserRequest, GetIdpUserRequest, ListIdpUsersRequest, SetIdpUserEnabledRequest, SetIdpUserPasswordRequest }                                from './generated/idp_users_pb';
import { CreateIdpUserRequestSchema, DeleteIdpUserRequestSchema, GetIdpUserRequestSchema, ListIdpUsersRequestSchema, SetIdpUserEnabledRequestSchema, SetIdpUserPasswordRequestSchema } from './generated/idp_users_pb';

const MIN_PASSWORD_LENGTH   = 8;
const MIN_PAGE_SIZE         = 1;
const MAX_PAGE_SIZE         = 1000;
const MAX_PAGE_TOKEN_LENGTH = 2048;

const isListIdpUsersBody = t.isPartial({
  pageSize:  t.isOptional(t.isNumber()),
  pageToken: t.isOptional(t.isString()),
  filter:    t.isOptional(t.isString()),
});
/** The body of a request to list users. */
type ListIdpUsersBody = t.InferType<typeof isListIdpUsersBody>;

const isUserNamedBody = t.isPartial({
  username: t.isOptional(t.isString()),
});
/** The body of a request that names one user and nothing else. */
type UserNamedBody = t.InferType<typeof isUserNamedBody>;

const isCreateIdpUserBody = t.isPartial({
  username: t.isOptional(t.isString()),
  email:    t.isOptional(t.isString()),
  password: t.isOptional(t.isString()),
  enabled:  t.isOptional(t.isBoolean()),
  groups:   t.isOptional(t.isArray(t.isString())),
});
/** The body of a request to create a user. */
type CreateIdpUserBody = t.InferType<typeof isCreateIdpUserBody>;

const isSetIdpUserEnabledBody = t.isPartial({
  username: t.isOptional(t.isString()),
  enabled:  t.isOptional(t.isBoolean()),
});
/** The body of a request to enable or disable a user. */
type SetIdpUserEnabledBody = t.InferType<typeof isSetIdpUserEnabledBody>;

const isSetIdpUserPasswordBody = t.isPartial({
  username:  t.isOptional(t.isString()),
  password:  t.isOptional(t.isString()),
  permanent: t.isOptional(t.isBoolean()),
});
/** The body of a request to set a user's password. */
type SetIdpUserPasswordBody = t.InferType<typeof isSetIdpUserPasswordBody>;

/**
 * Turns the JSON body of each IdP user request into its protobuf message and rejects, as invalid input, a body
 * whose fields have the wrong type or a request the API cannot act on. Authorization and existence of the user
 * are not decided here.
 */
export class IdpUsersRequestValidator {
  public readonly validateListIdpUsers = createValidator<ListIdpUsersRequest>(
    (body) => create(ListIdpUsersRequestSchema, this.readBody<ListIdpUsersBody>(body, isListIdpUsersBody)),
    (request) => this.assertListIdpUsers(request),
  );

  public readonly validateGetIdpUser = createValidator<GetIdpUserRequest>(
    (body) => create(GetIdpUserRequestSchema, this.readBody<UserNamedBody>(body, isUserNamedBody)),
    (request) => this.assertHasUsername(request),
  );

  public readonly validateCreateIdpUser = createValidator<CreateIdpUserRequest>(
    (body) => create(CreateIdpUserRequestSchema, this.readBody<CreateIdpUserBody>(body, isCreateIdpUserBody)),
    (request) => this.assertCreateIdpUser(request),
  );

  public readonly validateSetIdpUserEnabled = createValidator<SetIdpUserEnabledRequest>(
    (body) => create(SetIdpUserEnabledRequestSchema, this.readBody<SetIdpUserEnabledBody>(body, isSetIdpUserEnabledBody)),
    (request) => this.assertHasUsername(request),
  );

  public readonly validateSetIdpUserPassword = createValidator<SetIdpUserPasswordRequest>(
    (body) => create(SetIdpUserPasswordRequestSchema, this.readBody<SetIdpUserPasswordBody>(body, isSetIdpUserPasswordBody)),
    (request) => this.assertSetIdpUserPassword(request),
  );

  public readonly validateDeleteIdpUser = createValidator<DeleteIdpUserRequest>(
    (body) => create(DeleteIdpUserRequestSchema, this.readBody<UserNamedBody>(body, isUserNamedBody)),
    (request) => this.assertHasUsername(request),
  );

  private readBody<Body>(body: unknown, isBody: t.StrictValidator<unknown, Body>): Body {
    const bodyOrEmpty: unknown = body ?? {};
    const errors: string[]     = [];
    if (!isBody(bodyOrEmpty, { errors })) {
      throw new InvalidInputError(`Invalid request body: ${errors.join('; ')}`);
    }
    return bodyOrEmpty;
  }

  private assertListIdpUsers(request: ListIdpUsersRequest): void {
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

  private assertHasUsername(request: { username?: string }): void {
    if (!request.username || request.username.trim().length === 0) {
      throw new InvalidInputError('Missing/invalid username');
    }
  }

  private assertCreateIdpUser(request: CreateIdpUserRequest): void {
    this.assertHasUsername(request);
    this.assertPassword(request.password);
  }

  private assertSetIdpUserPassword(request: SetIdpUserPasswordRequest): void {
    this.assertHasUsername(request);
    this.assertPassword(request.password);
  }

  private assertPassword(password: string): void {
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      throw new InvalidInputError('Missing/invalid password');
    }
  }
}
