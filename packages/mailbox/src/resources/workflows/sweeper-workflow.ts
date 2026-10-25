import { IRole, IGrantable, PolicyStatement }         from 'aws-cdk-lib/aws-iam';
import { IFunction }                                  from 'aws-cdk-lib/aws-lambda';
import * as tasks                                     from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sfn                                       from 'aws-cdk-lib/aws-stepfunctions';
import { Aws, Duration, Lazy }                        from 'aws-cdk-lib';
import { Construct }                                  from 'constructs';

import type { IRemovalChain }                         from '../../platform/ops/sweeper/removal';
import { defaultCfnResource, retainOnUpdateOrDelete } from '../../utils/cfn-resource';

/** The names of the sweeper's inline IAM policies. A deletion by name has nothing else to go on, so each name is defined once. */
export const SweeperPolicyNames = {
  executionPolicy: 'sweeper-execution-policy',
  workerPolicy:    'sweeper-worker-policy',
} as const;

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
 * The resource sweeper's Step Functions workflow.
 *
 * The definition is composed, not shared: each registered removal contributes its own chain
 * (waiting, invoke, retry loop) via `IRemovalChain.buildChain` — the workflow just wires them in
 * sequence and appends the self-cleanup tail after the last one succeeds.
 *
 * Self-cleanup tail: re-check that the state machine is gone from the template, then delete worker
 * Lambda, delete worker role policy and role, and delete the state machine. Runs once after every
 * removal has succeeded.
 *
 * The state machine is retained on update and delete, so the sweep can finish after the stack is gone.
 *
 * A state machine is built from its states, so they exist before the state machine does; they are
 * created under a construct of their own, `<id>-states`, beside it.
 */
export class SweeperWorkflow extends sfn.StateMachine {
  private static readonly defaultRetryInterval = Duration.minutes(5);
  private static readonly defaultTimeout = Duration.hours(4);

  // A pre-built ARN string with no GetAtt: the grants below scope to it directly instead of going
  // through CDK's grantStartExecution, which resolves via Ref.
  private readonly ownArn: string;

  constructor(scope: Construct, id: string, props: SweeperWorkflowProps) {
    super(scope, id, {
      definition:       SweeperWorkflow.definition(new Construct(scope, `${id}-states`), scope, id, props),
      role:             props.executionRole,
      timeout:          props.timeout ?? SweeperWorkflow.defaultTimeout,
      stateMachineName: props.stateMachineName,
    });
    this.ownArn = props.stateMachineArn;
    retainOnUpdateOrDelete(this);
  }

  /** Grants the given principal permission to start executions of this state machine, by its ARN string. */
  public grantStartExecutionByArn(grantee: IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions:   ['states:StartExecution'],
      resources: [this.ownArn],
    }));
  }

  /**
   * Grants the given principal permission to list and stop executions of this state machine.
   */
  public grantExecutionReaping(grantee: IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions:   ['states:ListExecutions', 'states:StopExecution'],
      resources: [this.ownArn],
    }));
  }

  private static definition(states: Construct, scope: Construct, id: string, props: SweeperWorkflowProps): sfn.IChainable {
    if (props.removals.length === 0) {
      throw new Error('SweeperWorkflow requires at least one registered removal');
    }

    return SweeperWorkflow.inOrder([
      ...props.removals.map((removal) => SweeperWorkflow.sweepRemoval(removal, props)),
      ({ next }) => SweeperWorkflow.describeOwnResource(states, scope, id)
        .addCatch(SweeperWorkflow.captureOwnResourceGone(states).next(next), { errors: ['cloudformation.ValidationError'], resultPath: sfn.JsonPath.DISCARD })
        .next(next),
      ({ next, end }) => SweeperWorkflow.enterDeletionsWhenOwnResourceGone(states, next, end),
      ({ next }) => SweeperWorkflow.deleteWorker(states, props)
        .addCatch(next, { errors: ['lambda.ResourceNotFoundException'], resultPath: sfn.JsonPath.DISCARD })
        .next(next),
      ({ next }) => SweeperWorkflow.deleteWorkerRolePolicy(states, props)
        .addCatch(next, { errors: ['iam.NoSuchEntityException'], resultPath: sfn.JsonPath.DISCARD })
        .next(next),
      ({ next }) => SweeperWorkflow.deleteWorkerRole(states, props)
        .addCatch(next, { errors: ['iam.NoSuchEntityException', 'iam.DeleteConflictException'], resultPath: sfn.JsonPath.DISCARD })
        .next(next),
      ({ end }) => SweeperWorkflow.deleteStateMachine(states, props)
        .addCatch(end, { errors: ['States.ALL'], resultPath: sfn.JsonPath.DISCARD }),
    ], () => SweeperWorkflow.succeed(states));
  }

  /**
   * Wires the steps so each continues into the one listed after it, the last into `finalStep`'s
   * state. Steps are built from the last to the first, because a state names its successor when it
   * is built.
   */
  private static inOrder(steps: Step[], finalStep: () => sfn.State): sfn.IChainable {
    const end = finalStep();

    let next: sfn.IChainable = end;
    for (let i = steps.length - 1; i >= 0; i--) {
      next = steps[i]({ next, end });
    }
    return next;
  }

  /** One registered removal: its own chain, whose success continues into the step after it. */
  private static sweepRemoval(removal: IRemovalChain, props: SweeperWorkflowProps): Step {
    const retryInterval = props.retryInterval ?? SweeperWorkflow.defaultRetryInterval;

    return ({ next }) => removal.buildChain(props.worker, retryInterval, next);
  }

  /**
   * Looks the state machine up in the stack's own template, so an ordinary deploy where every
   * removal had nothing to do deletes nothing CloudFormation still owns. The state machine is the
   * construct `id` under `scope`; its logical id is only known once it is built, so it is resolved at synth.
   */
  private static describeOwnResource(states: Construct, scope: Construct, id: string): tasks.CallAwsService {
    return new tasks.CallAwsService(states, 'self-cleanup-describe-own-resource', {
      service:      'cloudformation',
      action:       'describeStackResource',
      parameters:   {
        StackName:         Aws.STACK_NAME,
        LogicalResourceId: Lazy.string({ produce: () => defaultCfnResource(scope.node.findChild(id)).logicalId }),
      },
      resultPath:   '$.selfCheck',
      iamResources: [Aws.STACK_ID],
    });
  }

  // CFN signals a removed logical id by throwing ValidationError rather than returning an empty
  // result — capture that as data so the Choice after it can read it, mirroring
  // withTargetPresenceGuard's isPresent check rather than branching on task success/failure.
  private static captureOwnResourceGone(states: Construct): sfn.Pass {
    return new sfn.Pass(states, 'self-cleanup-capture-not-found', {
      resultPath: '$.selfCheck',
      parameters: { notFound: true },
    });
  }

  /** Enters the deletions only when the own-resource lookup found the state machine gone from the template. */
  private static enterDeletionsWhenOwnResourceGone(states: Construct, deletions: sfn.IChainable, otherwise: sfn.IChainable): sfn.Choice {
    return new sfn.Choice(states, 'self-cleanup-guard')
      .when(sfn.Condition.isPresent('$.selfCheck.notFound'), deletions)
      .otherwise(otherwise);
  }

  private static deleteWorker(states: Construct, props: SweeperWorkflowProps): tasks.CallAwsService {
    return new tasks.CallAwsService(states, 'self-cleanup-delete-worker', {
      service:      'lambda',
      action:       'deleteFunction',
      parameters:   {
        FunctionName: props.worker.functionArn,
      },
      resultPath:   sfn.JsonPath.DISCARD,
      iamResources: [props.worker.functionArn],
    });
  }

  private static deleteWorkerRolePolicy(states: Construct, props: SweeperWorkflowProps): tasks.CallAwsService {
    return new tasks.CallAwsService(states, 'self-cleanup-delete-worker-role-policy', {
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

  private static deleteWorkerRole(states: Construct, props: SweeperWorkflowProps): tasks.CallAwsService {
    return new tasks.CallAwsService(states, 'self-cleanup-delete-worker-role', {
      service:      'iam',
      action:       'deleteRole',
      parameters:   {
        RoleName: props.workerRoleName,
      },
      resultPath:   sfn.JsonPath.DISCARD,
      iamResources: [props.workerRoleArn],
    });
  }

  private static deleteStateMachine(states: Construct, props: SweeperWorkflowProps): tasks.CallAwsService {
    return new tasks.CallAwsService(states, 'self-cleanup-delete-state-machine', {
      service:      'sfn',
      action:       'deleteStateMachine',
      parameters:   {
        StateMachineArn: props.stateMachineArn,
      },
      resultPath:   sfn.JsonPath.DISCARD,
      iamResources: [props.stateMachineArn],
    });
  }

  private static succeed(states: Construct): sfn.Succeed {
    return new sfn.Succeed(states, 'succeed');
  }
}
