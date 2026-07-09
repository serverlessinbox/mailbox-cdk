import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cdk from 'aws-cdk-lib';
import { Aws, Fn } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import type { ResolvedArtifact } from '@serverlessinbox/artifact-registry';
import { applyArtifactTags } from '@serverlessinbox/mailbox-cdk-shared';

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

  /** Blob-authorizer Lambda artifact reference (key + optional S3 version ID) */
  readonly blobAuthorizerReference: ResolvedArtifact;

  /** DynamoDB item table ARN (regional) used by blob-authorizer */
  readonly itemTableArn: string;

  /** DynamoDB config table ARN (regional) used by blob-authorizer */
  readonly configTableArn: string;

  /** DynamoDB auth key store table ARN (regional) used by blob-authorizer */
  readonly authKeyStoreTableArn: string;

  /** Product version for artifact tagging (e.g., '1.2.3') */
  readonly productVersion: string;
}

/**
 * Creates an ACM certificate and optionally a blob-authorizer Lambda@Edge function.
 *
 * Accepts pre-resolved S3 locations - artifact prefix calculation happens in the deployer.
 */
export class MailboxEdgeConstruct extends Construct {
  public readonly certificate: acm.CfnCertificate;
  public readonly blobAuthorizerFunction: lambda.IFunction;
  public readonly blobAuthorizerVersion: lambda.IVersion;

  constructor(scope: Construct, id: string, props: MailboxEdgeConstructProps) {
    super(scope, id);

    // DomainName and Prefix are CloudFormation parameters (tokens) in the edge stack.
    // Validation happens via the parameter allowedPattern in the stack.
    const admin = `admin${props.prefix}${props.domainName}`;
    const webmail = `webmail${props.prefix}${props.domainName}`;
    const auth = `auth${props.prefix}${props.domainName}`;
    const cdn = `cdn${props.prefix}${props.domainName}`;

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

    // Create blob-authorizer Lambda
    const artifactBucket = typeof props.artifactBucket === 'string'
      ? s3.Bucket.fromBucketName(this, 'artifact-bucket', props.artifactBucket)
      : props.artifactBucket;

    // Lambda@Edge requires the execution role trust policy to allow BOTH principals.
    // CloudFront validates this during association.
    const blobAuthorizerRole = new iam.Role(this, 'blob-authorizer-role', {
      // Deterministic IAM path so the edge deployer can scope its iam:* permissions to
      // `role/<edge-stack-name>/*`. The path survives regardless of the CFN-generated role NAME,
      // which gets truncated to IAM's 64-char limit for long stack names and therefore cannot be
      // matched reliably by a name-prefix pattern. Contract with mailbox-edge-deployer-grants.ts.
      path: `/${Aws.STACK_NAME}/`,
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com'),
      ),
      description: `Serverless Inbox Mailbox: blob-authorizer Lambda@Edge role (${Aws.STACK_NAME})`,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // The key here is already the full path (artifact prefix included)
    // This is pre-calculated by the deployer
    const blobAuthorizerFunction = new lambda.Function(this, 'blob-authorizer', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromBucket(
        artifactBucket,
        props.blobAuthorizerReference.key,
        props.blobAuthorizerReference.versionId,
      ),
      role: blobAuthorizerRole,
      memorySize: 512,
      description: `Serverless Inbox Mailbox: blob-authorizer Lambda@Edge (${Aws.STACK_NAME})`,
      // logGroup: new LogGroup(this, 'blob-authorizer-log-group', {
      //   retention: RetentionDays.ONE_MONTH,
      //   removalPolicy: RemovalPolicy.RETAIN,
      // }),
    });

    // Apply artifact tags for auto-update tracking.
    // Package: mailbox-cdk-edge (us-east-1), artifact: blob-authorizer
    // updateType='edge' because it's updated via the scheduled updater (UpdateFunctionCode + PublishVersion + CloudFront)
    applyArtifactTags(blobAuthorizerFunction, 'mailbox-cdk-edge', 'blob-authorizer', props.productVersion, 'edge');

    // The root-stack tag (used by the scheduled updater for discovery, the sweeper's ownership
    // check, and the tag-scoped IAM conditions in the deployer/sweeper policies) comes from the
    // stack-level applyServerlessInboxBaseTags aspect, which carries the ROOT stack name from the
    // rootStack parameter. Do NOT re-add it here with Aws.STACK_NAME: inside this template that
    // resolves to the EDGE stack's own name and, being closer to the resource, it overrides the
    // stack aspect with the wrong value — breaking sweeper ownership verification.

    this.blobAuthorizerFunction = blobAuthorizerFunction;

    // CloudFront Lambda@Edge requires a published version.
    this.blobAuthorizerVersion = blobAuthorizerFunction.currentVersion;

    // Force a new AWS::Lambda::Version resource (replacement) whenever the S3 version ID changes.
    // Without this, CFn updates $LATEST but the immutable version resource stays the same.
    const cfnVersion = this.blobAuthorizerVersion.node.defaultChild as cdk.CfnResource;
    cfnVersion.addPropertyOverride('Description', props.blobAuthorizerReference.versionId ?? '');

    // S3ObjectVersion must be absent (not empty string) when no version ID is provided;
    // Lambda rejects an empty string for this field.
    const hasBlobAuthorizerVersion = new cdk.CfnCondition(this, 'has-blob-authorizer-version', {
      expression: cdk.Fn.conditionNot(
        cdk.Fn.conditionEquals(props.blobAuthorizerReference.versionId ?? '', ''),
      ),
    });
    const cfnFunction = blobAuthorizerFunction.node.defaultChild as lambda.CfnFunction;
    cfnFunction.addPropertyOverride(
      'Code.S3ObjectVersion',
      cdk.Fn.conditionIf(hasBlobAuthorizerVersion.logicalId, props.blobAuthorizerReference.versionId ?? '', cdk.Aws.NO_VALUE),
    );

    // Lambda@Edge needs explicit IAM permissions; it can't assume it has access to regional DynamoDB tables.
    // Grant only read access to the required tables (+ index access for Query).
    const dynamoResourceArns = [
      props.itemTableArn,
      props.configTableArn,
      props.authKeyStoreTableArn,
      Fn.join('', [props.itemTableArn, '/index/*']),
      Fn.join('', [props.configTableArn, '/index/*']),
      Fn.join('', [props.authKeyStoreTableArn, '/index/*']),
    ];

    this.blobAuthorizerFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
        ],
        resources: dynamoResourceArns,
      })
    );
  }
}
