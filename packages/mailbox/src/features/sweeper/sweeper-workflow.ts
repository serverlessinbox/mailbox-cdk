import { Duration, Aws } from 'aws-cdk-lib';
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
  /** The worker Lambda function (for us-east-1 edge Lambda deletes). */
  readonly worker: IFunction;
  /** ARN of the worker Lambda function (for self-cleanup deletion). */
  readonly workerLambdaArn: string;
  /** Policy name for the worker role (for self-cleanup policy deletion). */
  readonly workerRolePolicyName: string;
  /** Policy name for the SFN execution role (for self-cleanup policy deletion). */
  readonly rolePolicyName: string;
  /** How long to wait between checks (default: 5 min). */
  readonly checkInterval?: Duration;
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
 * Handles two sweep targets:
 * - Branch A: core regional ACM cert (same-region CallAwsService)
 * - Branch B: us-east-1 edge Lambda function (LambdaInvoke to worker + polling)
 *
 * Self-cleanup tail: delete worker Lambda, delete worker role, delete state machine,
 * strip SFN execution-role policies.
 */
export class SweeperWorkflow extends Construct {
  readonly stateMachine: sfn.StateMachine;
  private readonly props: SweeperWorkflowProps;
  private selfCleanupChain: sfn.State | null = null;

  constructor(scope: Construct, id: string, props: SweeperWorkflowProps) {
    super(scope, id);

    this.props = props;
    const checkInterval = props.checkInterval ?? Duration.minutes(5);
    const timeout = props.timeout ?? Duration.hours(4);

    this.stateMachine = this.createSweeperStateMachine(props, checkInterval, timeout);
  }

  private createSweeperStateMachine(
    props: SweeperWorkflowProps,
    checkInterval: Duration,
    timeout: Duration,
  ): sfn.StateMachine {
    // Pre-create the shared self-cleanup chain
    this.selfCleanupChain = this.createSelfCleanupChain(props.worker);

    const init = new sfn.Pass(this, 'Init', {
      comment: 'Initialize sweeper execution',
    });

    // Route on target kind
    const routeTarget = new sfn.Choice(this, 'RouteTarget')
      .when(
        sfn.Condition.stringEquals('$.targets[0].kind', 'core-acm-cert'),
        this.createAcmBranch(checkInterval),
      )
      .when(
        sfn.Condition.stringEquals('$.targets[0].kind', 'edge-lambda-fn'),
        this.createEdgeLambdaBranch(props.worker, checkInterval),
      )
      .otherwise(new sfn.Fail(this, 'UnknownTargetKind', {
        error: 'UnknownTargetKind',
        cause: 'Unknown target kind',
      }));

    init.next(routeTarget);

    return new sfn.StateMachine(this, 'StateMachine', {
      definition: init,
      role: props.executionRole,
      timeout,
      stateMachineName: props.stateMachineName,
    });
  }

  private createAcmBranch(checkInterval: Duration): sfn.State {
    // CheckAcmInUse - DescribeCertificate
    const checkAcmInUse = new tasks.CallAwsService(this, 'CheckAcmInUse', {
      service: 'acm',
      action: 'describeCertificate',
      parameters: {
        'CertificateArn.$': '$.targets[0].arn',
      },
      resultPath: '$.acmResult',
      iamResources: [`arn:aws:acm:${Aws.REGION}:${Aws.ACCOUNT_ID}:certificate/*`],
    });

    // DeleteAcmCert - ownership guard enforced by IAM tag condition
    // (aws:ResourceTag/serverless-inbox:root-stack == Aws.STACK_NAME)
    const deleteAcmCert = new tasks.CallAwsService(this, 'DeleteAcmCert', {
      service: 'acm',
      action: 'deleteCertificate',
      parameters: {
        'CertificateArn.$': '$.targets[0].arn',
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [`arn:aws:acm:${Aws.REGION}:${Aws.ACCOUNT_ID}:certificate/*`],
    });

    // AcmInUse? (Choice) - wait if in use, otherwise proceed to delete
    const acmInUseCheck = new sfn.Choice(this, 'AcmInUse?')
      .when(
        sfn.Condition.isPresent('$.acmResult.Certificate.InUseBy[0]'),
        new sfn.Wait(this, 'WaitAcm', {
          time: sfn.WaitTime.duration(checkInterval),
        }).next(checkAcmInUse),
      )
      .otherwise(deleteAcmCert);

    checkAcmInUse.next(acmInUseCheck);

    deleteAcmCert.addCatch(this.selfCleanupChain!, {
      errors: ['acm.ResourceNotFoundException', 'acm.ResourceInUseException'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    return checkAcmInUse;
  }

  private createEdgeLambdaBranch(worker: IFunction, checkInterval: Duration): sfn.State {
    // AttemptEdgeLambdaDelete
    const attemptEdgeLambdaDelete = new tasks.LambdaInvoke(this, 'AttemptEdgeLambdaDelete', {
      lambdaFunction: worker,
      payloadResponseOnly: true,
      resultPath: '$.result',
      payload: sfn.TaskInput.fromObject({
        'kind.$': '$.targets[0].kind',
        'arn.$': '$.targets[0].arn',
        'rootStackName.$': '$.targets[0].rootStackName',
      }),
      retryOnServiceExceptions: true,
    });

    // EdgeDone? (Choice)
    const edgeDoneCheck = new sfn.Choice(this, 'EdgeDone?')
      .when(
        sfn.Condition.booleanEquals('$.result.done', true),
        this.selfCleanupChain!,
      )
      .otherwise(
        new sfn.Wait(this, 'WaitEdge', {
          time: sfn.WaitTime.duration(checkInterval),
        }).next(attemptEdgeLambdaDelete),
      );

    attemptEdgeLambdaDelete.next(edgeDoneCheck);
    return attemptEdgeLambdaDelete;
  }

  private createSelfCleanupChain(worker: IFunction): sfn.State {
    // Build the complete cleanup chain that both ACM and Edge Lambda branches will reference
    const deleteWorker = this.createSelfCleanupDeleteWorkerTask(worker);
    return deleteWorker;
  }

  private createSelfCleanupDeleteWorkerTask(worker: IFunction): sfn.State {
    // SelfCleanupDeleteWorker
    const workerArn = worker.functionArn;
    const deleteWorker = new tasks.CallAwsService(this, 'SelfCleanupDeleteWorker', {
      service: 'lambda',
      action: 'deleteFunction',
      parameters: {
        FunctionName: this.props.workerLambdaArn,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [workerArn],
    });

    // Create worker role policy state once, reuse in both catch handlers
    const deleteWorkerRolePolicy = this.createSelfCleanupDeleteWorkerRolePolicy();
    deleteWorker.addCatch(deleteWorkerRolePolicy, {
      errors: ['lambda.ResourceNotFoundException'],
      resultPath: sfn.JsonPath.DISCARD,
    });
    deleteWorker.addCatch(deleteWorkerRolePolicy, {
      errors: ['States.ALL'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    return deleteWorker;
  }

  private createSelfCleanupDeleteWorkerRolePolicy(): sfn.State {
    // SelfCleanupDeleteWorkerRolePolicy - scoped to WORKER role ARN
    // Use static role name (no intrinsic extraction needed — name is known at synth time).
    const deleteWorkerRolePolicy = new tasks.CallAwsService(this, 'SelfCleanupDeleteWorkerRolePolicy', {
      service: 'iam',
      action: 'deleteRolePolicy',
      parameters: {
        RoleName: this.props.workerRoleName,
        PolicyName: this.props.workerRolePolicyName,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [this.props.workerRoleArn],
    });

    const deleteWorkerRoleNext = this.createSelfCleanupDeleteWorkerRole();
    deleteWorkerRolePolicy.addCatch(deleteWorkerRoleNext, {
      errors: ['iam.NoSuchEntityException'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    return deleteWorkerRolePolicy;
  }

  private createSelfCleanupDeleteWorkerRole(): sfn.State {
    // SelfCleanupDeleteWorkerRole - scoped to WORKER role ARN
    // Use static role name (no intrinsic extraction needed — name is known at synth time).
    const deleteWorkerRole = new tasks.CallAwsService(this, 'SelfCleanupDeleteWorkerRole', {
      service: 'iam',
      action: 'deleteRole',
      parameters: {
        RoleName: this.props.workerRoleName,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [this.props.workerRoleArn],
    });

    // Wire to state machine self-deletion (via sfn SDK integration)
    const deleteStateMachine = this.createSelfCleanupDeleteStateMachine();
    deleteWorkerRole.next(deleteStateMachine);
    deleteWorkerRole.addCatch(deleteStateMachine, {
      errors: ['iam.NoSuchEntityException'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    return deleteWorkerRole;
  }

  private createSelfCleanupDeleteStateMachine(): sfn.State {
    // SelfCleanupDeleteStateMachine - delete the state machine itself using sfn SDK integration.
    // A running state machine can mark itself for deletion; the current execution completes,
    // then the machine is removed. Use a static ARN string (no JSONPath extraction).
    const deleteStateMachine = new tasks.CallAwsService(this, 'SelfCleanupDeleteStateMachine', {
      service: 'sfn',
      action: 'deleteStateMachine',
      parameters: {
        StateMachineArn: this.props.stateMachineArn,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [this.props.stateMachineArn],
    });

    // Wire to execution role policy deletion
    const deleteExecutionRolePolicy = this.createSelfCleanupDeleteExecutionRolePolicy();
    deleteStateMachine.next(deleteExecutionRolePolicy);
    deleteStateMachine.addCatch(deleteExecutionRolePolicy, {
      errors: ['States.ALL'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    return deleteStateMachine;
  }

  private createSelfCleanupDeleteExecutionRolePolicy(): sfn.State {
    // SelfCleanupDeleteExecutionRolePolicy (final step) - scoped to EXECUTION role ARN
    // Use static role name (no intrinsic extraction needed — name is known at synth time).
    // The state machine is deleted via the SelfCleanupDeleteStateMachine step (sfn SDK integration).
    // Note: role stubs are RETAIN'd and cannot be deleted, so we only strip policies.
    const deleteExecutionRolePolicy = new tasks.CallAwsService(this, 'SelfCleanupDeleteExecutionRolePolicy', {
      service: 'iam',
      action: 'deleteRolePolicy',
      parameters: {
        RoleName: this.props.executionRoleName,
        PolicyName: this.props.rolePolicyName,
      },
      resultPath: sfn.JsonPath.DISCARD,
      iamResources: [this.props.executionRoleArn],
    });

    const succeed = new sfn.Succeed(this, 'Succeed');
    deleteExecutionRolePolicy.next(succeed);

    return deleteExecutionRolePolicy;
  }
}
