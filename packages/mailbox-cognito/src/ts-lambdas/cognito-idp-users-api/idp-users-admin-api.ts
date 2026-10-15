import {
  createAdminApiHandler,
  createServiceSpecFromRuntime,
  extractAdminAuthContext,
  ServiceRegistry,
  type AdminAuthContext,
  type ApiGatewayV2EventLike,
  type ApiGatewayV2ResultLike,
  type AuditContext,
} from '@serverlessinbox/mailbox-admin-api';
import { toIssuer, type Issuer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { toGroupName, toUserSubject, toUsername, type GroupName, type UserSubject, type Username } from '../shared/cognito-identifiers';
import { toEmailAddress, toScope, type EmailAddress, type Scope } from '../shared/identity-identifiers';
import { IdpUsersServiceRuntime, type IdpUsersServiceHandlers } from './generated/idp_users_service';
import type { IdpUsersRequestValidator } from './idp-users.validation';
import type { SqsAuditEmitter } from './sqs-audit-emitter';

type MethodName = keyof typeof IdpUsersServiceRuntime.methods;

/**
 * The handlers of the IdP users service with their names as keys. The admin API takes its handlers as a record
 * indexed by name, which an interface does not satisfy and this mapped type does.
 */
type IdpUsersHandlers = {
  [Handler in keyof IdpUsersServiceHandlers<AdminAuthContext, AuditContext>]: IdpUsersServiceHandlers<AdminAuthContext, AuditContext>[Handler];
};

const UNKNOWN_SUBJECT = toUserSubject('unknown');
const UNKNOWN_USERNAME = toUsername('unknown');

/** Who an audit event is attributed to: the signed-in user, or the system when the request carried no subject. */
interface AuditActor {
  readonly actorType: 'user' | 'system';
  readonly actorId: UserSubject;
  readonly username: Username;
  readonly iss?: Issuer;
  readonly email?: EmailAddress;
  readonly groups: GroupName[];
  readonly scopes: Scope[];
}

/**
 * The IdP users API: serves the requests of the user service through the admin API pipeline. It decides who a
 * request comes from, reading the authorizer context with the configured admin and user groups, and who an
 * audit event names as its actor.
 */
export class IdpUsersAdminApi {
  private readonly adminApiHandler: (event: ApiGatewayV2EventLike) => Promise<ApiGatewayV2ResultLike>;

  constructor(
    private readonly service: IdpUsersHandlers,
    private readonly validator: IdpUsersRequestValidator,
    private readonly auditEmitter: SqsAuditEmitter,
    private readonly adminGroups: GroupName[] | undefined,
    private readonly userGroups: GroupName[] | undefined,
  ) {
    this.adminApiHandler = createAdminApiHandler({
      registry: this.createRegistry(),
      extractAuth: (event) => this.extractAuth(event),
      emitAuditEvent: (event) => this.auditEmitter.emit(event),
      getTenantId: (auth) => auth.tenantId,
      getActor: (auth) => this.actorOf(auth),
    });
  }

  public handle(event: ApiGatewayV2EventLike): Promise<ApiGatewayV2ResultLike> {
    return this.adminApiHandler(event);
  }

  private createRegistry(): ServiceRegistry<AdminAuthContext, AuditContext> {
    const validatorByMethodName = {
      ListIdpUsers: this.validator.validateListIdpUsers,
      GetIdpUser: this.validator.validateGetIdpUser,
      CreateIdpUser: this.validator.validateCreateIdpUser,
      SetIdpUserEnabled: this.validator.validateSetIdpUserEnabled,
      SetIdpUserPassword: this.validator.validateSetIdpUserPassword,
      DeleteIdpUser: this.validator.validateDeleteIdpUser,
    } satisfies Record<MethodName, (request: unknown) => unknown>;
    const validators = new Map(Object.entries(validatorByMethodName));

    const registry = new ServiceRegistry<AdminAuthContext, AuditContext>();
    registry.register(
      createServiceSpecFromRuntime<AdminAuthContext, AuditContext>(IdpUsersServiceRuntime, this.service, {
        getValidator: (methodName) => validators.get(methodName),
      }),
    );
    return registry;
  }

  private extractAuth(event: ApiGatewayV2EventLike): AdminAuthContext {
    return extractAdminAuthContext(event, { adminGroups: this.adminGroups, userGroups: this.userGroups });
  }

  private actorOf(auth: AdminAuthContext): AuditActor {
    return {
      actorType: auth.authType === 'anonymous' ? 'system' : 'user',
      actorId: auth.sub === undefined ? UNKNOWN_SUBJECT : toUserSubject(auth.sub),
      username: toUsername(auth.username ?? auth.email ?? auth.sub ?? UNKNOWN_USERNAME),
      iss: auth.iss === undefined ? undefined : toIssuer(auth.iss),
      email: auth.email === undefined ? undefined : toEmailAddress(auth.email),
      groups: auth.groups.map(toGroupName),
      scopes: auth.scopes.map(toScope),
    };
  }
}
