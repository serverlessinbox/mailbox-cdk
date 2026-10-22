/**
 * The mailbox API a headless OAuth client may call, passed in `ProvisionHeadlessClientConfig.audiences`.
 *
 * The string values are the ones to carry in a CloudFormation parameter: cast the parameter's
 * `valueAsString` to this enum at the single place it is injected.
 */
export enum UserPoolAudience {
  /** The Admin API. The client's id is added to the audiences the Admin API's authorizer accepts. */
  ADMIN_API = 'adminApi',

  /** The JMAP API. The client's id is added to the audiences the JMAP API's authorizer accepts. */
  JMAP_API = 'jmapApi',
}
