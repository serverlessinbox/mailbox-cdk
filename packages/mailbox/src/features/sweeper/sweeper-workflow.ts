import { Duration } from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IRole } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

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
  /** The worker Lambda function (invoked by SFN for both ACM and Lambda deletion). */
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
}

/**
 * CDK Construct wrapper for the resource sweeper Step Functions workflow.
 *
 * Thin retry loop:
 * 1. InvokeWorker: call worker Lambda with both certArn and edgeFnArn
 * 2. Choice on $.status:
 *    - SUCCESS → self-cleanup chain → done
 *    - RETRY → wait 5 min → back to InvokeWorker
 *    - FAILED → fail
 *
 * Self-cleanup tail: delete worker Lambda, delete worker role, delete state machine,
 * strip SFN execution-role policies. Runs once on SUCCESS.
 */
export class SweeperWorkflow extends Construct {
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: SweeperWorkflowProps) {
    super(scope, id);

    const retryInterval = props.retryInterval ?? Duration.minutes(5);
    const timeout = props.timeout ?? Duration.hours(4);

    this.stateMachine = this.createSweeperStateMachine(props, retryInterval, timeout);
  }

  private createSweeperStateMachine(
    props: SweeperWorkflowProps,
    retryInterval: Duration,
    timeout: Duration,
  ): sfn.StateMachine {
    // Invoke worker task
    const invokeWorker = new tasks.LambdaInvoke(this, 'InvokeWorker', {
      lambdaFunction: props.worker,
      payloadResponseOnly: true,
      resultPath: '$.workerResult',
      payload: sfn.TaskInput.fromObject({
        'certArn.$': '$.certArn',
        'edgeFnArn.$': '$.edgeFnArn',
        'rootStackName.$': '$.rootStackName',
      }),
      retryOnServiceExceptions: true,
    });

    // Wait before retry
    const waitRetry = new sfn.Wait(this, 'WaitRetry', {
      time: sfn.WaitTime.duration(retryInterval),
    });

    // Self-cleanup chain (runs once on SUCCESS)
    const selfCleanup = this.createSelfCleanupChain(props);

    // Choice on worker status
    const statusChoice = new sfn.Choice(this, 'StatusChoice')
      .when(
        sfn.Condition.stringEquals('$.workerResult.status', 'SUCCESS'),
        selfCleanup,
      )
      .when(
        sfn.Condition.stringEquals('$.workerResult.status', 'RETRY'),
        waitRetry,
      )
      .otherwise(
        new sfn.Fail(this, 'Failed', {
          error: 'WorkerFailed',
          cause: 'Worker returned FAILED status',
        }),
      );

    invokeWorker.next(statusChoice);
    waitRetry.next(invokeWorker);

    return new sfn.StateMachine(this, 'StateMachine', {
      definition: invokeWorker,
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

    return deleteWorker;
  }
}
