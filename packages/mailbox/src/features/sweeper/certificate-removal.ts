import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Aws, Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import { withTargetPresenceGuard } from './removal';
import type { IResourceRemoval } from './removal';

export interface CertificateRemovalProps {
  /** The ACM certificate to defer removal for. */
  readonly certificate: acm.ICertificate;
}

/**
 * Registers an ACM certificate for deferred removal: DescribeCertificate -> check InUseBy ->
 * DeleteCertificate, retried until the certificate is detached from whatever is using it (e.g.
 * CloudFront) — identical behaviour to the sweeper's cert handling before the per-removal-type
 * rework, see `ts-lambdas/resource-sweeper/targets/cert.ts`.
 */
export class CertificateRemoval extends Construct implements IResourceRemoval {
  readonly id = 'cert';
  private readonly certificateArn: string;

  constructor(scope: Construct, id: string, props: CertificateRemovalProps) {
    super(scope, id);
    this.certificateArn = props.certificate.certificateArn;
  }

  grantStatements(): iam.PolicyStatement[] {
    const rootStackTagKey = `aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`;
    return [
      new iam.PolicyStatement({
        actions: ['acm:DescribeCertificate', 'acm:ListTagsForCertificate'],
        resources: [`arn:aws:acm:${Aws.REGION}:${Aws.ACCOUNT_ID}:certificate/*`],
      }),
      new iam.PolicyStatement({
        actions: ['acm:DeleteCertificate'],
        resources: [`arn:aws:acm:${Aws.REGION}:${Aws.ACCOUNT_ID}:certificate/*`],
        conditions: {
          StringEquals: { [rootStackTagKey]: Aws.STACK_NAME },
        },
      }),
    ];
  }

  crProperties(): Record<string, string> {
    return { certArn: this.certificateArn };
  }

  buildChain(worker: IFunction, retryInterval: Duration, onSuccess: sfn.IChainable): sfn.State {
    const rootStackName = Stack.of(this).stackName;
    const targetPath = `$.toSweep.${this.id}`;

    const invoke = new tasks.LambdaInvoke(this, 'CertInvoke', {
      lambdaFunction: worker,
      payloadResponseOnly: true,
      resultPath: '$.workerResult',
      payload: sfn.TaskInput.fromObject({
        removalType: 'cert',
        certArn: sfn.JsonPath.stringAt(`${targetPath}.certArn`),
        rootStackName,
      }),
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
