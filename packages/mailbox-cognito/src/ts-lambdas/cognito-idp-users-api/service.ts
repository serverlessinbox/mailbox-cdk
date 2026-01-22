import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

import type { MethodSpec, ServiceSpec, HandlerContext, AuditContext, AdminAuthContext } from '@sipkg/mailbox-admin-api';
import { ConflictError, InvalidInputError, NotFoundError } from '@sipkg/mailbox-admin-api';

import {
  type CreateIdpUserRequest,
  type CreateIdpUserResponse,
  type GetIdpUserRequest,
  type GetIdpUserResponse,
  type ListIdpUsersRequest,
  type ListIdpUsersResponse,
  type SetIdpUserEnabledRequest,
  type SetIdpUserEnabledResponse,
  type SetIdpUserPasswordRequest,
  type SetIdpUserPasswordResponse,
  CreateIdpUserRequestSchema,
  GetIdpUserRequestSchema,
  ListIdpUsersRequestSchema,
  SetIdpUserEnabledRequestSchema,
  SetIdpUserPasswordRequestSchema,
  IdpUserSchema,
  ListIdpUsersResponseSchema,
  GetIdpUserResponseSchema,
  CreateIdpUserResponseSchema,
  SetIdpUserEnabledResponseSchema,
  SetIdpUserPasswordResponseSchema,
} from './generated/idp_users_pb';

import { create, toJson } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';

function attrsToMap(
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

function toIdpUser(input: {
  Username?: string;
  Enabled?: boolean;
  UserStatus?: string;
  UserCreateDate?: Date;
  UserLastModifiedDate?: Date;
  Attributes?: Array<{ Name?: string; Value?: string }>;
}): any {
  const attributes = attrsToMap(input.Attributes) ?? {};
  return {
    username: input.Username ?? 'unknown',
    enabled: input.Enabled ?? false,
    userStatus: input.UserStatus,
    createdAt: input.UserCreateDate ? timestampFromDate(input.UserCreateDate) : undefined,
    modifiedAt: input.UserLastModifiedDate ? timestampFromDate(input.UserLastModifiedDate) : undefined,
    attributes,
  };
}

function getUserPoolId(): string {
  const id = process.env.USER_POOL_ID;
  if (!id) throw new Error('Missing USER_POOL_ID');
  return id;
}

const cognito = new CognitoIdentityProviderClient({});

const ListIdpUsers: MethodSpec<ListIdpUsersRequest, ListIdpUsersResponse, AdminAuthContext, AuditContext> = {
  name: 'ListIdpUsers',
  validate: (req: unknown): ListIdpUsersRequest => {
    // Note: this currently enforces typing via schema creation; validate.rules are not executed at runtime.
    // We still apply a few pragmatic checks below.
    const msg = create(ListIdpUsersRequestSchema, (req ?? {}) as any);
    if (msg.pageSize !== undefined) {
      const n = msg.pageSize;
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        throw new InvalidInputError('pageSize must be an integer between 1 and 1000');
      }
    }
    if (msg.pageToken && msg.pageToken.length > 2048) {
      throw new InvalidInputError('pageToken too long');
    }
    return msg;
  },
  serializeResponse: (resp) => toJson(ListIdpUsersResponseSchema, resp as any) as any,
  handler: async (_ctx: HandlerContext<AdminAuthContext, AuditContext>, req: ListIdpUsersRequest) => {
    const out = await cognito.send(
      new ListUsersCommand({
        UserPoolId: getUserPoolId(),
        Limit: req.pageSize ?? undefined,
        PaginationToken: req.pageToken ?? undefined,
        Filter: req.filter,
      })
    );

    return create(ListIdpUsersResponseSchema, {
      users: (out.Users ?? []).map((u) =>
        create(IdpUserSchema, toIdpUser({
          Username: u.Username,
          Enabled: u.Enabled,
          UserStatus: u.UserStatus,
          UserCreateDate: u.UserCreateDate,
          UserLastModifiedDate: u.UserLastModifiedDate,
          Attributes: u.Attributes,
        }))
      ),
      nextPageToken: out.PaginationToken ?? '',
    } as any);
  },
};

const GetIdpUser: MethodSpec<GetIdpUserRequest, GetIdpUserResponse, AdminAuthContext, AuditContext> = {
  name: 'GetIdpUser',
  validate: (req: unknown): GetIdpUserRequest => {
    const msg = create(GetIdpUserRequestSchema, (req ?? {}) as any);
    if (!msg.username || msg.username.trim().length === 0) throw new InvalidInputError('Missing/invalid username');
    return msg;
  },
  serializeResponse: (resp) => toJson(GetIdpUserResponseSchema, resp as any) as any,
  handler: async (ctx: HandlerContext<AdminAuthContext, AuditContext>, req: GetIdpUserRequest) => {
    try {
      const out = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: getUserPoolId(),
          Username: req.username,
        })
      );

      ctx.audit.entityId = req.username;
      ctx.audit.entityName = req.username;

      return create(GetIdpUserResponseSchema, {
        user: create(IdpUserSchema, {
          username: out.Username ?? req.username,
          enabled: out.Enabled ?? false,
          userStatus: out.UserStatus,
          createdAt: out.UserCreateDate ? timestampFromDate(out.UserCreateDate) : undefined,
          modifiedAt: out.UserLastModifiedDate ? timestampFromDate(out.UserLastModifiedDate) : undefined,
          attributes: attrsToMap(out.UserAttributes) ?? {},
        } as any),
      } as any);
    } catch (e: any) {
      const name = e?.name ?? '';
      if (name === 'UserNotFoundException') {
        throw new NotFoundError('User not found');
      }
      throw e;
    }
  },
};

const CreateIdpUser: MethodSpec<CreateIdpUserRequest, CreateIdpUserResponse, AdminAuthContext, AuditContext> = {
  name: 'CreateIdpUser',
  validate: (req: unknown): CreateIdpUserRequest => {
    const msg = create(CreateIdpUserRequestSchema, (req ?? {}) as any);
    if (!msg.username || msg.username.trim().length === 0) throw new InvalidInputError('Missing/invalid username');
    if (!msg.password || msg.password.length < 8) throw new InvalidInputError('Missing/invalid password');
    return msg;
  },
  serializeResponse: (resp) => toJson(CreateIdpUserResponseSchema, resp as any) as any,
  handler: async (ctx: HandlerContext<AdminAuthContext, AuditContext>, req: CreateIdpUserRequest) => {
    const userPoolId = getUserPoolId();

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
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
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
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: req.username,
        Password: req.password,
        Permanent: true,
      })
    );

    const desiredEnabled = req.enabled ?? true;
    if (!desiredEnabled) {
      await cognito.send(
        new AdminDisableUserCommand({
          UserPoolId: userPoolId,
          Username: req.username,
        })
      );
    }

    const groups = (req.groups && req.groups.length ? req.groups : ['user']).filter(Boolean);
    for (const groupName of groups) {
      try {
        await cognito.send(
          new AdminAddUserToGroupCommand({
            UserPoolId: userPoolId,
            Username: req.username,
            GroupName: groupName,
          })
        );
      } catch {
        // If groups are not configured, don't fail user creation.
      }
    }

    // Fetch final state
    const out = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: req.username,
      })
    );

    return create(CreateIdpUserResponseSchema, {
      user: create(IdpUserSchema, {
        username: out.Username ?? req.username,
        enabled: out.Enabled ?? desiredEnabled,
        userStatus: out.UserStatus,
        createdAt: out.UserCreateDate ? timestampFromDate(out.UserCreateDate) : undefined,
        modifiedAt: out.UserLastModifiedDate ? timestampFromDate(out.UserLastModifiedDate) : undefined,
        attributes: attrsToMap(out.UserAttributes) ?? {},
      } as any),
    } as any);
  },
};

const SetIdpUserEnabled: MethodSpec<SetIdpUserEnabledRequest, SetIdpUserEnabledResponse, AdminAuthContext, AuditContext> = {
  name: 'SetIdpUserEnabled',
  validate: (req: unknown): SetIdpUserEnabledRequest => {
    const msg = create(SetIdpUserEnabledRequestSchema, (req ?? {}) as any);
    if (!msg.username || msg.username.trim().length === 0) throw new InvalidInputError('Missing/invalid username');
    return msg;
  },
  serializeResponse: (resp) => toJson(SetIdpUserEnabledResponseSchema, resp as any) as any,
  handler: async (ctx: HandlerContext<AdminAuthContext, AuditContext>, req: SetIdpUserEnabledRequest) => {
    const userPoolId = getUserPoolId();

    ctx.audit.entityId = req.username;
    ctx.audit.entityName = req.username;
    ctx.audit.changes = [{ op: 'replace', path: '/enabled', value: req.enabled }];

    try {
      if (req.enabled) {
        await cognito.send(new AdminEnableUserCommand({ UserPoolId: userPoolId, Username: req.username }));
      } else {
        await cognito.send(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: req.username }));
      }
    } catch (e: any) {
      const name = e?.name ?? '';
      if (name === 'UserNotFoundException') throw new NotFoundError('User not found');
      throw e;
    }

    return create(SetIdpUserEnabledResponseSchema, {});
  },
};

const SetIdpUserPassword: MethodSpec<SetIdpUserPasswordRequest, SetIdpUserPasswordResponse, AdminAuthContext, AuditContext> = {
  name: 'SetIdpUserPassword',
  validate: (req: unknown): SetIdpUserPasswordRequest => {
    const msg = create(SetIdpUserPasswordRequestSchema, (req ?? {}) as any);
    if (!msg.username || msg.username.trim().length === 0) throw new InvalidInputError('Missing/invalid username');
    if (!msg.password || msg.password.length < 8) throw new InvalidInputError('Missing/invalid password');
    return msg;
  },
  serializeResponse: (resp) => toJson(SetIdpUserPasswordResponseSchema, resp as any) as any,
  handler: async (ctx: HandlerContext<AdminAuthContext, AuditContext>, req: SetIdpUserPasswordRequest) => {
    const userPoolId = getUserPoolId();

    ctx.audit.entityId = req.username;
    ctx.audit.entityName = req.username;
    ctx.audit.changes = [{ op: 'replace', path: '/password', value: '***' }];

    try {
      await cognito.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: userPoolId,
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
  },
};

export function createCognitoIdpUsersServiceSpec(): ServiceSpec<AdminAuthContext, AuditContext> {
  return {
    basePath: '/idp-users',
    serviceName: 'IdpUsersService',
    methods: {
      ListIdpUsers,
      GetIdpUser,
      CreateIdpUser,
      SetIdpUserEnabled,
      SetIdpUserPassword,
    },
  };
}
