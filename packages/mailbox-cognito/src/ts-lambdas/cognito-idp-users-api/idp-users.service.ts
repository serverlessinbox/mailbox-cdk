import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  ListUsersCommand,
  type AdminGetUserCommandOutput,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { create }                                                                                                                                                                                                                                                                                      from '@bufbuild/protobuf';
import type { AdminAuthContext, AuditContext, HandlerContext }                                                                                                                                                                                                                                         from '@serverlessinbox/mailbox-admin-api';
import { ConflictError, InvalidInputError, NotFoundError }                                                                                                                                                                                                                                             from '@serverlessinbox/mailbox-admin-api';
import { CaughtError, toTenantId, type LoggerBuffer, type TenantId }                                                                                                                                                                                                                                   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { toGroupName, toUserSubject, toUsername, type GroupName, type UserPoolId, type UserSubject, type Username }                                                                                                                                                                                    from '../../runtime/shared/cognito-identifiers';
import { toEmailAddress, type EmailAddress }                                                                                                                                                                                                                                                           from '../../runtime/shared/identity-identifiers';
import type { IdentityProvisionerClient }                                                                                                                                                                                                                                                              from '../../runtime/shared/identity-provisioner-client';

import type { CreateIdpUserRequest, CreateIdpUserResponse, DeleteIdpUserRequest, DeleteIdpUserResponse, GetIdpUserRequest, GetIdpUserResponse, ListIdpUsersRequest, ListIdpUsersResponse, SetIdpUserEnabledRequest, SetIdpUserEnabledResponse, SetIdpUserPasswordRequest, SetIdpUserPasswordResponse } from './generated/idp_users_pb';
import { CreateIdpUserResponseSchema, DeleteIdpUserResponseSchema, GetIdpUserResponseSchema, ListIdpUsersResponseSchema, SetIdpUserEnabledResponseSchema, SetIdpUserPasswordResponseSchema }                                                                                                           from './generated/idp_users_pb';
import type { IdpUsersServiceHandlers }                                                                                                                                                                                                                                                                from './generated/idp_users_service';
import type { IdpUserMapper }                                                                                                                                                                                                                                                                          from './idp-user-mapper';

type IdpUsersContext = HandlerContext<AdminAuthContext, AuditContext>;

/** The Cognito failures this service answers as an admin API error rather than as a server error. */
type CognitoFailureName = 'UserNotFoundException' | 'InvalidParameterException' | 'InvalidPasswordException' | 'UsernameExistsException';

const ADMIN_API_ERROR_FOR: Record<CognitoFailureName, (failure: CaughtError) => Error> = {
  UserNotFoundException:     () => new NotFoundError('User not found'),
  InvalidParameterException: (failure) => new InvalidInputError(failure.message),
  InvalidPasswordException:  (failure) => new InvalidInputError(failure.message),
  UsernameExistsException:   () => new ConflictError('User already exists', 'already exists'),
};

const DEFAULT_GROUP   = 'user';
const MASKED_PASSWORD = '***';

/** What {@link CognitoIdpUsersService} needs besides the Cognito client and the user pool. */
export interface CognitoIdpUsersServiceDeps {
  readonly identityProvisioner: IdentityProvisionerClient;
  readonly userMapper:          IdpUserMapper;
  /** The names of the groups whose members are admins; compared case-insensitively. */
  readonly adminGroups?: GroupName[];
  readonly logger:       LoggerBuffer;
}

/**
 * Manages the users of one Cognito user pool for the IdP users API: it answers each request by calling Cognito,
 * records on the audit context what the request touched, and pre-provisions the mailbox principal of a created
 * user. It does not decide who may call it.
 */
export class CognitoIdpUsersService implements IdpUsersServiceHandlers<AdminAuthContext, AuditContext> {
  private readonly identityProvisioner: IdentityProvisionerClient;
  private readonly userMapper: IdpUserMapper;
  private readonly adminGroups: GroupName[];
  private readonly logger: LoggerBuffer;

  constructor(
    private readonly cognito: CognitoIdentityProviderClient,
    private readonly userPoolId: UserPoolId,
    deps: CognitoIdpUsersServiceDeps,
  ) {
    this.identityProvisioner = deps.identityProvisioner;
    this.userMapper          = deps.userMapper;
    this.adminGroups         = deps.adminGroups ?? [];
    this.logger              = deps.logger;
  }

  public async listIdpUsers(...[, req]: [IdpUsersContext, ListIdpUsersRequest]): Promise<ListIdpUsersResponse> {
    const output = await this.cognito.send(
      new ListUsersCommand({
        UserPoolId:      this.userPoolId,
        Limit:           req.pageSize,
        PaginationToken: req.pageToken,
        Filter:          req.filter,
      }),
    );

    return create(ListIdpUsersResponseSchema, {
      users:         (output.Users ?? []).map((user) => this.userMapper.fromListedUser(user)),
      nextPageToken: output.PaginationToken,
    });
  }

  public async getIdpUser(ctx: IdpUsersContext, req: GetIdpUserRequest): Promise<GetIdpUserResponse> {
    const username = toUsername(req.username);

    const output = await this.fetchUser(username).catch((thrown: unknown) => {
      throw this.translate(thrown, 'UserNotFoundException', 'InvalidParameterException');
    });
    this.auditEntity(ctx, username, username);

    return create(GetIdpUserResponseSchema, { user: this.userMapper.fromFetchedUser(output, username) });
  }

  /** A failure after the user was created deletes the user again and fails the request with that failure. */
  public async createIdpUser(ctx: IdpUsersContext, req: CreateIdpUserRequest): Promise<CreateIdpUserResponse> {
    const username = toUsername(req.username);
    const email    = req.email === undefined ? undefined : toEmailAddress(req.email);
    const enabled  = req.enabled ?? true;
    const groups   = this.groupsToJoin(req);

    this.auditEntity(ctx, username, email ?? username);
    ctx.audit.changes = [{ op: 'create', path: '/user', value: { username, email, enabled, groups: req.groups } }];

    await this.createUser(username, email, req.password);
    const output = await this.completeCreation(ctx, username, email, req.password, enabled, groups).catch((thrown: unknown) =>
      this.rollBackCreation(username, thrown),
    );

    return create(CreateIdpUserResponseSchema, { user: this.userMapper.fromFetchedUser(output, username, enabled) });
  }

  public async setIdpUserEnabled(ctx: IdpUsersContext, req: SetIdpUserEnabledRequest): Promise<SetIdpUserEnabledResponse> {
    const username = toUsername(req.username);

    this.auditEntity(ctx, username, username);
    ctx.audit.changes = [{ op: 'replace', path: '/enabled', value: req.enabled }];

    const input   = { UserPoolId: this.userPoolId, Username: username };
    const command = req.enabled ? new AdminEnableUserCommand(input) : new AdminDisableUserCommand(input);
    await this.cognito.send(command).catch((thrown: unknown) => {
      throw this.translate(thrown, 'UserNotFoundException', 'InvalidParameterException');
    });

    return create(SetIdpUserEnabledResponseSchema, {});
  }

  public async setIdpUserPassword(ctx: IdpUsersContext, req: SetIdpUserPasswordRequest): Promise<SetIdpUserPasswordResponse> {
    const username = toUsername(req.username);

    this.auditEntity(ctx, username, username);
    ctx.audit.changes = [{ op: 'replace', path: '/password', value: MASKED_PASSWORD }];

    await this.cognito
      .send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.userPoolId,
          Username:   username,
          Password:   req.password,
          Permanent:  req.permanent ?? true,
        }),
      )
      .catch((thrown: unknown) => {
        throw this.translate(thrown, 'UserNotFoundException', 'InvalidPasswordException', 'InvalidParameterException');
      });

    return create(SetIdpUserPasswordResponseSchema, {});
  }

  /** Deleting a user that does not exist succeeds. */
  public async deleteIdpUser(ctx: IdpUsersContext, req: DeleteIdpUserRequest): Promise<DeleteIdpUserResponse> {
    const username = toUsername(req.username);

    this.auditEntity(ctx, username, username);
    ctx.audit.changes = [{ op: 'remove', path: '/user', value: { username } }];

    await this.cognito
      .send(new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: username }))
      .catch((thrown: unknown) => this.rethrowUnlessUserIsGone(thrown));

    return create(DeleteIdpUserResponseSchema, {});
  }

  private auditEntity(ctx: IdpUsersContext, username: Username, entityName: Username | EmailAddress): void {
    ctx.audit.entityId   = username;
    ctx.audit.entityName = entityName;
  }

  /** A failure in `handled` becomes the admin API error for it; any other failure is returned as it is. */
  private translate(thrown: unknown, ...handled: CognitoFailureName[]): unknown {
    const failure     = new CaughtError(thrown);
    const handledName = handled.find((name) => failure.is(name));
    return handledName ? ADMIN_API_ERROR_FOR[handledName](failure) : thrown;
  }

  private rethrowUnlessUserIsGone(thrown: unknown): void {
    if (!new CaughtError(thrown).is('UserNotFoundException')) {
      throw this.translate(thrown, 'InvalidParameterException');
    }
  }

  private groupsToJoin(req: CreateIdpUserRequest): GroupName[] {
    const groups = req.groups.length > 0 ? req.groups : [DEFAULT_GROUP];
    return groups.filter(Boolean).map(toGroupName);
  }

  private isAdminGroup(group: GroupName): boolean {
    return this.adminGroups.some((adminGroup) => adminGroup.toLowerCase() === group.toLowerCase());
  }

  private async fetchUser(username: Username): Promise<AdminGetUserCommandOutput> {
    return this.cognito.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: username }));
  }

  private async createUser(username: Username, email: EmailAddress | undefined, temporaryPassword: string): Promise<void> {
    await this.cognito
      .send(
        new AdminCreateUserCommand({
          UserPoolId:        this.userPoolId,
          Username:          username,
          TemporaryPassword: temporaryPassword,
          MessageAction:     'SUPPRESS',
          UserAttributes:    email ? [{ Name: 'email', Value: email }] : [],
        }),
      )
      .catch((thrown: unknown) => {
        throw this.translate(thrown, 'UsernameExistsException', 'InvalidPasswordException', 'InvalidParameterException');
      });
  }

  private async setPermanentPassword(username: Username, password: string): Promise<void> {
    await this.cognito
      .send(new AdminSetUserPasswordCommand({ UserPoolId: this.userPoolId, Username: username, Password: password, Permanent: true }))
      .catch((thrown: unknown) => {
        throw this.translate(thrown, 'InvalidPasswordException', 'InvalidParameterException');
      });
  }

  private async completeCreation(
    ctx: IdpUsersContext,
    username: Username,
    email: EmailAddress | undefined,
    password: string,
    enabled: boolean,
    groups: GroupName[],
  ): Promise<AdminGetUserCommandOutput> {
    await this.setPermanentPassword(username, password);
    if (!enabled) {
      await this.disableUser(username);
    }
    await this.addToGroups(username, groups);

    const output = await this.fetchUser(username);
    await this.provisionMailboxPrincipal(ctx, output, username, email, groups);

    return output;
  }

  /** Deleting the user is best effort: when it fails the failure is logged and `failure` is still the one thrown. */
  private async rollBackCreation(username: Username, failure: unknown): Promise<never> {
    await this.cognito.send(new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: username })).catch((deleteFailure: unknown) => {
      this.logger.error('idp_user_rollback_delete_failed', { username, error: String(deleteFailure) });
    });

    throw failure;
  }

  private async disableUser(username: Username): Promise<void> {
    await this.cognito.send(new AdminDisableUserCommand({ UserPoolId: this.userPoolId, Username: username }));
  }

  /** Joining only some of the groups succeeds; joining none of them throws the first failure. */
  private async addToGroups(username: Username, groups: GroupName[]): Promise<void> {
    const failures: unknown[] = [];

    for (const group of groups) {
      await this.cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: this.userPoolId, Username: username, GroupName: group })).catch((thrown: unknown) => {
        this.logger.warn('idp_user_group_join_failed', { username, group, error: String(thrown) });
        failures.push(thrown);
      });
    }

    if (failures.length > 0 && failures.length === groups.length) {
      throw failures[0];
    }
  }

  /**
   * Pre-provisions the mailbox principal in `identity-provisioner` at user-creation time. The principal is
   * keyed by Cognito's `sub`, never the username: a username can be deleted and recreated under a new `sub`.
   */
  private async provisionMailboxPrincipal(
    ctx: IdpUsersContext,
    createdUser: AdminGetUserCommandOutput,
    username: Username,
    email: EmailAddress | undefined,
    groups: GroupName[],
  ): Promise<void> {
    const subject = this.subjectOf(createdUser);
    if (!subject) {
      this.logger.error('idp_user_provision_missing_sub', { username });
      throw new Error('Cognito reported no sub for the created user');
    }

    await this.identityProvisioner
      .provisionUser({
        tenantId: this.tenantOf(ctx),
        subject,
        username,
        email,
        groups,
        isAdmin: groups.some((group) => this.isAdminGroup(group)),
      })
      .catch((thrown: unknown) => {
        this.logger.error('idp_user_provision_invoke_failed', { username, error: String(thrown) });
        throw thrown;
      });
  }

  private tenantOf(ctx: IdpUsersContext): TenantId | undefined {
    return ctx.auth.tenantId === undefined ? undefined : toTenantId(ctx.auth.tenantId);
  }

  private subjectOf(user: AdminGetUserCommandOutput): UserSubject | undefined {
    const subject = user.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
    return subject ? toUserSubject(subject) : undefined;
  }
}
