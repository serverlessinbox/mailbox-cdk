import * as t from 'typanion';
import { isAccountId, isTenantId, type TenantId } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { isClientId, type ClientId, type GroupName, type UserSubject, type Username } from './cognito-identifiers';
import { isPrincipalId, type EmailAddress, type RedirectUri } from './identity-identifiers';

/**
 * The invoke contract of the `identity-provisioner` Lambda: one request per `kind` it answers, and the response
 * shape it returns for it. Responses cross a Lambda invoke boundary, so each has a typanion schema that
 * validates it before use.
 */

/** Asks which tenant the request belongs to. Carries nothing identity-shaped: the tenant is never derived from a request body. */
export interface ResolveTenantRequest {
  readonly kind: 'RESOLVE_TENANT';
}

/** Asks whether a dynamic client registration may proceed, or is a duplicate or over the cap. */
export interface DcrCheckRequest {
  readonly kind: 'DCR_CHECK';
  readonly tenantId: TenantId;
  readonly redirectUris: RedirectUri[];
  readonly clientName: string;
}

/** Records a dynamic client registration that was created in the user pool. */
export interface DcrPersistRequest {
  readonly kind: 'DCR_PERSIST';
  readonly tenantId: TenantId;
  readonly clientId: ClientId;
  readonly redirectUris: RedirectUri[];
  readonly clientName: string;
  /** The granted scopes, separated by spaces. */
  readonly scope: string;
}

/** Pre-provisions the mailbox principal of a Cognito user. */
export interface ProvisionUserRequest {
  readonly kind: 'PROVISION_USER';
  /** Absent, never defaulted, when the authorizer did not supply a tenant. */
  readonly tenantId?: TenantId;
  readonly provider: 'cognito';
  /** Cognito's immutable `sub`, never the username: a username can be deleted and recreated under a new `sub`. */
  readonly subject: UserSubject;
  readonly username: Username;
  readonly email?: EmailAddress;
  readonly groups: readonly GroupName[];
  readonly isAdmin: boolean;
}

/** Every request the `identity-provisioner` Lambda answers. */
export type IdentityProvisionerRequest = ResolveTenantRequest | DcrCheckRequest | DcrPersistRequest | ProvisionUserRequest;

/** What a caller supplies for a `DCR_CHECK` request. */
export type DcrCheckParams = Omit<DcrCheckRequest, 'kind'>;

/** What a caller supplies for a `DCR_PERSIST` request. */
export type DcrPersistParams = Omit<DcrPersistRequest, 'kind'>;

/** What a caller supplies for a `PROVISION_USER` request. */
export type ProvisionUserParams = Omit<ProvisionUserRequest, 'kind' | 'provider'>;

export const isResolveTenantResponse = t.isObject({ tenantId: isTenantId });
/** The tenant the request belongs to. */
export type ResolveTenantResponse = t.InferType<typeof isResolveTenantResponse>;

const isDcrProceedResponse = t.isObject({ status: t.isLiteral('proceed') });
const isDcrDedupHitResponse = t.isObject({
  status: t.isLiteral('dedup_hit'),
  clientId: isClientId,
  scope: t.isOptional(t.isString()),
});
const isDcrCapExceededResponse = t.isObject({ status: t.isLiteral('cap_exceeded') });

export const isDcrCheckResponse = t.isOneOf([isDcrProceedResponse, isDcrDedupHitResponse, isDcrCapExceededResponse]);
/** Whether the registration may proceed; a duplicate always carries the client it duplicates, and may carry the scopes it was granted, separated by spaces. */
export type DcrCheckResponse = t.InferType<typeof isDcrCheckResponse>;

export const isDcrPersistResponse = t.isObject({
  status: t.isEnum(['success', 'conflict'] as const),
});
/** Whether the registration was recorded or lost a race with another. */
export type DcrPersistResponse = t.InferType<typeof isDcrPersistResponse>;

export const isProvisionUserResponse = t.isObject({
  principalId: isPrincipalId,
  primaryAccountId: isAccountId,
  isNewUser: t.isBoolean(),
});
/** The mailbox principal and account the user was provisioned with. */
export type ProvisionUserResponse = t.InferType<typeof isProvisionUserResponse>;
