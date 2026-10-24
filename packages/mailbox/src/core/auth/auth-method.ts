/** How the OAuth client authenticates at the token endpoint. */
export enum AuthMethod {
  /** The `header` method. */
  HEADER = 'header',

  /** The `form` method. */
  FORM = 'form',
}
