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
import type { AuditEntry, HandlerContext }                                                                                                                                                                                                                                                             from '@serverlessinbox/mailbox-addon-sdk';
import { ConflictError, InvalidInputError, NotFoundError }                                                                                                                                                                                                                                             from '@serverlessinbox/mailbox-addon-sdk';
import { CaughtError, toTenantId, type LoggerBuffer, type TenantId }                                                                                                                                                                                                                                   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { toGroupName, toUserSubject, toUsername, type GroupName, type UserPoolId, type UserSubject, type Username }                                                                                                                                                                                    from '../../runtime/shared/cognito-identifiers';
import { toEmailAddress, type EmailAddress }                                                                                                                                                                                                                                                           from '../../runtime/shared/identity-identifiers';
import type { IdentityProvisionerClient }                                                                                                                                                                                                                                                              from '../../runtime/shared/identity-provisioner-client';

import type { CreateIdpUserRequest, CreateIdpUserResponse, DeleteIdpUserRequest, DeleteIdpUserResponse, GetIdpUserRequest, GetIdpUserResponse, ListIdpUsersRequest, ListIdpUsersResponse, SetIdpUserEnabledRequest, SetIdpUserEnabledResponse, SetIdpUserPasswordRequest, SetIdpUserPasswordResponse } from './generated/idp_users_pb';
import { CreateIdpUserResponseSchema, DeleteIdpUserResponseSchema, GetIdpUserResponseSchema, ListIdpUsersResponseSchema, SetIdpUserEnabledResponseSchema, SetIdpUserPasswordResponseSchema }                                                                                                           from './generated/idp_users_pb';
import type { IdpUsersServiceHandlers }                                                                                                                                                                                                                                                                from './generated/idp_users_service';
import type { IdpUserMapper }                                                                                                                                                                                                                                                                          from './idp-user-mapper';
import type { IdpUsersRequestValidator }                                                                                                                                                                                                                                                               from './idp-users.validation';

/** The Cognito failures this service answers as an admin API error rather than as a server error. */
type CognitoFailureName = 'UserNotFoundException' | 'InvalidParameterException' | 'InvalidPasswordException' | 'UsernameExistsException';

const ADMIN_API_ERROR_FOR: Record<CognitoFailureName, (failure: CaughtError) => Error> = {
  UserNotFoundException:     () => new NotFoundError('User not found'),
  InvalidParameterException: (failure) => new InvalidInputError(failure.message),
  InvalidPasswordException:  (failure) => new InvalidInputError(failure.message),
  UsernameExistsException:   () => new ConflictError('User already exists', 'already exists'),
};

type AuditChanges = NonNullable<AuditEntry['changes']>;

/** The user an audit entry names: the Cognito username, and what the entry calls the user. */
interface AuditedUser {
  readonly username: Username;
  readonly name:     Username | EmailAddress;
}

/** What {@link CognitoIdpUsersService} needs besides the Cognito client and the user pool. */
export interface CognitoIdpUsersServiceDeps {
  readonly identityProvisioner: IdentityProvisionerClient;
  readonly userMapper:          IdpUserMapper;
  readonly validator:           IdpUsersRequestValidator;
  /** The names of the groups whose members are admins; compared case-insensitively. */
  readonly adminGroups?: GroupName[];
  /** The groups a created user joins when the request names none. */
  readonly userGroups?: GroupName[];
  readonly logger:      LoggerBuffer;
}

/**
 * Manages the users of one Cognito user pool for the IdP users API: it answers each request by calling Cognito,
 * records in the audit what each change to a user did, and pre-provisions the mailbox principal of a created
 * user. It does not decide who may call it.
 */
export class CognitoIdpUsersService implements IdpUsersServiceHandlers {
  private readonly identityProvisioner: IdentityProvisionerClient;
  private readonly userMapper: IdpUserMapper;
  private readonly validator: IdpUsersRequestValidator;
  private readonly adminGroups: GroupName[];
  private readonly userGroups: GroupName[];
  private readonly logger: LoggerBuffer;

  constructor(
    private readonly cognito: CognitoIdentityProviderClient,
    private readonly userPoolId: UserPoolId,
    deps: CognitoIdpUsersServiceDeps,
  ) {
    this.identityProvisioner = deps.identityProvisioner;
    this.userMapper          = deps.userMapper;
    this.validator           = deps.validator;
    this.adminGroups         = deps.adminGroups ?? [];
    this.userGroups          = deps.userGroups ?? [];
    this.logger              = deps.logger;
  }

  public async listIdpUsers(_context: HandlerContext, req: ListIdpUsersRequest): Promise<ListIdpUsersResponse> {
    this.validator.validateListIdpUsers(req);

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

  public async getIdpUser(_context: HandlerContext, req: GetIdpUserRequest): Promise<GetIdpUserResponse> {
    this.validator.validateGetIdpUser(req);
    const username = toUsername(req.username);

    const output = await this.fetchUser(username).catch((thrown: unknown) => {
      throw this.translate(thrown, 'UserNotFoundException', 'InvalidParameterException');
    });

    return create(GetIdpUserResponseSchema, { user: this.userMapper.fromFetchedUser(output, username) });
  }

  /** A failure after the user was created deletes the user again and fails the request with that failure. */
  public async createIdpUser(context: HandlerContext, req: CreateIdpUserRequest): Promise<CreateIdpUserResponse> {
    this.validator.validateCreateIdpUser(req);
    const username = toUsername(req.username);
    const email    = req.email === undefined ? undefined : toEmailAddress(req.email);
    const enabled  = req.enabled ?? true;
    const groups   = this.groupsToJoin(req);

    const output = await this.audited(
      context,
      { username, name: email ?? username },
      [{ field: 'user', newValue: { username, email, enabled, groups: req.groups } }],
      () => this.createUserWithRollback(context, username, email, req.password, enabled, groups),
    );

    return create(CreateIdpUserResponseSchema, { user: this.userMapper.fromFetchedUser(output, username, enabled) });
  }

  public async setIdpUserEnabled(context: HandlerContext, req: SetIdpUserEnabledRequest): Promise<SetIdpUserEnabledResponse> {
    this.validator.validateSetIdpUserEnabled(req);
    const username = toUsername(req.username);

    await this.audited(context, { username, name: username }, [{ field: 'enabled', newValue: req.enabled }], async () => {
      const input   = { UserPoolId: this.userPoolId, Username: username };
      const command = req.enabled ? new AdminEnableUserCommand(input) : new AdminDisableUserCommand(input);
      await this.cognito.send(command).catch((thrown: unknown) => {
        throw this.translate(thrown, 'UserNotFoundException', 'InvalidParameterException');
      });
    });

    return create(SetIdpUserEnabledResponseSchema, {});
  }

  public async setIdpUserPassword(context: HandlerContext, req: SetIdpUserPasswordRequest): Promise<SetIdpUserPasswordResponse> {
    this.validator.validateSetIdpUserPassword(req);
    const username = toUsername(req.username);

    await this.audited(context, { username, name: username }, [{ field: 'password' }], async () => {
      await this.cognito
        .send(
          new AdminSetUserPasswordCommand({
            UserPoolId: this.userPoolId,
            Username:   username,
            Password:   req.password,
            Permanent:  false,
          }),
        )
        .catch((thrown: unknown) => {
          throw this.translate(thrown, 'UserNotFoundException', 'InvalidPasswordException', 'InvalidParameterException');
        });
    });

    return create(SetIdpUserPasswordResponseSchema, {});
  }

  /** Deleting a user that does not exist succeeds. */
  public async deleteIdpUser(context: HandlerContext, req: DeleteIdpUserRequest): Promise<DeleteIdpUserResponse> {
    this.validator.validateDeleteIdpUser(req);
    const username = toUsername(req.username);

    await this.audited(context, { username, name: username }, [{ field: 'user', oldValue: { username } }], async () => {
      await this.cognito
        .send(new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: username }))
        .catch((thrown: unknown) => this.rethrowUnlessUserIsGone(thrown));
    });

    return create(DeleteIdpUserResponseSchema, {});
  }

  /**
   * Runs `work` and records how it ended. A failed `work` is recorded and then fails the request with its own
   * failure, also when recording that failure fails; a failed success record fails the request.
   */
  private async audited<Result>(context: HandlerContext, user: AuditedUser, changes: AuditChanges, work: () => Promise<Result>): Promise<Result> {
    const result = await work().catch((thrown: unknown) => this.recordFailureAndRethrow(context, user, changes, thrown));

    await context.recordAudit({ status: 'success', entityId: user.username, entityName: user.name, changes });

    return result;
  }

  private async recordFailureAndRethrow(context: HandlerContext, user: AuditedUser, changes: AuditChanges, failure: unknown): Promise<never> {
    const errorMsg = failure instanceof Error ? failure.message : String(failure);

    await context.recordAudit({ status: 'failure', entityId: user.username, entityName: user.name, changes, errorMsg }).catch((auditFailure: unknown) => {
      this.logger.error('idp_user_failure_audit_failed', { username: user.username, error: String(auditFailure) });
    });

    throw failure;
  }

  /** A failure in `handled` becomes the admin API error for it; any other failure is returned as it is. */
  private translate(thrown: unknown, ...handled: CognitoFailureName[]): unknown {
    const failure     = new CaughtError(thrown);
    const handledName = handled.find((name) => failure.is(name));
    return handledName ? ADMIN_API_ERROR_FOR[handledName](failure) : thrown;
  }

  private rethrowUnlessUserIsGone(thrown: unknown): void {
    if (!CaughtError.is(thrown, 'UserNotFoundException')) {
      throw this.translate(thrown, 'InvalidParameterException');
    }
  }

  private groupsToJoin(req: CreateIdpUserRequest): GroupName[] {
    const groups = req.groups.length > 0 ? req.groups : this.userGroups;
    return groups.filter(Boolean).map(toGroupName);
  }

  private isAdminGroup(group: GroupName): boolean {
    return this.adminGroups.some((adminGroup) => adminGroup.toLowerCase() === group.toLowerCase());
  }

  private async fetchUser(username: Username): Promise<AdminGetUserCommandOutput> {
    return this.cognito.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: username }));
  }

  private async createUserWithRollback(
    context: HandlerContext,
    username: Username,
    email: EmailAddress | undefined,
    password: string,
    enabled: boolean,
    groups: GroupName[],
  ): Promise<AdminGetUserCommandOutput> {
    await this.createUser(username, email, password);

    return this.completeCreation(toTenantId(context.caller.tenantId), username, email, enabled, groups).catch((thrown: unknown) =>
      this.rollBackCreation(username, thrown),
    );
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

  private async completeCreation(
    tenantId: TenantId,
    username: Username,
    email: EmailAddress | undefined,
    enabled: boolean,
    groups: GroupName[],
  ): Promise<AdminGetUserCommandOutput> {
    if (!enabled) {
      await this.disableUser(username);
    }
    await this.addToGroups(username, groups);

    const output = await this.fetchUser(username);
    await this.provisionMailboxPrincipal(tenantId, output, username, email, groups);

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
    tenantId: TenantId,
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
        tenantId,
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

  private subjectOf(user: AdminGetUserCommandOutput): UserSubject | undefined {
    const subject = user.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
    return subject ? toUserSubject(subject) : undefined;
  }
}
