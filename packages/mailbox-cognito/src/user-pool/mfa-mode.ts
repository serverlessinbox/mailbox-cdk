/**
 * Whether the users of the Cognito user pool sign in with a second factor (TOTP).
 *
 * The string values are the lowercase spelling carried in a CloudFormation parameter: cast the parameter's
 * `valueAsString` to this enum at the single place it is injected. The data stack maps each value to
 * Cognito's own spelling.
 */
export enum MfaMode {
  /** MFA is disabled: users sign in with their password only. */
  OFF = 'off',

  /** Users may enroll a TOTP authenticator; those who do are asked for it at sign-in. */
  OPTIONAL = 'optional',

  /** Every user must enroll a TOTP authenticator and is asked for it at sign-in. */
  ON = 'on',
}
