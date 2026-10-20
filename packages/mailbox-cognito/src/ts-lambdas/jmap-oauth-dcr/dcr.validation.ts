import * as t            from 'typanion';

import { isRedirectUri } from '../shared/identity-identifiers';

export const isClientRegistrationRequest = t.isPartial({
  redirect_uris: t.cascade(t.isArray(isRedirectUri), [t.hasMinLength(1)]),
  client_name: t.isOptional(t.isString()),
  scope: t.isOptional(t.isString()),
  token_endpoint_auth_method: t.isOptional(t.isString()),
  grant_types: t.isOptional(t.isArray(t.isString())),
  response_types: t.isOptional(t.isArray(t.isString())),
  software_statement: t.isOptional(t.isString()),
});

/**
 * RFC 7591 §3.1 client registration request: the metadata fields this Lambda accepts. Metadata it does not list
 * is ignored rather than rejected, as §2 requires of an authorization server. `redirect_uris` has at least one
 * entry because a public client doing `authorization_code` must register its redirection URI (§2).
 * `software_statement` is accepted and never inspected.
 */
export type ClientRegistrationRequest = t.InferType<typeof isClientRegistrationRequest>;

/** RFC 7591 §3.2.1 successful client information response: the fields this Lambda writes. */
export interface ClientRegistrationResponse {
  readonly client_id: string;
  readonly client_id_issued_at: number;
  readonly redirect_uris: string[];
  readonly token_endpoint_auth_method: 'none';
  readonly client_name: string;
  readonly scope: string;
}

/**
 * The error codes of a registration answer. RFC 7591 §3.2.2 defines `invalid_redirect_uri` and
 * `invalid_client_metadata` (with `invalid_software_statement` and `unapproved_software_statement`, which are
 * never answered here); `server_error` is the RFC 6749 §5.2 code, for a failure that is not a fault in the
 * submitted metadata. Answering one of those as `invalid_client_metadata` would invite the client to "fix" a
 * request that was correct.
 */
export type ClientRegistrationError = 'invalid_redirect_uri' | 'invalid_client_metadata' | 'server_error';

/** RFC 7591 §3.2.2 client registration error response. */
export interface ClientRegistrationErrorResponse {
  readonly error: ClientRegistrationError;
  readonly error_description?: string;
}
