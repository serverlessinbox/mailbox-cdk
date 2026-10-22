/** Dynamic Client Registration (RFC 7591) mode for the JMAP OAuth discovery addon. */
export enum DynamicClientRegistrationMode {
  /**
   * Clients may register themselves: the registration endpoint is mounted and advertised in the OIDC
   * discovery document.
   */
  ENABLED = 'enabled',

  /**
   * Clients cannot register themselves: no registration endpoint is mounted or advertised, and the
   * template carries none of the resources behind it.
   */
  DISABLED = 'disabled',
}
