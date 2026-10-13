import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Aws, Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { rootStackResourceTagCondition } from '@serverlessinbox/mailbox-cdk-shared';
import type { CertRemovalTarget, CertWorkerInput } from '../../ts-lambdas/resource-sweeper/removal';
import { targetField, withTargetPresenceGuard } from './removal';
import type { IResourceRemoval } from './removal';

export interface CertificateRemovalProps {
  /** The ACM certificate to defer removal for. */
  readonly certificate: acm.ICertificate;
}

/**
 * Registers an ACM certificate for deferred removal.
 */
export class CertificateRemoval extends Construct implements IResourceRemoval<'cert'> {
  readonly id = 'cert';
  private readonly certificateArn: string;

  constructor(scope: Construct, id: string, props: CertificateRemovalProps) {
    super(scope, id);
    this.certificateArn = props.certificate.certificateArn;
  }

  grantStatements(): iam.PolicyStatement[] {
    return [
      new iam.PolicyStatement({
        actions: ['acm:DescribeCertificate', 'acm:ListTagsForCertificate'],
        resources: [`arn:aws:acm:${Aws.REGION}:${Aws.ACCOUNT_ID}:certificate/*`],
      }),
      new iam.PolicyStatement({
        actions: ['acm:DeleteCertificate'],
        resources: [`arn:aws:acm:${Aws.REGION}:${Aws.ACCOUNT_ID}:certificate/*`],
        conditions: {
          StringEquals: rootStackResourceTagCondition(Aws.STACK_NAME),
        },
      }),
    ];
  }

  crProperties(): CertRemovalTarget {
    return { certArn: this.certificateArn };
  }

  buildChain(worker: IFunction, retryInterval: Duration, onSuccess: sfn.IChainable): sfn.State {
    const workerInput: CertWorkerInput = {
      removalType: 'cert',
      certArn: targetField(this.id, 'certArn'),
      rootStackName: Stack.of(this).stackName,
    };

    const invoke = new tasks.LambdaInvoke(this, 'CertInvoke', {
      lambdaFunction: worker,
      payloadResponseOnly: true,
      resultPath: '$.workerResult',
      payload: sfn.TaskInput.fromObject({ ...workerInput }),
      retryOnServiceExceptions: true,
    });

    const wait = new sfn.Wait(this, 'CertWaitRetry', { time: sfn.WaitTime.duration(retryInterval) });

    const choice = new sfn.Choice(this, 'CertStatusChoice')
      .when(sfn.Condition.stringEquals('$.workerResult.status', 'SUCCESS'), onSuccess)
      .when(sfn.Condition.stringEquals('$.workerResult.status', 'RETRY'), wait)
      .otherwise(new sfn.Fail(this, 'CertFailed', { error: 'WorkerFailed', cause: 'Certificate removal failed' }));

    invoke.next(choice);
    wait.next(invoke);

    return withTargetPresenceGuard(this, 'CertHasTarget', this.id, invoke, onSuccess);
  }
}
