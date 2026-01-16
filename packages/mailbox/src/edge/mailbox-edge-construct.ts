import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Aws, Fn } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { type ArtifactReference } from '../utils/artifact-prefix';

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
  readonly blobAuthorizerReference: ArtifactReference;

  /** DynamoDB item table ARN (regional) used by blob-authorizer */
  readonly itemTableArn: string;

  /** DynamoDB config table ARN (regional) used by blob-authorizer */
  readonly configTableArn: string;

  /** DynamoDB JWK cache table ARN (regional) used by blob-authorizer */
  readonly jwkCacheTableArn: string;
}

/**
 * Creates an ACM certificate and optionally a blob-authorizer Lambda@Edge function.
 *
 * Accepts pre-resolved S3 locations - artifact prefix calculation happens in the deployer.
 */
export class MailboxEdgeConstruct extends Construct {
  public readonly certificate: acm.Certificate;
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
    this.certificate = new acm.Certificate(this, 'edge-certificate', {
      domainName: webmail,
      subjectAlternativeNames: [admin, auth, cdn],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // Create blob-authorizer Lambda
    const artifactBucket = typeof props.artifactBucket === 'string'
      ? s3.Bucket.fromBucketName(this, 'artifact-bucket', props.artifactBucket)
      : props.artifactBucket;

    // Lambda@Edge requires the execution role trust policy to allow BOTH principals.
    // CloudFront validates this during association.
    const blobAuthorizerRole = new iam.Role(this, 'blob-authorizer-role', {
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
        props.blobAuthorizerReference.s3VersionId,
      ),
      role: blobAuthorizerRole,
      description: `Serverless Inbox Mailbox: blob-authorizer Lambda@Edge (${Aws.STACK_NAME})`,
      // logGroup: new LogGroup(this, 'blob-authorizer-log-group', {
      //   retention: RetentionDays.ONE_MONTH,
      //   removalPolicy: RemovalPolicy.RETAIN,
      // }),
    });

    this.blobAuthorizerFunction = blobAuthorizerFunction;

    // CloudFront Lambda@Edge requires a published version.
    this.blobAuthorizerVersion = blobAuthorizerFunction.currentVersion;

    // Lambda@Edge needs explicit IAM permissions; it can't assume it has access to regional DynamoDB tables.
    // Grant only read access to the required tables (+ index access for Query).
    const dynamoResourceArns = [
      props.itemTableArn,
      props.configTableArn,
      props.jwkCacheTableArn,
      Fn.join('', [props.itemTableArn, '/index/*']),
      Fn.join('', [props.configTableArn, '/index/*']),
      Fn.join('', [props.jwkCacheTableArn, '/index/*']),
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
