import { IRole, IGrantable, PolicyStatement }         from 'aws-cdk-lib/aws-iam';
import { IFunction }                                  from 'aws-cdk-lib/aws-lambda';
import * as tasks                                     from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sfn                                       from 'aws-cdk-lib/aws-stepfunctions';
import { Aws, Duration, Lazy }                        from 'aws-cdk-lib';
import { Construct }                                  from 'constructs';

import type { IRemovalChain }                         from '../../platform/ops/sweeper/removal';
import { SweeperPolicyNames }                         from '../../platform/ops/sweeper/sweeper-names';
import { defaultCfnResource, retainOnUpdateOrDelete } from '../../utils/cfn-resource';

export interface SweeperWorkflowProps {
  /** The role the state machine runs as. */
  readonly executionRole: IRole;
  /**
   * Pre-constructed ARN string for the worker role (no GetAtt — avoids circular dependency).
   * Must be built with Stack.formatArn() using the GUID-suffixed role name.
   */
  readonly workerRoleArn: string;
  /** Static name of the worker role, which the self-cleanup tail deletes by name. */
  readonly workerRoleName: string;
  /** The worker Lambda function (invoked once per registered removal). */
  readonly worker: IFunction;
  /** How long to wait between retries (default: 5 min). */
  readonly retryInterval?: Duration;
  /** Overall timeout for the workflow (default: 4h). */
  readonly timeout?: Duration;
  /** Required: explicit state machine name for ARN construction. */
  readonly stateMachineName: string;
  /** ARN of the state machine itself (for self-deletion via sfn SDK). */
  readonly stateMachineArn: string;
  /**
   * Removals to sweep, in order. Each contributes its own chain (via `IRemovalChain.buildChain`)
   * to the state machine; the last one's success continues into the self-cleanup tail below.
   */
  readonly removals: IRemovalChain[];
}

/** What a step is wired to: the step that follows it, and the state the whole execution ends in. */
interface StepSuccessors {
  readonly next: sfn.IChainable;
  readonly end:  sfn.IChainable;
}

/** A step of the sequence: builds its state, wired to its successors. */
type Step = (successors: StepSuccessors) => sfn.IChainable;

/**
 * CDK Construct wrapper for the resource sweeper Step Functions workflow.
 *
 * The definition is composed, not shared: each registered removal contributes its own chain
 * (waiting, invoke, retry loop) via `IRemovalChain.buildChain` — the workflow just wires them in
 * sequence and appends the self-cleanup tail after the last one succeeds.
 *
 * Self-cleanup tail: re-check that the state machine is gone from the template, then delete worker
 * Lambda, delete worker role policy and role, and delete the state machine. Runs once after every
 * removal has succeeded.
 */
export class SweeperWorkflow extends Construct {
  private static readonly defaultRetryInterval = Duration.minutes(5);
  private static readonly defaultTimeout = Duration.hours(4);

  private readonly stateMachine: sfn.StateMachine;

  // A pre-built ARN string with no GetAtt: the grants below scope to it directly instead of going
  // through CDK's stateMachine.grantStartExecution, which resolves via Ref.
  private readonly stateMachineArn: string;

  constructor(scope: Construct, id: string, props: SweeperWorkflowProps) {
    super(scope, id);

    if (props.removals.length === 0) {
      throw new Error('SweeperWorkflow requires at least one registered removal');
    }

    this.stateMachineArn = props.stateMachineArn;
    this.stateMachine    = new sfn.StateMachine(this, 'StateMachine', {
      definition:       this.inOrder([
        ...props.removals.map((removal) => this.sweepRemoval(removal, props)),
        ({ next }) => this.describeOwnResource()
          .addCatch(this.captureOwnResourceGone().next(next), { errors: ['cloudformation.ValidationError'], resultPath: sfn.JsonPath.DISCARD })
          .next(next),
        ({ next, end }) => this.enterDeletionsWhenOwnResourceGone(next, end),
        ({ next }) => this.deleteWorker(props)
          .addCatch(next, { errors: ['lambda.ResourceNotFoundException'], resultPath: sfn.JsonPath.DISCARD })
          .next(next),
        ({ next }) => this.deleteWorkerRolePolicy(props)
          .addCatch(next, { errors: ['iam.NoSuchEntityException'], resultPath: sfn.JsonPath.DISCARD })
          .next(next),
        ({ next }) => this.deleteWorkerRole(props)
          .addCatch(next, { errors: ['iam.NoSuchEntityException', 'iam.DeleteConflictException'], resultPath: sfn.JsonPath.DISCARD })
          .next(next),
        ({ end }) => this.deleteStateMachine(props)
          .addCatch(end, { errors: ['States.ALL'], resultPath: sfn.JsonPath.DISCARD }),
      ], () => this.succeed()),
      role:             props.executionRole,
      timeout:          props.timeout ?? SweeperWorkflow.defaultTimeout,
      stateMachineName: props.stateMachineName,
    });
  }

  public grantStartExecution(grantee: IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions:   ['states:StartExecution'],
      resources: [this.stateMachineArn],
    }));
  }

  /**
   * Grants the given principal permission to list and stop executions of this state machine.
   */
  public grantExecutionReaping(grantee: IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions:   ['states:ListExecutions', 'states:StopExecution'],
      resources: [this.stateMachineArn],
    }));
  }

  /**
   * Marks this state machine for retention when the stack is deleted.
   * Allows the sweeper to complete asynchronously after the stack is torn down.
   */
  public markForRetention(): void {
    retainOnUpdateOrDelete(this.stateMachine);
  }

  /**
   * Wires the steps so each continues into the one listed after it, the last into `finalStep`'s
   * state. Steps are built from the last to the first, because a state names its successor when it
   * is built.
   */
  private inOrder(steps: Step[], finalStep: () => sfn.State): sfn.IChainable {
    const end = finalStep();

    let next: sfn.IChainable = end;
    for (let i = steps.length - 1; i >= 0; i--) {
      next = steps[i]({ next, end });
    }
    return next;
  }

  /** One registered removal: its own chain, whose success continues into the step after it. */
  private sweepRemoval(removal: IRemovalChain, props: SweeperWorkflowProps): Step {
    const retryInterval = props.retryInterval ?? SweeperWorkflow.defaultRetryInterval;

    return ({ next }) => removal.buildChain(props.worker, retryInterval, next);
  }

  /**
   * Looks the state machine up in the stack's own template, so an ordinary deploy where every
   * removal had nothing to do deletes nothing CloudFormation still owns.
   */
  private describeOwnResource(): tasks.CallAwsService {
    return new tasks.CallAwsService(this, 'SelfCleanupDescribeOwnResource', {
      service:      'cloudformation',
      action:       'describeStackResource',
      parameters:   {
        StackName:         Aws.STACK_NAME,
        LogicalResourceId: Lazy.string({ produce: () => defaultCfnResource(this.stateMachine).logicalId }),
      },
      resultPath:   '$.selfCheck',
      iamResources: [Aws.STACK_ID],
    });
  }

  // CFN signals a removed logical id by throwing ValidationError rather than returning an empty
  // result — capture that as data so the Choice after it can read it, mirroring
  // withTargetPresenceGuard's isPresent check rather than branching on task success/failure.
  private captureOwnResourceGone(): sfn.Pass {
    return new sfn.Pass(this, 'SelfCleanupCaptureNotFound', {
      resultPath: '$.selfCheck',
      parameters: { notFound: true },
    });
  }

  /** Enters the deletions only when the own-resource lookup found the state machine gone from the template. */
  private enterDeletionsWhenOwnResourceGone(deletions: sfn.IChainable, otherwise: sfn.IChainable): sfn.Choice {
    return new sfn.Choice(this, 'SelfCleanupGuard')
      .when(sfn.Condition.isPresent('$.selfCheck.notFound'), deletions)
      .otherwise(otherwise);
  }

  private deleteWorker(props: SweeperWorkflowProps): tasks.CallAwsService {
    return new tasks.CallAwsService(this, 'SelfCleanupDeleteWorker', {
      service:      'lambda',
      action:       'deleteFunction',
      parameters:   {
        FunctionName: props.worker.functionArn,
      },
      resultPath:   sfn.JsonPath.DISCARD,
      iamResources: [props.worker.functionArn],
    });
  }

  private deleteWorkerRolePolicy(props: SweeperWorkflowProps): tasks.CallAwsService {
    return new tasks.CallAwsService(this, 'SelfCleanupDeleteWorkerRolePolicy', {
      service:      'iam',
      action:       'deleteRolePolicy',
      parameters:   {
        RoleName:   props.workerRoleName,
        PolicyName: SweeperPolicyNames.workerPolicy,
      },
      resultPath:   sfn.JsonPath.DISCARD,
      iamResources: [props.workerRoleArn],
    });
  }

  private deleteWorkerRole(props: SweeperWorkflowProps): tasks.CallAwsService {
    return new tasks.CallAwsService(this, 'SelfCleanupDeleteWorkerRole', {
      service:      'iam',
      action:       'deleteRole',
      parameters:   {
        RoleName: props.workerRoleName,
      },
      resultPath:   sfn.JsonPath.DISCARD,
      iamResources: [props.workerRoleArn],
    });
  }

  private deleteStateMachine(props: SweeperWorkflowProps): tasks.CallAwsService {
    return new tasks.CallAwsService(this, 'SelfCleanupDeleteStateMachine', {
      service:      'sfn',
      action:       'deleteStateMachine',
      parameters:   {
        StateMachineArn: props.stateMachineArn,
      },
      resultPath:   sfn.JsonPath.DISCARD,
      iamResources: [props.stateMachineArn],
    });
  }

  private succeed(): sfn.Succeed {
    return new sfn.Succeed(this, 'Succeed');
  }
}
