import { StackIdentity, rootStackResourceTagConditions }              from '@serverlessinbox/mailbox-cdk-shared';
import * as acm                                                       from 'aws-cdk-lib/aws-certificatemanager';
import * as iam                                                       from 'aws-cdk-lib/aws-iam';
import { IFunction }                                                  from 'aws-cdk-lib/aws-lambda';
import * as sfn                                                       from 'aws-cdk-lib/aws-stepfunctions';
import { Aws, Duration, Stack }                                       from 'aws-cdk-lib';
import { Construct }                                                  from 'constructs';

import type { CertRemovalTarget, CertWorkerInput }                    from '../../ts-lambdas/resource-sweeper/removal';

import { buildWorkerRetryLoop, targetField, withTargetPresenceGuard } from './removal';
import type { IResourceRemoval }                                      from './removal';

export interface CertificateRemovalProps {
  /** The ACM certificate to defer removal for. */
  readonly certificate: acm.ICertificate;
}

/**
 * Registers an ACM certificate for deferred removal.
 */
export class CertificateRemoval extends Construct implements IResourceRemoval<'cert'> {
  private static readonly anyCertificateArn = `arn:aws:acm:${Aws.REGION}:${Aws.ACCOUNT_ID}:certificate/*`;

  readonly id = 'cert';
  private readonly certificateArn: string;

  constructor(scope: Construct, id: string, props: CertificateRemovalProps) {
    super(scope, id);
    this.certificateArn = props.certificate.certificateArn;
  }

  public grantStatements(): iam.PolicyStatement[] {
    return [this.grantCertificateInspection(), ...this.grantCertificateDeletion()];
  }

  public crProperties(): CertRemovalTarget {
    return { certArn: this.certificateArn };
  }

  public buildChain(worker: IFunction, retryInterval: Duration, onSuccess: sfn.IChainable): sfn.State {
    const payload: CertWorkerInput = {
      removalType: 'cert',
      certArn: targetField(this.id, 'certArn'),
      rootStackName: Stack.of(this).stackName,
      rootStackId: StackIdentity.guid,
    };

    const retryLoop = buildWorkerRetryLoop(this, 'Cert', {
      worker,
      payload,
      retryInterval,
      onSuccess,
      failureCause: 'Certificate removal failed',
    });

    return withTargetPresenceGuard(this, 'CertHasTarget', this.id, retryLoop, onSuccess);
  }

  private grantCertificateInspection(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions: ['acm:DescribeCertificate', 'acm:ListTagsForCertificate'],
      resources: [CertificateRemoval.anyCertificateArn],
    });
  }

  private grantCertificateDeletion(): iam.PolicyStatement[] {
    return rootStackResourceTagConditions({ name: Aws.STACK_NAME, id: StackIdentity.guid }).map(
      (conditions) =>
        new iam.PolicyStatement({
          actions: ['acm:DeleteCertificate'],
          resources: [CertificateRemoval.anyCertificateArn],
          conditions,
        }),
    );
  }
}
