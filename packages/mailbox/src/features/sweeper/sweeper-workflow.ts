import { Aws, Duration, Lazy, RemovalPolicy } from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IRole, IGrantable, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { IResourceRemoval } from './removal';

export interface SweeperWorkflowProps {
  /** The SFN execution role (needs IAM permissions for all operations). */
  readonly executionRole: IRole;
  /**
   * Pre-constructed ARN string for the execution role (no GetAtt — avoids circular dependency).
   * Must be built with Stack.formatArn() using the GUID-suffixed role name.
   */
  readonly executionRoleArn: string;
  /** The worker Lambda role (for IAM delete scoping in self-cleanup). */
  readonly workerRole: IRole;
  /**
   * Pre-constructed ARN string for the worker role (no GetAtt — avoids circular dependency).
   * Must be built with Stack.formatArn() using the GUID-suffixed role name.
   */
  readonly workerRoleArn: string;
  /** Static role name for the worker role (used in SFN DeleteRole operations). */
  readonly workerRoleName: string;
  /** Static role name for the execution role (used in SFN DeleteRolePolicy operations). */
  readonly executionRoleName: string;
  /** The worker Lambda function (invoked once per registered removal). */
  readonly worker: IFunction;
  /** ARN of the worker Lambda function (for self-cleanup deletion). */
  readonly workerLambdaArn: string;
  /** Policy name for the worker role (for self-cleanup policy deletion). */
  readonly workerRolePolicyName: string;
  /** Policy name for the SFN execution role (for self-cleanup policy deletion). */
  readonly rolePolicyName: string;
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
 * Self-cleanup tail: delete worker Lambda, delete worker role, delete state machine,
 * strip SFN execution-role policies. Runs once after every removal has succeeded.
 */
export class SweeperWorkflow extends Construct {
  private readonly stateMachine: sfn.StateMachine;

  // Pre-built ARN string for this state machine (no GetAtt); grantStartExecution/grantExecutionReaping
  // below scope statements to it directly
  // instead of going through CDK's stateMachine.grantStartExecution, which resolves via Ref.
  private readonly stateMachineArn: string;

  constructor(scope: Construct, id: string, props: SweeperWorkflowProps) {
    super(scope, id);

    const retryInterval = props.retryInterval ?? Duration.minutes(5);
    const timeout = props.timeout ?? Duration.hours(4);

    this.stateMachineArn = props.stateMachineArn;
    this.stateMachine = this.createSweeperStateMachine(props, retryInterval, timeout);
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
    (this.stateMachine.node.defaultChild as sfn.CfnStateMachine | undefined)?.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
  }

  private createSweeperStateMachine(
    props: SweeperWorkflowProps,
    retryInterval: Duration,
    timeout: Duration,
  ): sfn.StateMachine {
    if (props.removals.length === 0) {
      throw new Error('SweeperWorkflow requires at least one registered removal');
    }

    const selfCleanupEntry = this.createSelfCleanupChain(props);

    // Compose each removal's chain in sequence, right to left, so removal[i]'s success continues
    // into removal[i+1]'s entry (or the self-cleanup tail, for the last one).
    let next: sfn.IChainable = selfCleanupEntry;
    for (let i = props.removals.length - 1; i >= 0; i--) {
      next = props.removals[i].buildChain(props.worker, retryInterval, next);
    }

    return new sfn.StateMachine(this, 'StateMachine', {
      definition: next,
      role: props.executionRole,
      timeout,
      stateMachineName: props.stateMachineName,
    });
  }

  private createSelfCleanupChain(props: SweeperWorkflowProps): sfn.State {
    // Delete worker Lambda
    const deleteWorker = new tasks.CallAwsService(this, 'SelfCleanupDeleteWorker', {
      service: 'lambda',
      action: 'deleteFunction',
      parameters: {
        FunctionName: props.workerLambdaArn,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [props.workerLambdaArn],
    });

    // Delete worker role policy
    const deleteWorkerRolePolicy = new tasks.CallAwsService(this, 'SelfCleanupDeleteWorkerRolePolicy', {
      service: 'iam',
      action: 'deleteRolePolicy',
      parameters: {
        RoleName: props.workerRoleName,
        PolicyName: props.workerRolePolicyName,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [props.workerRoleArn],
    });

    // Delete worker role
    const deleteWorkerRole = new tasks.CallAwsService(this, 'SelfCleanupDeleteWorkerRole', {
      service: 'iam',
      action: 'deleteRole',
      parameters: {
        RoleName: props.workerRoleName,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [props.workerRoleArn],
    });

    // Delete state machine
    const deleteStateMachine = new tasks.CallAwsService(this, 'SelfCleanupDeleteStateMachine', {
      service: 'sfn',
      action: 'deleteStateMachine',
      parameters: {
        StateMachineArn: props.stateMachineArn,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [props.stateMachineArn],
    });

    // Final success
    const succeed = new sfn.Succeed(this, 'Succeed');

    // Wire: deleteWorker → deleteWorkerRolePolicy → deleteWorkerRole → deleteStateMachine (terminal)
    deleteWorker.next(deleteWorkerRolePolicy);

    // Add catch handlers for deleteWorker (already gone)
    deleteWorker.addCatch(deleteWorkerRolePolicy, {
      errors: ['lambda.ResourceNotFoundException'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    deleteWorkerRolePolicy.next(deleteWorkerRole);

    // Add catch handler for deleteWorkerRolePolicy (already gone)
    deleteWorkerRolePolicy.addCatch(deleteWorkerRole, {
      errors: ['iam.NoSuchEntityException'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    deleteWorkerRole.next(deleteStateMachine);

    // Add catch handler for deleteWorkerRole (already gone or has attached policies)
    deleteWorkerRole.addCatch(deleteStateMachine, {
      errors: ['iam.NoSuchEntityException', 'iam.DeleteConflictException'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    // deleteStateMachine is terminal (no .next) with error-only fallback to succeed
    deleteStateMachine.addCatch(succeed, {
      errors: ['States.ALL'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    const describeSelf = new tasks.CallAwsService(this, 'SelfCleanupDescribeOwnResource', {
      service: 'cloudformation',
      action: 'describeStackResource',
      parameters: {
        StackName: Aws.STACK_NAME,
        LogicalResourceId: Lazy.string({
          produce: () => (this.stateMachine.node.defaultChild as sfn.CfnStateMachine).logicalId,
        }),
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
