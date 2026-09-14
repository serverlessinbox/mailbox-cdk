import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { MailboxStackUpdateWorkflow } from './stack-update-workflow';

export interface StackUpdateRecoveryInfraProps {
  /** stack-update-api Lambda — both the state machine's invoke target and the EventBridge target. */
  readonly handler: IFunction;

  /** ARN of the root stack this recovery workflow watches and operates on. */
  readonly rootStackArn: string;

  /** Same deterministic name passed to the Lambda's own `stateMachineName` prop (see there for why). */
  readonly stateMachineName: string;
}

/**
 * Wires the root-stack `UPDATE_ROLLBACK_FAILED` recovery path (`stack-update-resilience` plan,
 * increment 2):
 *
 * - The Step Functions workflow (`MailboxStackUpdateWorkflow`) the Lambda drives via its
 *   `check`/`recover` modes.
 * - The EventBridge rule that detects the failure and starts a recovery episode. Targets the
 *   **Lambda** (`event-start` mode), never the state machine directly — a `Target` has no
 *   execution-name field, and the Lambda is what derives the episode token and dedups via
 *   `DescribeExecution` before calling `StartExecution` itself.
 */
export class StackUpdateRecoveryInfra extends Construct {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: StackUpdateRecoveryInfraProps) {
    super(scope, id);

    const workflow = new MailboxStackUpdateWorkflow(this, 'workflow', {
      handler: props.handler,
      stateMachineName: props.stateMachineName,
    });
    this.stateMachine = workflow.stateMachine;

    // `CloudFormation Stack Status Change` (stack-level), not `CloudFormation Resource Status
    // Change` — matches the stack-failure-detection precedent's distinction between the two
    // detail-types. This is a separate, independent rule (plan: "Attaching to the
    // stack-failure-detection rule or Lambda — separate, consent-gated feature").
    const rule = new events.Rule(this, 'rollback-failed-rule', {
      eventPattern: {
        source: ['aws.cloudformation'],
        detailType: ['CloudFormation Stack Status Change'],
        detail: {
          'stack-id': [props.rootStackArn],
          'status-details': {
            status: ['UPDATE_ROLLBACK_FAILED'],
          },
        },
      },
    });
    rule.addTarget(new targets.LambdaFunction(props.handler));
  }
}
