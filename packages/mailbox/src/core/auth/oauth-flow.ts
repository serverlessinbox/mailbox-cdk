/** The OAuth grant a client uses to obtain tokens. */
export enum OAuthFlow {
  /** The authorization code flow. */
  AUTHORIZATION_CODE = 'authorization_code',

  /** The client credentials flow. */
  CLIENT_CREDENTIALS = 'client_credentials',
}
