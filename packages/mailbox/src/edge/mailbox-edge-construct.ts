import type { ResolvedArtifact } from '@serverlessinbox/artifact-registry';
import { applyArtifactTags }     from '@serverlessinbox/mailbox-cdk-shared';
import * as acm                  from 'aws-cdk-lib/aws-certificatemanager';
import * as iam                  from 'aws-cdk-lib/aws-iam';
import * as lambda               from 'aws-cdk-lib/aws-lambda';
import * as logs                 from 'aws-cdk-lib/aws-logs';
import * as route53              from 'aws-cdk-lib/aws-route53';
import * as s3                   from 'aws-cdk-lib/aws-s3';
import * as cdk                  from 'aws-cdk-lib';
import { Aws }                   from 'aws-cdk-lib';
import { Construct }             from 'constructs';

export interface MailboxEdgeConstructProps {
  /** Base domain name, e.g. example.com */
  readonly domainName: string;

  /** Dot-wrapped prefix between endpoint and base domain: "." for none, or ".{label}.". */
  readonly prefix: string;

  /**
   * If provided, the ACM certificate will be DNS-validated automatically via Route53.
   * If omitted, the certificate will use email validation.
   */
  readonly hostedZone?: route53.IHostedZone;

  /** Alternative to hostedZone: import hosted zone by attributes (token-safe). */
  readonly hostedZoneId?: string;
  readonly hostedZoneName?: string;

  /** S3 bucket containing artifacts */
  readonly artifactBucket: string | s3.IBucket;

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
 * Creates an ACM certificate and optionally a jmap-blob-download Lambda@Edge function.
 *
 * Accepts pre-resolved S3 locations - artifact prefix calculation happens in the deployer.
 */
export class MailboxEdgeConstruct extends Construct {
  public readonly certificate: acm.CfnCertificate;
  public readonly jmapBlobDownloadFunction: lambda.IFunction;
  public readonly jmapBlobDownloadVersion: lambda.IVersion;

  constructor(scope: Construct, id: string, props: MailboxEdgeConstructProps) {
    super(scope, id);

    // DomainName and Prefix are CloudFormation parameters (tokens) in the edge stack.
    // Validation happens via the parameter allowedPattern in the stack.
    const admin   = `admin${props.prefix}${props.domainName}`;
    const webmail = `webmail${props.prefix}${props.domainName}`;
    const auth    = `auth${props.prefix}${props.domainName}`;
    const cdn     = `cdn${props.prefix}${props.domainName}`;

    const hostedZone = props.hostedZone
      ?? (props.hostedZoneId !== undefined && props.hostedZoneName !== undefined
        ? route53.HostedZone.fromHostedZoneAttributes(this, 'hosted-zone', {
          hostedZoneId: props.hostedZoneId,
          zoneName: props.hostedZoneName,
        })
        : undefined);

    if (!hostedZone) {
      throw new Error('hostedZone or hostedZoneId/hostedZoneName must be provided');
    }

    // NOTE: Whether this certificate is actually created is controlled by a CloudFormation condition
    // in the stack (so we can decide based on parameter values at deploy time).
    // Uses CfnCertificate (L1) with native DNS validation so CloudFormation handles the
    // Route53 record creation without a CDK bootstrap custom resource.
    this.certificate = new acm.CfnCertificate(this, 'edge-certificate', {
      domainName: webmail,
      subjectAlternativeNames: [admin, auth, cdn],
      validationMethod: 'DNS',
      domainValidationOptions: [
        { domainName: webmail, hostedZoneId: hostedZone.hostedZoneId },
        { domainName: admin,   hostedZoneId: hostedZone.hostedZoneId },
        { domainName: auth,    hostedZoneId: hostedZone.hostedZoneId },
        { domainName: cdn,     hostedZoneId: hostedZone.hostedZoneId },
      ],
    });

    // Create jmap-blob-download Lambda
    const artifactBucket = typeof props.artifactBucket === 'string'
      ? s3.Bucket.fromBucketName(this, 'artifact-bucket', props.artifactBucket)
      : props.artifactBucket;

    // Import the jmap-blob-download execution role created in the root stack (immutable).
    // The role trust and policies are configured there; this construct uses it as-is.
    const jmapBlobDownloadRole = iam.Role.fromRoleArn(this, 'jmap-blob-download-role', props.jmapBlobDownloadRoleArn, {
      mutable: false,
    });

    // The key here is already the full path (artifact prefix included)
    // This is pre-calculated by the deployer
    //
    // NOTE: Lambda@Edge function created inline (not wrapped in src/lambdas/).
    // Constraints:
    // 1. Uses pre-resolved S3 reference (deployer-calculated key) rather than artifact resolver
    // 2. Lambda@Edge hard restrictions: must live in us-east-1, cannot have environment variables,
    //    cannot use VPC
    const jmapBlobDownloadFunction = new lambda.Function(this, 'jmap-blob-download', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromBucket(
        artifactBucket,
        props.jmapBlobDownloadReference.key,
        props.jmapBlobDownloadReference.versionId,
      ),
      role: jmapBlobDownloadRole,
      memorySize: 512,
      description: `Serverless Inbox Mailbox: jmap-blob-download Lambda@Edge (${Aws.STACK_NAME})`,
      // Lambda@Edge sends logs to the SAME custom group name in every invocation region (no
      // Region prefix). In the home region that name already belongs to the CFN-created "jmap"
      // pipeline group, so home-region edge logs merge into it; other regions get same-named,
      // service-created, untagged groups — an accepted gap. Reference by name only: this stack
      // cannot construct the home-region LogGroup directly.
      logGroup: logs.LogGroup.fromLogGroupName(this, 'shared-log-group', props.logGroupName),
    });

    // Apply artifact tags for auto-update tracking.
    // Package: mailbox-cdk-edge (us-east-1), artifact: jmap-blob-download
    // updateType='edge' because it's updated via the scheduled updater (UpdateFunctionCode + PublishVersion + CloudFront)
    applyArtifactTags(jmapBlobDownloadFunction, 'mailbox-cdk-edge', 'jmap-blob-download', props.productVersion, 'edge');

    // The root-stack tag (used by the scheduled updater for discovery, the sweeper's ownership
    // check, and the tag-scoped IAM conditions in the deployer/sweeper policies) comes from the
    // stack-level applyServerlessInboxBaseTags aspect, which carries the ROOT stack name from the
    // rootStack parameter. Do NOT re-add it here with Aws.STACK_NAME: inside this template that
    // resolves to the EDGE stack's own name and, being closer to the resource, it overrides the
    // stack aspect with the wrong value — breaking sweeper ownership verification.

    this.jmapBlobDownloadFunction = jmapBlobDownloadFunction;

    // CloudFront Lambda@Edge requires a published version.
    this.jmapBlobDownloadVersion = jmapBlobDownloadFunction.currentVersion;

    // Force a new AWS::Lambda::Version resource (replacement) whenever the S3 version ID changes.
    // Without this, CFn updates $LATEST but the immutable version resource stays the same.
    const cfnVersion = this.jmapBlobDownloadVersion.node.defaultChild as cdk.CfnResource;
    cfnVersion.addPropertyOverride('Description', props.jmapBlobDownloadReference.versionId ?? '');

    // S3ObjectVersion must be absent (not empty string) when no version ID is provided;
    // Lambda rejects an empty string for this field.
    const hasJmapBlobDownloadVersion = new cdk.CfnCondition(this, 'has-jmap-blob-download-version', {
      expression: cdk.Fn.conditionNot(
        cdk.Fn.conditionEquals(props.jmapBlobDownloadReference.versionId ?? '', ''),
      ),
    });
    const cfnFunction                = jmapBlobDownloadFunction.node.defaultChild as lambda.CfnFunction;
    cfnFunction.addPropertyOverride(
      'Code.S3ObjectVersion',
      cdk.Fn.conditionIf(hasJmapBlobDownloadVersion.logicalId, props.jmapBlobDownloadReference.versionId ?? '', cdk.Aws.NO_VALUE),
    );
  }
}
