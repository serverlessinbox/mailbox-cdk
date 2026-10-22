import * as t            from 'typanion';

import { isRedirectUri } from '../shared/identity-identifiers';

export const isClientRegistrationRequest = t.isPartial({
  redirect_uris:              t.cascade(t.isArray(isRedirectUri), [t.hasMinLength(1)]),
  client_name:                t.isOptional(t.isString()),
  scope:                      t.isOptional(t.isString()),
  token_endpoint_auth_method: t.isOptional(t.isString()),
  grant_types:                t.isOptional(t.isArray(t.isString())),
  response_types:             t.isOptional(t.isArray(t.isString())),
  software_statement:         t.isOptional(t.isString()),
});

/**
 * RFC 7591 §3.1 client registration request: the metadata fields this Lambda accepts. Metadata it does not list
 * is ignored rather than rejected, as §2 requires of an authorization server. `redirect_uris` has at least one
 * entry because a public client doing `authorization_code` must register its redirection URI (§2).
 * `software_statement` is accepted and never inspected.
 */
export type ClientRegistrationRequest = t.InferType<typeof isClientRegistrationRequest>;
