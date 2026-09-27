import type { AdminGetUserCommandOutput, UserType } from '@aws-sdk/client-cognito-identity-provider';
import { AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminDeleteUserCommand, AdminDisableUserCommand, AdminEnableUserCommand, AdminGetUserCommand, AdminSetUserPasswordCommand, CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';

import type { AdminAuthContext, AuditContext, HandlerContext } from '@serverlessinbox/mailbox-admin-api';
import { ConflictError, NotFoundError } from '@serverlessinbox/mailbox-admin-api';
import type { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { CreateIdpUserRequest, CreateIdpUserResponse, DeleteIdpUserRequest, DeleteIdpUserResponse, GetIdpUserRequest, GetIdpUserResponse, ListIdpUsersRequest, ListIdpUsersResponse, SetIdpUserEnabledRequest, SetIdpUserEnabledResponse, SetIdpUserPasswordRequest, SetIdpUserPasswordResponse } from './generated/idp_users_pb';
import type { IdpUser } from './generated/idp_users_pb';
import { CreateIdpUserResponseSchema, DeleteIdpUserResponseSchema, GetIdpUserResponseSchema, IdpUserSchema, ListIdpUsersResponseSchema, SetIdpUserEnabledResponseSchema, SetIdpUserPasswordResponseSchema } from './generated/idp_users_pb';

import { create } from '@bufbuild/protobuf';

import type { IdpUsersServiceHandlers } from './generated/idp_users_service';

import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { IdentityProvisionerClient } from './identity-provisioner-client';

type IdpUsersContext = HandlerContext<AdminAuthContext, AuditContext>;

/** Dependencies {@link CognitoIdpUsersService} needs beyond the Cognito client + pool id, kept in
 *  one named shape rather than growing the constructor's positional parameter list. */
export interface CognitoIdpUsersServiceDeps {
  /** Client for pre-provisioning a mailbox principal at user-creation time (Requirement 4). */
  readonly identityProvisioner: IdentityProvisionerClient;
  /** Configured admin-group names, used to derive `isAdmin` for the provisioning invoke —
   *  matching `extractAdminAuthContext`'s case-insensitive comparison. */
  readonly adminGroups?: string[];
  readonly logger: LoggerBuffer;
}

export class CognitoIdpUsersService implements IdpUsersServiceHandlers<AdminAuthContext, AuditContext> {
  private readonly cognito: CognitoIdentityProviderClient;
  private readonly userPoolId: string;
  private readonly identityProvisioner: IdentityProvisionerClient;
  private readonly adminGroups: string[];
  private readonly logger: LoggerBuffer;

  constructor(client: CognitoIdentityProviderClient | undefined, userPoolId: string, deps: CognitoIdpUsersServiceDeps) {
    this.cognito = client ?? new CognitoIdentityProviderClient({});
    this.userPoolId = userPoolId;
    this.identityProvisioner = deps.identityProvisioner;
    this.adminGroups = (deps.adminGroups ?? []).map((g) => g.toLowerCase());
    this.logger = deps.logger;
  }

  async listIdpUsers(_ctx: IdpUsersContext, req: ListIdpUsersRequest): Promise<ListIdpUsersResponse> {
    const out = await this.cognito.send(
      new ListUsersCommand({
        UserPoolId: this.userPoolId,
        Limit: req.pageSize ?? undefined,
        PaginationToken: req.pageToken ?? undefined,
        Filter: req.filter,
      })
    );

    return create(ListIdpUsersResponseSchema, {
      users: (out.Users ?? []).map((u) =>
        create(IdpUserSchema, CognitoIdpUsersService.mapListUser(u))
      ),
      nextPageToken: out.PaginationToken ?? '',
    } as any);
  }

  async getIdpUser(ctx: IdpUsersContext, req: GetIdpUserRequest): Promise<GetIdpUserResponse> {
    try {
      const out = await this.cognito.send(
        new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: req.username,
        })
      );

      ctx.audit.entityId = req.username;
      ctx.audit.entityName = req.username;

      return create(GetIdpUserResponseSchema, {
        user: create(IdpUserSchema, CognitoIdpUsersService.mapAdminGetUser(out, req.username)),
      } as any);
    } catch (e: any) {
      const name = e?.name ?? '';
      if (name === 'UserNotFoundException') {
        throw new NotFoundError('User not found');
      }
      throw e;
    }
  }

  async createIdpUser(ctx: IdpUsersContext, req: CreateIdpUserRequest): Promise<CreateIdpUserResponse> {
    ctx.audit.entityId = req.username;
    ctx.audit.entityName = req.email ?? req.username;
    ctx.audit.changes = [
      {
        op: 'create',
        path: '/user',
        value: {
          username: req.username,
          email: req.email,
          enabled: req.enabled ?? true,
          groups: req.groups,
        },
      },
    ];

    try {
      await this.cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: req.username,
          TemporaryPassword: req.password,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            ...(req.email
              ? [
                { Name: 'email', Value: req.email },
                // We suppress messages anyway, but keep verified=false by default.
              ]
              : []),
          ],
        })
      );
    } catch (e: any) {
      const name = e?.name ?? '';
      if (name === 'UsernameExistsException') {
        throw new ConflictError('User already exists', 'already exists');
      }
      throw e;
    }

    // Set a permanent password so the admin can hand it to the user (no email dependency).
    await this.cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: this.userPoolId,
        Username: req.username,
        Password: req.password,
        Permanent: true,
      })
    );

    const desiredEnabled = req.enabled ?? true;
    if (!desiredEnabled) {
      await this.cognito.send(
        new AdminDisableUserCommand({
          UserPoolId: this.userPoolId,
          Username: req.username,
        })
      );
    }

    const groups = (req.groups && req.groups.length ? req.groups : ['user']).filter(Boolean);
    for (const groupName of groups) {
      try {
        await this.cognito.send(
          new AdminAddUserToGroupCommand({
            UserPoolId: this.userPoolId,
            Username: req.username,
            GroupName: groupName,
          })
        );
      } catch {
        // If groups are not configured, don't fail user creation.
      }
    }

    // Fetch final state
    const out = await this.cognito.send(
      new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: req.username,
      })
    );

    await this.provisionMailboxPrincipal(ctx, out, req.username, req.email, groups);

    return create(CreateIdpUserResponseSchema, {
      user: create(IdpUserSchema, CognitoIdpUsersService.mapAdminGetUser(out, req.username, { enabledFallback: desiredEnabled })),
    } as any);
  }

  /**
   * Pre-provisions the mailbox principal in `identity-provisioner` at user-creation time
   * (Requirement 4). Fire-and-forget: any failure is logged and swallowed so `createIdpUser`
   * still returns success — the person falls back to the existing first-sign-in provisioning
   * path, which is not a degraded state.
   *
   * `subject` is Cognito's immutable `sub`, never `username` — a username can be deleted and
   * recreated under a new `sub`, and a username-keyed mapping would misdirect a future person
   * into a previous person's mailbox.
   */
  private async provisionMailboxPrincipal(
    ctx: IdpUsersContext,
    adminGetUserOutput: AdminGetUserCommandOutput,
    username: string,
    email: string | undefined,
    groups: string[],
  ): Promise<void> {
    const subject = CognitoIdpUsersService.extractSub(adminGetUserOutput);
    if (!subject) {
      this.logger.error('idp_user_provision_missing_sub', { username });
      this.logger.flush();
      return;
    }

    const isAdmin = groups.some((g) => this.adminGroups.includes(g.toLowerCase()));

    try {
      await this.identityProvisioner.provisionUser({
        tenantId: ctx.auth.tenantId,
        subject,
        username,
        email,
        groups,
        isAdmin,
      });
    } catch (err) {
      this.logger.error('idp_user_provision_invoke_failed', { username, error: String(err) });
      this.logger.flush();
    }
  }

  private static extractSub(output: AdminGetUserCommandOutput): string | undefined {
    return output.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
  }

  async setIdpUserEnabled(ctx: IdpUsersContext, req: SetIdpUserEnabledRequest): Promise<SetIdpUserEnabledResponse> {
    ctx.audit.entityId = req.username;
    ctx.audit.entityName = req.username;
    ctx.audit.changes = [{ op: 'replace', path: '/enabled', value: req.enabled }];

    try {
      if (req.enabled) {
        await this.cognito.send(new AdminEnableUserCommand({ UserPoolId: this.userPoolId, Username: req.username }));
      } else {
        await this.cognito.send(new AdminDisableUserCommand({ UserPoolId: this.userPoolId, Username: req.username }));
      }
    } catch (e: any) {
      const name = e?.name ?? '';
      if (name === 'UserNotFoundException') throw new NotFoundError('User not found');
      throw e;
    }

    return create(SetIdpUserEnabledResponseSchema, {});
  }

  async setIdpUserPassword(ctx: IdpUsersContext, req: SetIdpUserPasswordRequest): Promise<SetIdpUserPasswordResponse> {
    ctx.audit.entityId = req.username;
    ctx.audit.entityName = req.username;
    ctx.audit.changes = [{ op: 'replace', path: '/password', value: '***' }];

    try {
      await this.cognito.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.userPoolId,
          Username: req.username,
          Password: req.password,
          Permanent: req.permanent ?? true,
        })
      );
    } catch (e: any) {
      const name = e?.name ?? '';
      if (name === 'UserNotFoundException') throw new NotFoundError('User not found');
      throw e;
    }

    return create(SetIdpUserPasswordResponseSchema, {});
  }

  async deleteIdpUser(ctx: IdpUsersContext, req: DeleteIdpUserRequest): Promise<DeleteIdpUserResponse> {
    ctx.audit.entityId = req.username;
    ctx.audit.entityName = req.username;
    ctx.audit.changes = [{ op: 'remove', path: '/user', value: { username: req.username } }];

    try {
      await this.cognito.send(
        new AdminDeleteUserCommand({
          UserPoolId: this.userPoolId,
          Username: req.username,
        })
      );
    } catch (e: any) {
      const name = e?.name ?? '';
      if (name === 'UserNotFoundException') {
        // Idempotent: already gone — treat as success.
        return create(DeleteIdpUserResponseSchema, {});
      }
      throw e;
    }

    return create(DeleteIdpUserResponseSchema, {});
  }

  private static mapListUser(user: UserType): IdpUserInit {
    return {
      username: user.Username ?? 'unknown',
      enabled: user.Enabled ?? false,
      userStatus: user.UserStatus,
      createdAt: user.UserCreateDate ? timestampFromDate(user.UserCreateDate) : undefined,
      modifiedAt: user.UserLastModifiedDate ? timestampFromDate(user.UserLastModifiedDate) : undefined,
      attributes: this.attrsToMap(user.Attributes) ?? {},
    };
  }

  private static mapAdminGetUser(
    output: AdminGetUserCommandOutput,
    fallbackUsername: string,
    opts?: { enabledFallback?: boolean }
  ): IdpUserInit {
    return {
      username: output.Username ?? fallbackUsername,
      enabled: output.Enabled ?? opts?.enabledFallback ?? false,
      userStatus: output.UserStatus,
      createdAt: output.UserCreateDate ? timestampFromDate(output.UserCreateDate) : undefined,
      modifiedAt: output.UserLastModifiedDate ? timestampFromDate(output.UserLastModifiedDate) : undefined,
      attributes: this.attrsToMap(output.UserAttributes) ?? {},
    };
  }

  private static attrsToMap(
    attrs: Array<{ Name?: string; Value?: string }> | undefined
  ): Record<string, string> | undefined {
    if (!attrs || attrs.length === 0) return undefined;
    const out: Record<string, string> = {};
    for (const a of attrs) {
      if (a?.Name && typeof a.Value === 'string') {
        out[a.Name] = a.Value;
      }
    }
    return Object.keys(out).length ? out : undefined;
  }
}

type IdpUserInit = {
  readonly $typeName?: undefined;
  username?: IdpUser['username'];
  enabled?: IdpUser['enabled'];
  userStatus?: IdpUser['userStatus'];
  createdAt?: IdpUser['createdAt'];
  modifiedAt?: IdpUser['modifiedAt'];
  attributes?: IdpUser['attributes'];
};
