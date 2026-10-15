/** The names of the environment variables the template sets on the sweeper Lambdas. It imports nothing, so it loads without CDK. */

export const ResourceSweeperEnvNames = {
  stateMachineArn: 'MAILBOX_SWEEPER_STATE_MACHINE_ARN',
} as const;

export type ResourceSweeperEnvName = (typeof ResourceSweeperEnvNames)[keyof typeof ResourceSweeperEnvNames];
