import { Grant }           from 'aws-cdk-lib/aws-iam';
import type { IGrantable } from 'aws-cdk-lib/aws-iam';

/** A CloudFormation stack that a deployer deploys, and the permissions the Lambdas of that deployer hold on it. */
export interface IDeployedStack {
  /** Lets the grantee create, update, delete and describe the stack, and read its events, summary and policy. */
  grantLifecycle(grantee: IGrantable): void;

  /** Lets the grantee read the template the stack was deployed from. */
  grantTemplateRead(grantee: IGrantable): void;

  /** Lets the grantee describe the stack and so read its outputs. */
  grantDescribe(grantee: IGrantable): void;
}

/**
 * A deployed stack named by an ARN pattern, because the stack does not exist in the construct tree: a custom
 * resource creates it at deploy time. The deployer that owns the stack builds this from the pattern it deploys to.
 */
export class DeployedStack implements IDeployedStack {
  constructor(private readonly stackArn: string) {}

  public grantLifecycle(grantee: IGrantable): void {
    this.grantActions(grantee, [
      'cloudformation:CreateStack',
      'cloudformation:UpdateStack',
      'cloudformation:DeleteStack',
      'cloudformation:DescribeStacks',
      'cloudformation:DescribeStackEvents',
      'cloudformation:GetTemplateSummary',
      'cloudformation:GetStackPolicy',
      'cloudformation:SetStackPolicy',
    ]);
  }

  public grantTemplateRead(grantee: IGrantable): void {
    this.grantActions(grantee, ['cloudformation:GetTemplate']);
  }

  public grantDescribe(grantee: IGrantable): void {
    this.grantActions(grantee, ['cloudformation:DescribeStacks']);
  }

  private grantActions(grantee: IGrantable, actions: string[]): void {
    Grant.addToPrincipal({ grantee, actions, resourceArns: [this.stackArn] });
  }
}
