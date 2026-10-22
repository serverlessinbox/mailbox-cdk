import { StackIdentity, rootStackResourceTagConditions }              from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                                                       from 'aws-cdk-lib/aws-iam';
import * as lambda                                                    from 'aws-cdk-lib/aws-lambda';
import * as sfn                                                       from 'aws-cdk-lib/aws-stepfunctions';
import { Aws, Duration, Stack }                                       from 'aws-cdk-lib';
import { Construct }                                                  from 'constructs';

import type { EdgeFunctionRemovalTarget, EdgeFunctionWorkerInput }    from '../../../runtime/resource-sweeper/removal';

import { buildWorkerRetryLoop, targetField, withTargetPresenceGuard } from './removal';
import type { IResourceRemoval }                                      from './removal';

/** Inputs of {@link EdgeFunctionRemoval}. */
export interface EdgeFunctionRemovalProps {
  /** The Lambda@Edge function to defer removal for. */
  readonly function: lambda.IFunction;
}

/**
 * Registers a Lambda@Edge function for deferred removal. Its grants are always for us-east-1, per
 * Lambda@Edge's own constraint, regardless of which region the worker itself runs in.
 */
export class EdgeFunctionRemoval extends Construct implements IResourceRemoval<'edge-fn'> {
  private static readonly anyEdgeFunctionArn = `arn:${Aws.PARTITION}:lambda:us-east-1:${Aws.ACCOUNT_ID}:function:*`;

  readonly id = 'edge-fn';
  private readonly edgeFnArn: string;

  constructor(scope: Construct, id: string, props: EdgeFunctionRemovalProps) {
    super(scope, id);
    this.edgeFnArn = props.function.functionArn;
  }

  public grantStatements(): iam.PolicyStatement[] {
    return [this.grantEdgeFunctionInspection(), ...this.grantEdgeFunctionDeletion()];
  }

  public crProperties(): EdgeFunctionRemovalTarget {
    return { edgeFnArn: this.edgeFnArn };
  }

  public buildChain(worker: lambda.IFunction, retryInterval: Duration, onSuccess: sfn.IChainable): sfn.State {
    const payload: EdgeFunctionWorkerInput = {
      removalType:   'edge-fn',
      edgeFnArn:     targetField(this.id, 'edgeFnArn'),
      rootStackName: Stack.of(this).stackName,
      rootStackId:   StackIdentity.guid,
    };

    const retryLoop = buildWorkerRetryLoop(this, 'EdgeFn', {
      worker,
      payload,
      retryInterval,
      onSuccess,
      failureCause: 'Edge function removal failed',
    });

    return withTargetPresenceGuard(this, 'EdgeFnHasTarget', this.id, retryLoop, onSuccess);
  }

  private grantEdgeFunctionInspection(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['lambda:GetFunction'],
      resources: [EdgeFunctionRemoval.anyEdgeFunctionArn],
    });
  }

  private grantEdgeFunctionDeletion(): iam.PolicyStatement[] {
    return rootStackResourceTagConditions({ name: Aws.STACK_NAME, id: StackIdentity.guid }).map(
      (conditions) =>
        new iam.PolicyStatement({
          actions:   ['lambda:DeleteFunction'],
          resources: [EdgeFunctionRemoval.anyEdgeFunctionArn],
          conditions,
        }),
    );
  }
}
