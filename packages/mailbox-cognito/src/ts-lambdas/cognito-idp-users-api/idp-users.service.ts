import type { AdminGetUserCommandOutput, UserType } from '@aws-sdk/client-cognito-identity-provider';
import { AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminDisableUserCommand, AdminEnableUserCommand, AdminGetUserCommand, AdminSetUserPasswordCommand, CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';

import type { AdminAuthContext, AuditContext, HandlerContext } from '@serverlessinbox/mailbox-admin-api';
import { ConflictError, NotFoundError } from '@serverlessinbox/mailbox-admin-api';

import type { CreateIdpUserRequest, CreateIdpUserResponse, GetIdpUserRequest, GetIdpUserResponse, ListIdpUsersRequest, ListIdpUsersResponse, SetIdpUserEnabledRequest, SetIdpUserEnabledResponse, SetIdpUserPasswordRequest, SetIdpUserPasswordResponse } from './generated/idp_users_pb';
import type { IdpUser } from './generated/idp_users_pb';
import { CreateIdpUserResponseSchema, GetIdpUserResponseSchema, IdpUserSchema, ListIdpUsersResponseSchema, SetIdpUserEnabledResponseSchema, SetIdpUserPasswordResponseSchema } from './generated/idp_users_pb';

import { create } from '@bufbuild/protobuf';

import type { IdpUsersServiceHandlers } from './generated/idp_users_service';

import { timestampFromDate } from '@bufbuild/protobuf/wkt';

type IdpUsersContext = HandlerContext<AdminAuthContext, AuditContext>;

export class CognitoIdpUsersService implements IdpUsersServiceHandlers<AdminAuthContext, AuditContext> {
  private readonly cognito: CognitoIdentityProviderClient;
  private readonly userPoolId: string;

  constructor(client?: CognitoIdentityProviderClient, userPoolId?: string) {
    this.cognito = client ?? new CognitoIdentityProviderClient({});
    this.userPoolId = userPoolId ?? CognitoIdpUsersService.requireUserPoolIdFromEnv();
  }

  private static requireUserPoolIdFromEnv(): string {
    const id = process.env.USER_POOL_ID;
    if (!id) throw new Error('Missing USER_POOL_ID');
    return id;
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

    return create(CreateIdpUserResponseSchema, {
      user: create(IdpUserSchema, CognitoIdpUsersService.mapAdminGetUser(out, req.username, { enabledFallback: desiredEnabled })),
    } as any);
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
