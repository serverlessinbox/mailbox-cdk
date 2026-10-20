import * as iam from 'aws-cdk-lib/aws-iam';
import { Aws }  from 'aws-cdk-lib';

/** The resources the execution role acts on, each as a plain ARN string so no grant adds a CloudFormation dependency edge. */
export interface SweeperExecutionTargets {
  readonly workerFunctionArn: string;
  readonly workerRoleArn: string;
  readonly stateMachineArn: string;
  readonly executionRoleArn: string;
}

/**
 * The grants of the sweeper's execution role: invoking the worker and deleting the sweeper's own
 * resources. The role's inline policy and its permissions boundary are both built from this one list,
 * so the ceiling cannot drift below what the role is granted.
 */
export class SweeperExecutionGrants {
  private readonly targets: SweeperExecutionTargets;

  constructor(targets: SweeperExecutionTargets) {
    this.targets = targets;
  }

  /** A fresh statement list on every call, in a fixed order, for each policy document to own. */
  public statements(): iam.PolicyStatement[] {
    return [
      this.grantWorkerInvocation(),
      this.grantWorkerFunctionDeletion(),
      this.grantWorkerRoleDeletion(),
      this.grantStateMachineDeletion(),
      this.grantOwnRolePolicyDeletion(),
      this.grantOwnStackResourceDescription(),
    ];
  }

  private grantWorkerInvocation(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [this.targets.workerFunctionArn],
    });
  }

  private grantWorkerFunctionDeletion(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions: ['lambda:DeleteFunction'],
      resources: [this.targets.workerFunctionArn],
    });
  }

  private grantWorkerRoleDeletion(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions: ['iam:DeleteRolePolicy', 'iam:DeleteRole'],
      resources: [this.targets.workerRoleArn],
    });
  }

  private grantStateMachineDeletion(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions: ['states:DeleteStateMachine'],
      resources: [this.targets.stateMachineArn],
    });
  }

  private grantOwnRolePolicyDeletion(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions: ['iam:DeleteRolePolicy'],
      resources: [this.targets.executionRoleArn],
    });
  }

  /** `Aws.STACK_ID` is the exact stack ARN, so the check reads only the sweeper's own stack. */
  private grantOwnStackResourceDescription(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions: ['cloudformation:DescribeStackResource'],
      resources: [Aws.STACK_ID],
    });
  }
}
