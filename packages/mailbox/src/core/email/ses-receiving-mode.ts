/**
 * The receiving mode the Bootstrap Lambda is given through its `SES_RECEIVING_MODE` environment
 * variable when it activates the SES receipt rule set. Activating a rule set replaces whichever one
 * is active in the account and region, so the mode is chosen deliberately.
 */
export type SesReceivingMode = 'off' | 'on' | 'forced';
