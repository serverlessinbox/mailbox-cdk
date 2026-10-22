const READ = ['ssm:GetParameter'] as const;

/**
 * Explicit least-privilege SSM Parameter Store action set — `read` — for a parameter's own grant
 * method. Narrower than CDK's `IParameter.grantRead`, which also grants `ssm:DescribeParameters`,
 * `ssm:GetParameters` and `ssm:GetParameterHistory`; `read` covers only the single-parameter
 * `GetParameter` API.
 */
export const SsmActions = {
  read: READ,
} as const;

/** One SSM action of the sets in {@link SsmActions}. */
export type SsmAction = typeof READ[number];
