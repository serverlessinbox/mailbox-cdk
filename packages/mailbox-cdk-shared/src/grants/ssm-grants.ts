import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { IParameter }        from 'aws-cdk-lib/aws-ssm';

const READ = ['ssm:GetParameter'] as const;

/**
 * Explicit least-privilege SSM Parameter Store action set — `read` — for use with
 * `grantParameterActions`. Narrower than CDK's `IParameter.grantRead`, which also grants
 * `ssm:DescribeParameters`, `ssm:GetParameters` and `ssm:GetParameterHistory`; no caller in this
 * repo calls anything but the single-parameter `GetParameter` API.
 */
export const SsmActions = {
  read: READ,
} as const;

/**
 * Grants a caller exactly the given SSM actions on a parameter, scoped to the parameter's ARN.
 */
export function grantParameterActions(grantee: IGrantable, parameter: IParameter, actions: readonly string[]): Grant {
  return Grant.addToPrincipal({
    grantee,
    actions: [...actions],
    resourceArns: [parameter.parameterArn],
  });
}
