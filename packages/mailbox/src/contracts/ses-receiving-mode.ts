/**
 * The receiving mode the Bootstrap Lambda is given through its `SES_RECEIVING_MODE` environment
 * variable when it activates the SES receipt rule set. Activating a rule set replaces whichever one
 * is active in the account and region, so the mode is chosen deliberately.
 */
export enum SesReceivingMode {
  /** Passed to the Bootstrap Lambda as `'off'`. */
  OFF = 'off',
  /** Passed to the Bootstrap Lambda as `'on'`. */
  ON = 'on',
  /** Passed to the Bootstrap Lambda as `'forced'`. */
  FORCED = 'forced',
}
