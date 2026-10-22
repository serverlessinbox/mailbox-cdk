import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { IParameter }        from 'aws-cdk-lib/aws-ssm';

const READ = ['ssm:GetParameter'] as const;

/**
 * Explicit least-privilege SSM Parameter Store action set — `read` — for use with
 * `grantParameterActions`. Narrower than CDK's `IParameter.grantRead`, which also grants
 * `ssm:DescribeParameters`, `ssm:GetParameters` and `ssm:GetParameterHistory`; `read` covers only
 * the single-parameter `GetParameter` API.
 */
export const SsmActions = {
  read: READ,
} as const;

/** One SSM action of the sets in {@link SsmActions}. */
export type SsmAction = typeof READ[number];

/**
 * Grants a caller exactly the given SSM actions on a parameter, scoped to the parameter's ARN.
 */
export function grantParameterActions(grantee: IGrantable, parameter: IParameter, actions: readonly SsmAction[]): Grant {
  return Grant.addToPrincipal({
    grantee,
    actions:      [...actions],
    resourceArns: [parameter.parameterArn],
  });
}
