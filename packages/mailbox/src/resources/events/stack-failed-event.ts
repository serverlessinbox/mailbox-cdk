import * as targets                          from 'aws-cdk-lib/aws-events-targets';
import * as events                           from 'aws-cdk-lib/aws-events';
import { CfnPermission }                     from 'aws-cdk-lib/aws-lambda';
import type { IFunction }                    from 'aws-cdk-lib/aws-lambda';
import { CfnResource, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { Construct }                    from 'constructs';

/** What the sweeper needs to find and remove the retained rule. */
export interface IStackFailedEvent {
  readonly ruleArn: string;
  readonly ruleTargetId: string;
}

export interface StackFailedEventProps {
  target: IFunction;
}

/**
 * Invokes the target when this stack ends in a rolled-back or failed state. The rule, its target and the
 * target's invoke permission are retained on update, on delete and when their creating operation is rolled
 * back, so the target still exists to report that rollback. The rule is not given an explicit name, so a
 * construct-tree move cannot collide with a retained orphan.
 */
export class StackFailedEvent extends events.Rule implements IStackFailedEvent {
  readonly ruleTargetId = 'Target0';

  constructor(scope: Construct, id: string, props: StackFailedEventProps) {
    // `CloudFormation Stack Status Change` is a different detail-type from `CloudFormation Resource
    // Status Change` despite overlapping status spellings.
    // CREATE_FAILED/UPDATE_FAILED are excluded: they are only terminal when rollback is disabled.
    super(scope, id, {
      eventPattern: {
        source: ['aws.cloudformation'],
        detailType: ['CloudFormation Stack Status Change'],
        detail: {
          'stack-id': [Stack.of(scope).stackId],
          'status-details': {
            status: [
              'ROLLBACK_COMPLETE',
              'ROLLBACK_FAILED',
              'UPDATE_ROLLBACK_COMPLETE',
              'UPDATE_ROLLBACK_FAILED',
              'DELETE_FAILED',
            ],
          },
        },
      },
    });

    this.addTarget(new targets.LambdaFunction(props.target));

    this.retainRule();
    this.retainInvokePermission();
  }

  private retainRule(): void {
    const defaultChild = this.node.defaultChild;
    if (!(defaultChild instanceof CfnResource)) {
      throw new Error(
        `stack-failed rule: expected defaultChild to be a CfnResource, got ${defaultChild?.constructor?.name ?? String(defaultChild)}`,
      );
    }
    defaultChild.applyRemovalPolicy(RemovalPolicy.RETAIN);
  }

  /** `addTarget` creates the invoke permission under the rule with a generated id, so it is found by type. */
  private retainInvokePermission(): void {
    const invokePermission = this.node.findAll().find((child): child is CfnPermission => child instanceof CfnPermission);
    if (!invokePermission) {
      throw new Error('stack-failed rule: expected addTarget to create an invoke permission under the rule');
    }
    invokePermission.applyRemovalPolicy(RemovalPolicy.RETAIN);
  }
}
