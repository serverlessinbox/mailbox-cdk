import { IRole, IGrantable, PolicyStatement }         from 'aws-cdk-lib/aws-iam';
import { IFunction }                                  from 'aws-cdk-lib/aws-lambda';
import * as tasks                                     from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sfn                                       from 'aws-cdk-lib/aws-stepfunctions';
import { Aws, Duration, Lazy }                        from 'aws-cdk-lib';
import { Construct }                                  from 'constructs';

import { defaultCfnResource, retainOnUpdateOrDelete } from '../../utils/cfn-resource';

import type { IResourceRemoval }                      from './removal';
import { SweeperPolicyNames }                         from './sweeper-names';

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
   * Removals to sweep, in order. Each contributes its own chain (via `IResourceRemoval.buildChain`)
   * to the state machine; the last one's success continues into the self-cleanup tail below.
   */
  readonly removals: IResourceRemoval[];
}

/**
 * CDK Construct wrapper for the resource sweeper Step Functions workflow.
 *
 * The definition is composed, not shared: each registered removal contributes its own chain
 * (waiting, invoke, retry loop) via `IResourceRemoval.buildChain` — the workflow just wires them in
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

    this.stateMachineArn = props.stateMachineArn;
    this.stateMachine    = this.createSweeperStateMachine(props);
  }

  public grantStartExecution(grantee: IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['states:StartExecution'],
      resources: [this.stateMachineArn],
    }));
  }

  /**
   * Grants the given principal permission to list and stop executions of this state machine.
   */
  public grantExecutionReaping(grantee: IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['states:ListExecutions', 'states:StopExecution'],
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

  private createSweeperStateMachine(props: SweeperWorkflowProps): sfn.StateMachine {
    if (props.removals.length === 0) {
      throw new Error('SweeperWorkflow requires at least one registered removal');
    }

    const definition = this.chainRemovals(props, this.createSelfCleanupChain(props));

    return new sfn.StateMachine(this, 'StateMachine', {
      definition,
      role: props.executionRole,
      timeout: props.timeout ?? SweeperWorkflow.defaultTimeout,
      stateMachineName: props.stateMachineName,
    });
  }

  /**
   * Composes each removal's chain right to left, so removal[i]'s success continues into
   * removal[i+1]'s entry (or `selfCleanupEntry`, for the last one).
   */
  private chainRemovals(props: SweeperWorkflowProps, selfCleanupEntry: sfn.IChainable): sfn.IChainable {
    const retryInterval = props.retryInterval ?? SweeperWorkflow.defaultRetryInterval;

    let next = selfCleanupEntry;
    for (let i = props.removals.length - 1; i >= 0; i--) {
      next = props.removals[i].buildChain(props.worker, retryInterval, next);
    }
    return next;
  }

  private createSelfCleanupChain(props: SweeperWorkflowProps): sfn.State {
    const succeed                = new sfn.Succeed(this, 'Succeed');
    const deleteStateMachine     = this.createDeleteStateMachine(props, succeed);
    const deleteWorkerRole       = this.createDeleteWorkerRole(props, deleteStateMachine);
    const deleteWorkerRolePolicy = this.createDeleteWorkerRolePolicy(props, deleteWorkerRole);
    const deleteWorker           = this.createDeleteWorker(props, deleteWorkerRolePolicy);

    return this.createOwnPresenceCheck(deleteWorker, succeed);
  }

  /** A worker that is already gone is skipped, not an error. */
  private createDeleteWorker(props: SweeperWorkflowProps, next: sfn.IChainable): tasks.CallAwsService {
    const deleteWorker = new tasks.CallAwsService(this, 'SelfCleanupDeleteWorker', {
      service: 'lambda',
      action: 'deleteFunction',
      parameters: {
        FunctionName: props.worker.functionArn,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [props.worker.functionArn],
    });

    deleteWorker.next(next);
    deleteWorker.addCatch(next, {
      errors: ['lambda.ResourceNotFoundException'],
      resultPath: sfn.JsonPath.DISCARD,
    });
    return deleteWorker;
  }

  private createDeleteWorkerRolePolicy(props: SweeperWorkflowProps, next: sfn.IChainable): tasks.CallAwsService {
    const deleteWorkerRolePolicy = new tasks.CallAwsService(this, 'SelfCleanupDeleteWorkerRolePolicy', {
      service: 'iam',
      action: 'deleteRolePolicy',
      parameters: {
        RoleName: props.workerRoleName,
        PolicyName: SweeperPolicyNames.workerPolicy,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [props.workerRoleArn],
    });

    deleteWorkerRolePolicy.next(next);
    deleteWorkerRolePolicy.addCatch(next, {
      errors: ['iam.NoSuchEntityException'],
      resultPath: sfn.JsonPath.DISCARD,
    });
    return deleteWorkerRolePolicy;
  }

  /** A worker role that is already gone, or that still has attached policies, is skipped, not an error. */
  private createDeleteWorkerRole(props: SweeperWorkflowProps, next: sfn.IChainable): tasks.CallAwsService {
    const deleteWorkerRole = new tasks.CallAwsService(this, 'SelfCleanupDeleteWorkerRole', {
      service: 'iam',
      action: 'deleteRole',
      parameters: {
        RoleName: props.workerRoleName,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [props.workerRoleArn],
    });

    deleteWorkerRole.next(next);
    deleteWorkerRole.addCatch(next, {
      errors: ['iam.NoSuchEntityException', 'iam.DeleteConflictException'],
      resultPath: sfn.JsonPath.DISCARD,
    });
    return deleteWorkerRole;
  }

  /** Terminal: nothing follows the deletion of the state machine itself, and any failure of it ends in `succeed`. */
  private createDeleteStateMachine(props: SweeperWorkflowProps, succeed: sfn.IChainable): tasks.CallAwsService {
    const deleteStateMachine = new tasks.CallAwsService(this, 'SelfCleanupDeleteStateMachine', {
      service: 'sfn',
      action: 'deleteStateMachine',
      parameters: {
        StateMachineArn: props.stateMachineArn,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [props.stateMachineArn],
    });

    deleteStateMachine.addCatch(succeed, {
      errors: ['States.ALL'],
      resultPath: sfn.JsonPath.DISCARD,
    });
    return deleteStateMachine;
  }

  /**
   * Looks the state machine up in the stack's own template and enters the deletions only when it is
   * gone, so an ordinary deploy where every removal had nothing to do deletes nothing CloudFormation
   * still owns. Returns the entry state.
   */
  private createOwnPresenceCheck(deleteWorker: sfn.IChainable, succeed: sfn.IChainable): sfn.State {
    const describeSelf = new tasks.CallAwsService(this, 'SelfCleanupDescribeOwnResource', {
      service: 'cloudformation',
      action: 'describeStackResource',
      parameters: {
        StackName: Aws.STACK_NAME,
        LogicalResourceId: Lazy.string({ produce: () => defaultCfnResource(this.stateMachine).logicalId }),
      },
      resultPath: '$.selfCheck',
      iamResources: [Aws.STACK_ID],
    });

    // CFN signals a removed logical id by throwing ValidationError rather than returning an empty
    // result — capture that as data so the Choice below can read it, mirroring
    // withTargetPresenceGuard's isPresent check rather than branching on task success/failure.
    const captureNotFound = new sfn.Pass(this, 'SelfCleanupCaptureNotFound', {
      resultPath: '$.selfCheck',
      parameters: { notFound: true },
    });
    describeSelf.addCatch(captureNotFound, {
      errors: ['cloudformation.ValidationError'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    const selfCleanupGuard = new sfn.Choice(this, 'SelfCleanupGuard')
      .when(sfn.Condition.isPresent('$.selfCheck.notFound'), deleteWorker)
      .otherwise(succeed);

    captureNotFound.next(selfCleanupGuard);
    describeSelf.next(selfCleanupGuard);

    return describeSelf;
  }
}
