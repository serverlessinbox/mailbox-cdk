import * as t from 'typanion';

/**
 * RFC 7591 §3.1 client registration request — the fields this handler acts on.
 *
 * `{ extra: t.isRecord(t.isUnknown()) }` implements §2's requirement that the authorization
 * server "MUST ignore any client metadata sent by the client that it does not understand" —
 * extension fields are accepted structurally and simply never read, rather than rejected.
 *
 * `redirect_uris` is required with at least one entry: this deployment issues public PKCE
 * clients doing `authorization_code`, which per §2 "MUST register their redirection URI
 * values". `software_statement` is accepted (so the schema doesn't reject a request that
 * includes one) but is never inspected — decision #9: no software-statement handling at all.
 */
export const isClientRegistrationRequest = t.isObject(
  {
    redirect_uris: t.cascade(t.isArray(t.isString()), [t.hasMinLength(1)]),
    client_name: t.isOptional(t.isString()),
    scope: t.isOptional(t.isString()),
    token_endpoint_auth_method: t.isOptional(t.isString()),
    grant_types: t.isOptional(t.isArray(t.isString())),
    response_types: t.isOptional(t.isArray(t.isString())),
    software_statement: t.isOptional(t.isString()),
  },
  { extra: t.isRecord(t.isUnknown()) },
);

export type ClientRegistrationRequest = t.InferType<typeof isClientRegistrationRequest>;

/** RFC 7591 §3.2.1 successful client information response (the fields this handler emits). */
export interface ClientRegistrationResponse {
  readonly client_id: string;
  readonly client_id_issued_at: number;
  readonly redirect_uris: string[];
  readonly token_endpoint_auth_method: 'none';
  readonly client_name: string;
  readonly scope: string;
}

/** RFC 7591 §3.2.2 client registration error response. */
export interface ClientRegistrationErrorResponse {
  readonly error: 'invalid_redirect_uri' | 'invalid_client_metadata';
  readonly error_description?: string;
}
