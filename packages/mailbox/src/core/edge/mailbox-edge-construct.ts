import type { ResolvedArtifact }  from '@serverlessinbox/artifact-registry-cdk';
import * as acm                   from 'aws-cdk-lib/aws-certificatemanager';
import * as iam                   from 'aws-cdk-lib/aws-iam';
import type * as lambda           from 'aws-cdk-lib/aws-lambda';
import * as logs                  from 'aws-cdk-lib/aws-logs';
import * as route53               from 'aws-cdk-lib/aws-route53';
import * as s3                    from 'aws-cdk-lib/aws-s3';
import { Construct }              from 'constructs';

import { JmapBlobDownloadLambda } from '../../resources/lambdas/jmap-blob-download-lambda';

/**
 * Props of {@link MailboxEdgeConstruct}. Every string is a CloudFormation parameter value of the edge
 * stack, so none of them can steer a decision at synth time.
 */
export interface MailboxEdgeConstructProps {
  /** Finished host name of the Webmail UI, from `MailboxDomains`. The primary name of the edge certificate. */
  readonly webmailHost: string;

  /** Finished host name of the Admin UI, from `MailboxDomains`. */
  readonly adminHost: string;

  /** Finished host name of the blob CDN, from `MailboxDomains`. */
  readonly cdnHost: string;

  /** Hosted zone the edge certificate is DNS-validated in. */
  readonly hostedZoneId: string;

  /** Name of the hosted zone `hostedZoneId` identifies. */
  readonly hostedZoneName: string;

  /** Name of the S3 bucket containing artifacts */
  readonly artifactBucket: string;

  /** JMAP blob download Lambda artifact reference (key + optional S3 version ID) */
  readonly jmapBlobDownloadReference: ResolvedArtifact;

  /** DynamoDB item table ARN (regional) used by jmap-blob-download */
  readonly itemTableArn: string;

  /** DynamoDB config table ARN (regional) used by jmap-blob-download */
  readonly configTableArn: string;

  /** DynamoDB auth key store table ARN (regional) used by jmap-blob-download */
  readonly authKeyStoreTableArn: string;

  /** Product version for artifact tagging (e.g., '1.2.3') */
  readonly productVersion: string;

  /** Name of the shared "jmap" pipeline log group (home region) that jmap-blob-download logs into */
  readonly logGroupName: string;

  /** ARN of the jmap-blob-download Lambda@Edge execution role (created in the root stack) */
  readonly jmapBlobDownloadRoleArn: string;
}

/**
 * The us-east-1 part of the mailbox edge: the ACM certificate of the CDN and UI hosts and the
 * jmap-blob-download Lambda@Edge function.
 *
 * It does not decide whether the certificate exists; the stack that holds it attaches the condition.
 */
export class MailboxEdgeConstruct extends Construct {
  public readonly certificate: acm.CfnCertificate;
  public readonly jmapBlobDownloadFunction: lambda.IFunction;
  public readonly jmapBlobDownloadVersion: lambda.IVersion;

  constructor(scope: Construct, id: string, props: MailboxEdgeConstructProps) {
    super(scope, id);

    this.certificate = this.createCertificate(props);

    const jmapBlobDownloadFunction = this.createJmapBlobDownloadFunction(props);

    this.jmapBlobDownloadFunction = jmapBlobDownloadFunction;
    // CloudFront Lambda@Edge requires a published version.
    this.jmapBlobDownloadVersion  = jmapBlobDownloadFunction.currentVersion;
  }

  /** An L1 certificate with native DNS validation: CloudFormation creates the Route53 records itself, without a CDK bootstrap custom resource. */
  private createCertificate(props: MailboxEdgeConstructProps): acm.CfnCertificate {
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'hosted-zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName:     props.hostedZoneName,
    });

    return new acm.CfnCertificate(this, 'edge-certificate', {
      domainName:              props.webmailHost,
      subjectAlternativeNames: [props.adminHost, props.cdnHost],
      validationMethod:        'DNS',
      domainValidationOptions: [props.webmailHost, props.adminHost, props.cdnHost].map((domainName) => ({ domainName, hostedZoneId: hostedZone.hostedZoneId })),
    });
  }

  private createJmapBlobDownloadFunction(props: MailboxEdgeConstructProps): JmapBlobDownloadLambda {
    // The role is created in the root stack; its trust and policies are configured there.
    const role = iam.Role.fromRoleArn(this, 'jmap-blob-download-role', props.jmapBlobDownloadRoleArn, {
      mutable: false,
    });

    return new JmapBlobDownloadLambda(this, 'jmap-blob-download', {
      artifactBucket: s3.Bucket.fromBucketName(this, 'artifact-bucket', props.artifactBucket),
      artifact:       props.jmapBlobDownloadReference,
      role,
      productVersion: props.productVersion,
      // Lambda@Edge sends logs to the SAME custom group name in every invocation region (no
      // Region prefix). In the home region that name already belongs to the CFN-created "jmap"
      // pipeline group, so home-region edge logs merge into it; other regions get same-named,
      // service-created, untagged groups — an accepted gap. Reference by name only: this stack
      // cannot construct the home-region LogGroup directly.
      logGroup:       logs.LogGroup.fromLogGroupName(this, 'shared-log-group', props.logGroupName),
    });
  }
}
