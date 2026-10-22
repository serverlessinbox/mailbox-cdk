import { CaughtError, type LoggerBuffer, type TenantId }                  from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import type { ClientId, UserPoolId }                                      from '../shared/cognito-identifiers';
import { toScope, type Scope }                                            from '../shared/identity-identifiers';
import type { IdentityProvisionerClient }                                 from '../shared/identity-provisioner-client';
import type { DcrPersistResponse }                                        from '../shared/identity-provisioner-contract';

import type { CognitoUserPoolClientManager }                              from './cognito-client';
import { isClientRegistrationRequest, type ClientRegistrationRequest }    from './dcr.validation';
import type { RedirectUriPolicy }                                         from './redirect-uri';
import { RegistrationAnswers }                                            from './registration-answers';
import { SUPPORTED_SCOPES }                                               from './supported-scopes';

const DEFAULT_CLIENT_NAME = 'Unnamed JMAP Client';

/** The scope granted when a client asks for none, or for none that Cognito can bind. */
const DEFAULT_SCOPE = SUPPORTED_SCOPES.join(' ');

const OFFLINE_ACCESS_SCOPE = 'offline_access';

const INVALID_PARAMETER_EXCEPTION = 'InvalidParameterException';

/** How `identity-provisioner` answered the recording of a registration. */
type DcrPersistStatus = DcrPersistResponse['status'];

/**
 * `POST /oauth/register` (RFC 7591 Dynamic Client Registration), unauthenticated: validates a request, creates
 * the client in the user pool and records it with `identity-provisioner`.
 *
 * A rejection is answered, not thrown, and is only logged here.
 */
export class ClientRegistration {
  constructor(
    private readonly identityProvisioner: IdentityProvisionerClient,
    private readonly cognito: CognitoUserPoolClientManager,
    private readonly userPoolId: UserPoolId,
    private readonly redirectUriPolicy: RedirectUriPolicy,
    private readonly logger: LoggerBuffer,
  ) {}

  public async register(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
    const body = this.decodeBody(event);
    if (body === undefined) {
      return this.rejectInvalidJson();
    }

    const errors: string[] = [];
    if (!isClientRegistrationRequest(body, { errors })) {
      return this.rejectInvalidMetadata(errors);
    }

    if (!this.redirectUriPolicy.allowsAll(body.redirect_uris)) {
      return this.rejectRedirectUris();
    }

    const clientName = body.client_name?.trim() || DEFAULT_CLIENT_NAME;

    // The tenant is resolved from nothing the request carries: an identity-looking field in an
    // unauthenticated body must never select a tenant.
    const { tenantId } = await this.identityProvisioner.resolveTenant();

    const check = await this.identityProvisioner.dcrCheck({ tenantId, redirectUris: body.redirect_uris, clientName });
    if (check.status === 'dedup_hit') {
      return this.answerDuplicate(tenantId, body, clientName, check.clientId, check.scope);
    }
    if (check.status === 'cap_exceeded') {
      return this.rejectCapExceeded(tenantId);
    }

    return this.registerNewClient(tenantId, body, clientName);
  }

  private async registerNewClient(tenantId: TenantId, request: ClientRegistrationRequest, clientName: string): Promise<APIGatewayProxyStructuredResultV2> {
    const cognitoScopes = this.cognitoScopesOf(request.scope);

    let clientId: ClientId;
    try {
      clientId = await this.cognito.createClient(this.userPoolId, clientName, request.redirect_uris, cognitoScopes);
    } catch (failure) {
      return this.answerCreateFailure(failure, tenantId, request.scope, cognitoScopes);
    }

    const grantedScope = cognitoScopes.join(' ');

    let persistStatus: DcrPersistStatus;
    try {
      const persisted = await this.identityProvisioner.dcrPersist({
        tenantId,
        clientId,
        redirectUris: request.redirect_uris,
        clientName,
        scope: grantedScope,
      });
      persistStatus   = persisted.status;
    } catch (failure) {
      return this.answerPersistFailure(failure, tenantId, clientId);
    }

    if (persistStatus !== 'success') {
      return this.answerPersistConflict(tenantId, clientId, persistStatus);
    }

    this.logger.info('jmap_oauth_dcr_registered', { tenantId, clientId });
    return this.answerRegistered(request, clientId, grantedScope, clientName);
  }

  private decodeBody(event: APIGatewayProxyEventV2): unknown {
    if (!event.body) {
      return {};
    }

    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;
    try {
      return JSON.parse(raw);
    } catch {
      return this.treatAsNotJson();
    }
  }

  // A body that is not JSON is reported by an undefined body, which `register` answers as a rejection.
  private treatAsNotJson(): undefined {
    return undefined;
  }

  /**
   * The scopes Cognito is asked to allow, never empty. `CreateUserPoolClient` is called with
   * `AllowedOAuthFlowsUserPoolClient: true`, and Cognito then rejects an empty `AllowedOAuthScopes`. A request
   * for no scope, or only for `offline_access`, reduces to nothing; RFC 7591 §3.2.1 lets the server substitute a
   * value and report the granted one, so the default scope is granted instead.
   */
  private cognitoScopesOf(requested: string | undefined): Scope[] {
    const fromRequest = this.withoutOfflineAccess(requested?.trim() || DEFAULT_SCOPE);
    return fromRequest.length > 0 ? fromRequest : this.withoutOfflineAccess(DEFAULT_SCOPE);
  }

  private withoutOfflineAccess(scope: string): Scope[] {
    return scope
      .split(' ')
      .filter((token) => token.length > 0 && token !== OFFLINE_ACCESS_SCOPE)
      .map(toScope);
  }

  private answerRegistered(request: ClientRegistrationRequest, clientId: string, scope: string, clientName: string): APIGatewayProxyStructuredResultV2 {
    return RegistrationAnswers.created({
      client_id:                  clientId,
      client_id_issued_at:        Math.floor(Date.now() / 1000),
      redirect_uris:              request.redirect_uris,
      token_endpoint_auth_method: 'none',
      client_name:                clientName,
      scope,
    });
  }

  private answerDuplicate(
    tenantId: TenantId,
    request: ClientRegistrationRequest,
    clientName: string,
    clientId: ClientId,
    scope: string | undefined,
  ): APIGatewayProxyStructuredResultV2 {
    this.logger.info('jmap_oauth_dcr_dedup_hit', { tenantId, clientId });
    return this.answerRegistered(request, clientId, scope ?? DEFAULT_SCOPE, clientName);
  }

  // RFC 7591 §3.2.2: a registration error is HTTP 400. Cognito rejects a metadata value it will not accept
  // (a redirect URI it disallows, for one) with InvalidParameterException; that is a fault in the submitted
  // metadata. Anything else, such as throttling or an outage, is ours and stays a 500.
  private answerCreateFailure(failure: unknown, tenantId: TenantId, requestedScope: string | undefined, cognitoScopes: Scope[]): APIGatewayProxyStructuredResultV2 {
    this.logger.error('jmap_oauth_dcr_cognito_create_failed', {
      tenantId,
      requestedScope,
      cognitoScopes,
      error: String(failure),
    });

    if (new CaughtError(failure).is(INVALID_PARAMETER_EXCEPTION)) {
      return RegistrationAnswers.rejected(400, 'invalid_client_metadata', 'One or more client metadata values were rejected');
    }
    return RegistrationAnswers.rejected(500, 'server_error', 'Failed to create OAuth client');
  }

  private async answerPersistFailure(failure: unknown, tenantId: TenantId, clientId: ClientId): Promise<APIGatewayProxyStructuredResultV2> {
    this.logger.error('jmap_oauth_dcr_persist_error', { tenantId, clientId, error: String(failure) });
    await this.rollbackClient(tenantId, clientId);
    return RegistrationAnswers.rejected(500, 'server_error', 'Failed to persist client registration');
  }

  private async answerPersistConflict(tenantId: TenantId, clientId: ClientId, status: DcrPersistStatus): Promise<APIGatewayProxyStructuredResultV2> {
    this.logger.warn('jmap_oauth_dcr_persist_conflict', { tenantId, clientId, status });
    await this.rollbackClient(tenantId, clientId);
    return RegistrationAnswers.rejected(409, 'invalid_client_metadata', 'Client registration conflict');
  }

  // A client that cannot be deleted stays orphaned in the pool; that is logged and accepted, and the rejection is still answered.
  private async rollbackClient(tenantId: TenantId, clientId: ClientId): Promise<void> {
    try {
      await this.cognito.deleteClient(this.userPoolId, clientId);
    } catch (failure) {
      this.logger.error('jmap_oauth_dcr_rollback_failed', { tenantId, clientId, error: String(failure) });
    }
  }

  private rejectInvalidJson(): APIGatewayProxyStructuredResultV2 {
    this.logger.warn('jmap_oauth_dcr_rejected', { reason: 'invalid_json' });
    return RegistrationAnswers.rejected(400, 'invalid_client_metadata', 'Request body is not valid JSON');
  }

  private rejectInvalidMetadata(errors: string[]): APIGatewayProxyStructuredResultV2 {
    this.logger.warn('jmap_oauth_dcr_rejected', { reason: 'schema_validation', errors });
    return RegistrationAnswers.rejected(400, 'invalid_client_metadata', errors.join('; '));
  }

  private rejectRedirectUris(): APIGatewayProxyStructuredResultV2 {
    this.logger.warn('jmap_oauth_dcr_rejected', { reason: 'invalid_redirect_uri' });
    return RegistrationAnswers.rejected(400, 'invalid_redirect_uri', 'One or more redirect_uris are not permitted');
  }

  // The cap is the tenant's own limit, not a fault in the request, so the operator must see it: a warn would be buffered and never written.
  private rejectCapExceeded(tenantId: TenantId): APIGatewayProxyStructuredResultV2 {
    this.logger.error('jmap_oauth_dcr_rejected', { reason: 'cap_exceeded', tenantId });
    return RegistrationAnswers.rejected(429, 'invalid_client_metadata', 'Registration cap exceeded for this tenant');
  }
}
