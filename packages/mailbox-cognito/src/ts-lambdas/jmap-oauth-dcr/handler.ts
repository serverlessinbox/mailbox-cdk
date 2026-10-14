import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { LoggerBuffer, type LogLevel } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { CognitoUserPoolClientManager } from './cognito-client';
import { ClientRegistrationErrorResponse, ClientRegistrationRequest, ClientRegistrationResponse, isClientRegistrationRequest } from './dcr.validation';
import { IdentityProvisionerClient } from '../shared/identity-provisioner-client';
import { resolvePoolId } from './pool-resolver';
import { validateRedirectUris } from './redirect-uri';

/**
 * `POST /oauth/register` (RFC 7591 Dynamic Client Registration), unauthenticated.
 *
 * Rejections (schema, redirect-URI, dedup-cap) are recorded via structured `console` logs only —
 * deliberately never sent through `identity-provisioner` or the audit queue, since that Lambda is
 * broadly privileged and first-login-critical and must not carry abuse-flood-shaped traffic.
 */

const DEFAULT_CLIENT_NAME = 'Unnamed JMAP Client';

/**
 * Default requested scope when the client omits `scope` entirely. Matches the
 * `scopes_supported` list already published in the OIDC discovery document
 * (`jmap-oauth-addon.ts`). Not pinned by the plan — a reasonable default, not a spec mandate.
 */
const DEFAULT_SCOPE = 'openid email profile offline_access';

/**
 * These are provided by the entry point after config has been loaded.
 */
export interface HandlerDependencies {
  readonly identityProvisioner: IdentityProvisionerClient;
  readonly cognito: CognitoUserPoolClientManager;
  readonly userPoolId: string;
  readonly serviceName: string;
  readonly logLevel: LogLevel;
}

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      pragma: 'no-cache',
    },
    body: JSON.stringify(body),
  };
}

function errorResponse(statusCode: number, error: ClientRegistrationErrorResponse['error'], description?: string): APIGatewayProxyResultV2 {
  const body: ClientRegistrationErrorResponse = {
    error,
    ...(description ? { error_description: description } : {}),
  };
  return jsonResponse(statusCode, body);
}

/** Strips `offline_access` from a space-separated scope string — see `cognito-client.ts`. */
function cognitoBoundScopes(scope: string): string[] {
  return scope.split(' ').filter((s) => s.length > 0 && s !== 'offline_access');
}

/**
 * Cognito-bound scopes for a registration, guaranteed non-empty.
 *
 * `CreateUserPoolClient` is called with `AllowedOAuthFlowsUserPoolClient: true`, which makes a
 * non-empty `AllowedOAuthScopes` mandatory:
 *   "InvalidParameterException: AllowedOAuthFlows and AllowedOAuthScopes are required if user
 *    pool client is allowed to use OAuth flows."
 * A client that requests `scope: ""` or `scope: "offline_access"` reduces to [] once
 * `offline_access` is stripped, so the requested set alone cannot be trusted. RFC 7591 §3.2.1
 * permits the server to substitute a value for any requested parameter, and the response reports
 * the scope actually granted — so fall back to the advertised default rather than 400-ing a client
 * that would then have no `openid` scope to complete the OIDC login that follows anyway.
 */
function resolveCognitoScopes(requested: string | undefined): string[] {
  const fromRequest = cognitoBoundScopes(requested?.trim() || DEFAULT_SCOPE);
  return fromRequest.length > 0 ? fromRequest : cognitoBoundScopes(DEFAULT_SCOPE);
}

/**
 * True when Cognito rejected the request because a submitted value was unacceptable, rather than
 * because the service failed. Drives the 400-vs-500 split at the `createClient` call site.
 */
function isInvalidParameter(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'InvalidParameterException';
}

function buildSuccessResponse(request: ClientRegistrationRequest, clientId: string, scope: string, clientName: string): ClientRegistrationResponse {
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: request.redirect_uris,
    token_endpoint_auth_method: 'none',
    client_name: clientName,
    scope,
  };
}

function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;
  return JSON.parse(raw);
}

/** Best-effort rollback — never throws; a failure here is a logged, accepted orphaned client. */
async function rollbackClient(
  cognitoManager: CognitoUserPoolClientManager,
  poolId: string,
  clientId: string,
  tenantId: string,
  logger: LoggerBuffer,
): Promise<void> {
  try {
    await cognitoManager.deleteClient(poolId, clientId);
  } catch (err) {
    logger.error('jmap_oauth_dcr_rollback_failed', { tenantId, clientId, error: String(err) });
  }
}

async function processRegistration(
  event: APIGatewayProxyEventV2,
  deps: HandlerDependencies,
  logger: LoggerBuffer,
): Promise<APIGatewayProxyResultV2> {
  let parsedBody: unknown;
  try {
    parsedBody = parseBody(event);
  } catch {
    logger.warn('jmap_oauth_dcr_rejected', { reason: 'invalid_json' });
    return errorResponse(400, 'invalid_client_metadata', 'Request body is not valid JSON');
  }

  const errors: string[] = [];
  if (!isClientRegistrationRequest(parsedBody, { errors })) {
    logger.warn('jmap_oauth_dcr_rejected', { reason: 'schema_validation', errors });
    return errorResponse(400, 'invalid_client_metadata', errors.join('; '));
  }
  const body: ClientRegistrationRequest = parsedBody;

  if (!validateRedirectUris(body.redirect_uris)) {
    logger.warn('jmap_oauth_dcr_rejected', { reason: 'invalid_redirect_uri' });
    return errorResponse(400, 'invalid_redirect_uri', 'One or more redirect_uris are not permitted');
  }

  const clientName = body.client_name?.trim() || DEFAULT_CLIENT_NAME;

  // Tenant is resolved server-side only — nothing from `body` reaches
  // this call, so an identity-looking field in an unauthenticated RFC 7591 body can never
  // select a tenant.
  const { tenantId } = await deps.identityProvisioner.resolveTenant();

  const checkResult = await deps.identityProvisioner.dcrCheck({
    tenantId,
    redirectUris: body.redirect_uris,
    clientName,
  });

  if (checkResult.status === 'dedup_hit') {
    logger.info('jmap_oauth_dcr_dedup_hit', { tenantId, clientId: checkResult.clientId });
    return jsonResponse(201, buildSuccessResponse(body, checkResult.clientId ?? '', checkResult.scope ?? DEFAULT_SCOPE, clientName));
  }

  if (checkResult.status === 'cap_exceeded') {
    logger.warn('jmap_oauth_dcr_rejected', { reason: 'cap_exceeded', tenantId });
    return errorResponse(429, 'invalid_client_metadata', 'Registration cap exceeded for this tenant');
  }

  const poolId = resolvePoolId(tenantId, deps.userPoolId);
  const cognitoScopes = resolveCognitoScopes(body.scope);

  let clientId: string;
  try {
    const created = await deps.cognito.createClient(poolId, clientName, body.redirect_uris, cognitoScopes);
    clientId = created.clientId;
  } catch (err) {
    // Log the scopes too — the first live failure of this call was an empty AllowedOAuthScopes and
    // the log said nothing about what had been requested, so the cause was invisible from here.
    logger.error('jmap_oauth_dcr_cognito_create_failed', {
      tenantId,
      requestedScope: body.scope,
      cognitoScopes,
      error: String(err),
    });
    // RFC 7591 §3.2.2: a registration error is an HTTP 400. Cognito rejects a metadata value it
    // will not accept (e.g. a redirect URI it disallows) with InvalidParameterException — that is a
    // fault in the submitted metadata and must not be dressed up as a 500. Anything else
    // (throttling, outage) is genuinely ours, so it stays a 500 and says so.
    if (isInvalidParameter(err)) {
      return errorResponse(400, 'invalid_client_metadata', 'One or more client metadata values were rejected');
    }
    return errorResponse(500, 'server_error', 'Failed to create OAuth client');
  }

  const grantedScope = cognitoScopes.join(' ');

  let persistStatus: 'success' | 'conflict';
  try {
    const persistResult = await deps.identityProvisioner.dcrPersist({
      tenantId,
      clientId,
      redirectUris: body.redirect_uris,
      clientName,
      scope: grantedScope,
    });
    persistStatus = persistResult.status;
  } catch (err) {
    logger.error('jmap_oauth_dcr_persist_error', { tenantId, clientId, error: String(err) });
    await rollbackClient(deps.cognito, poolId, clientId, tenantId, logger);
    return errorResponse(500, 'server_error', 'Failed to persist client registration');
  }

  if (persistStatus !== 'success') {
    logger.warn('jmap_oauth_dcr_persist_conflict', { tenantId, clientId, status: persistStatus });
    await rollbackClient(deps.cognito, poolId, clientId, tenantId, logger);
    return errorResponse(409, 'invalid_client_metadata', 'Client registration conflict');
  }

  logger.info('jmap_oauth_dcr_registered', { tenantId, clientId });
  return jsonResponse(201, buildSuccessResponse(body, clientId, grantedScope, clientName));
}

/**
 * Handler factory: accepts dependencies and returns the Lambda handler function.
 * Used by index.ts to create the handler with real clients.
 * Used by tests to create the handler with mocked clients.
 */
export function createHandler(deps: HandlerDependencies) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const logger = new LoggerBuffer(deps.serviceName, deps.logLevel);
    try {
      return await processRegistration(event, deps, logger);
    } catch (err) {
      logger.error('jmap_oauth_dcr_unhandled_error', { error: String(err) });
      logger.flush();
      return errorResponse(500, 'server_error', 'Internal error processing registration');
    }
  };
}
