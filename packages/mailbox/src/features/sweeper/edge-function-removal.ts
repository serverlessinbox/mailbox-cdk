import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Aws, Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { rootStackResourceTagCondition } from '@serverlessinbox/mailbox-cdk-shared';
import { withTargetPresenceGuard } from './removal';
import type { IResourceRemoval } from './removal';

export interface EdgeFunctionRemovalProps {
  /** The Lambda@Edge function to defer removal for. */
  readonly function: lambda.IFunction;
}

/**
 * Registers a Lambda@Edge function for deferred removal: GetFunction -> verify tag ->
 * DeleteFunction, retried until CloudFront's replicas finish draining — identical behaviour to the
 * sweeper's edge-function handling before the per-removal-type rework, see
 * `ts-lambdas/resource-sweeper/targets/edge-fn.ts`. Always us-east-1, per Lambda@Edge's own
 * constraint, regardless of which region the worker itself runs in.
 */
export class EdgeFunctionRemoval extends Construct implements IResourceRemoval {
  readonly id = 'edge-fn';
  private readonly edgeFnArn: string;

  constructor(scope: Construct, id: string, props: EdgeFunctionRemovalProps) {
    super(scope, id);
    this.edgeFnArn = props.function.functionArn;
  }

  grantStatements(): iam.PolicyStatement[] {
    return [
      new iam.PolicyStatement({
        actions: ['lambda:GetFunction'],
        resources: [`arn:aws:lambda:us-east-1:${Aws.ACCOUNT_ID}:function:*`],
      }),
      new iam.PolicyStatement({
        actions: ['lambda:DeleteFunction'],
        resources: [`arn:aws:lambda:us-east-1:${Aws.ACCOUNT_ID}:function:*`],
        conditions: {
          StringEquals: rootStackResourceTagCondition(Aws.STACK_NAME),
        },
      }),
    ];
  }

  crProperties(): Record<string, string> {
    return { edgeFnArn: this.edgeFnArn };
  }

  buildChain(worker: lambda.IFunction, retryInterval: Duration, onSuccess: sfn.IChainable): sfn.State {
    const rootStackName = Stack.of(this).stackName;
    const targetPath = `$.toSweep.${this.id}`;

    const invoke = new tasks.LambdaInvoke(this, 'EdgeFnInvoke', {
      lambdaFunction: worker,
      payloadResponseOnly: true,
      resultPath: '$.workerResult',
      payload: sfn.TaskInput.fromObject({
        removalType: 'edge-fn',
        edgeFnArn: sfn.JsonPath.stringAt(`${targetPath}.edgeFnArn`),
        rootStackName,
      }),
      retryOnServiceExceptions: true,
    });

    const wait = new sfn.Wait(this, 'EdgeFnWaitRetry', { time: sfn.WaitTime.duration(retryInterval) });

    const choice = new sfn.Choice(this, 'EdgeFnStatusChoice')
      .when(sfn.Condition.stringEquals('$.workerResult.status', 'SUCCESS'), onSuccess)
      .when(sfn.Condition.stringEquals('$.workerResult.status', 'RETRY'), wait)
      .otherwise(new sfn.Fail(this, 'EdgeFnFailed', { error: 'WorkerFailed', cause: 'Edge function removal failed' }));

    invoke.next(choice);
    wait.next(invoke);

    return withTargetPresenceGuard(this, 'EdgeFnHasTarget', this.id, invoke, onSuccess);
  }
}
