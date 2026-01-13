import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { MailboxEdgeConstruct, type MailboxEdgeConstructProps } from './mailbox-edge-construct';
import { type ArtifactReference } from '../utils/artifact-prefix';

export interface MailboxEdgeStackProps extends cdk.StackProps {
  // No additional props - configuration comes from CloudFormation parameters
}

/**
 * Deploy this stack in us-east-1.
 *
 * Creates CloudFormation parameters for domain configuration and S3 artifact locations,
 * and instantiates the MailboxEdgeConstruct.
 */
export class MailboxEdgeStack extends cdk.Stack {
  public readonly construct: MailboxEdgeConstruct;

  constructor(scope: Construct, id: string, props: MailboxEdgeStackProps) {
    super(scope, id, props);

    // Define CloudFormation parameters so the template is configurable
    const domainNameParam = new cdk.CfnParameter(this, 'DomainName', {
      type: 'String',
      description: 'Base domain name (e.g. example.com)',
      // Match ACM domain validation (no trailing dot, no underscores, etc.).
      allowedPattern: '^(\\*\\.)?(((?!-)[A-Za-z0-9-]{0,62}[A-Za-z0-9])\\.)+((?!-)[A-Za-z0-9-]{1,62}[A-Za-z0-9])$',
      constraintDescription: 'Must be a valid DNS name like example.com (no trailing dot).',
    });

    const prefixParam = new cdk.CfnParameter(this, 'Prefix', {
      type: 'String',
      description: 'Prefix with dots: "." for no prefix, or ".{prefix}." for a prefix',
      default: '.',
      // No empty strings: keeps deployments predictable and avoids conditional logic.
      // Examples: "." or ".mailbox.".
      allowedPattern: '^\\.$|^\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.$',
      constraintDescription: 'Must be "." or a dot-wrapped DNS label like ".mailbox."',
    });

    const hostedZoneIdParam = new cdk.CfnParameter(this, 'HostedZoneId', {
      type: 'String',
      description: 'Route53 hosted zone ID for DNS validation (optional)',
      default: '',
    });

    const hostedZoneNameParam = new cdk.CfnParameter(this, 'HostedZoneName', {
      type: 'String',
      description: 'Route53 hosted zone name (required if HostedZoneId is provided)',
      default: '',
    });

    const hasHostedZone = new cdk.CfnCondition(this, 'HasHostedZone', {
      expression: cdk.Fn.conditionAnd(
        cdk.Fn.conditionNot(cdk.Fn.conditionEquals(hostedZoneIdParam.valueAsString, '')),
        cdk.Fn.conditionNot(cdk.Fn.conditionEquals(hostedZoneNameParam.valueAsString, '')),
      ),
    });

    const artifactBucketParam = new cdk.CfnParameter(this, 'ArtifactBucket', {
      type: 'String',
      description: 'S3 bucket containing artifacts',
    });

    const blobAuthorizerKeyParam = new cdk.CfnParameter(this, 'BlobAuthorizerKey', {
      type: 'String',
      description: 'S3 key for blob-authorizer Lambda code (full path including artifact prefix)',
    });

    const blobAuthorizerS3VersionIdParam = new cdk.CfnParameter(this, 'BlobAuthorizerS3VersionId', {
      type: 'String',
      description: 'S3 object version ID for blob-authorizer Lambda code (optional)',
      default: '',
    });

    const itemTableArnParam = new cdk.CfnParameter(this, 'ItemTableArn', {
      type: 'String',
      description: 'DynamoDB item table ARN (regional) used by blob-authorizer',
    });

    const configTableArnParam = new cdk.CfnParameter(this, 'ConfigTableArn', {
      type: 'String',
      description: 'DynamoDB config table ARN (regional) used by blob-authorizer',
    });

    const jwkCacheTableArnParam = new cdk.CfnParameter(this, 'JwkCacheTableArn', {
      type: 'String',
      description: 'DynamoDB JWK cache table ARN (regional) used by blob-authorizer',
    });

    // Build artifact reference from parameters
    const blobAuthorizerReference: ArtifactReference = {
      key: blobAuthorizerKeyParam.valueAsString,
      s3VersionId: blobAuthorizerS3VersionIdParam.valueAsString !== '' ? blobAuthorizerS3VersionIdParam.valueAsString : undefined,
    };

    // Create the construct with values from CF parameters
    const constructProps: MailboxEdgeConstructProps = {
      domainName: domainNameParam.valueAsString,
      // Prefix is dot-wrapped: "." or ".label.".
      prefix: prefixParam.valueAsString,
      // Pass through parameters verbatim; condition logic must happen at deploy time, not synth time.
      hostedZoneId: hostedZoneIdParam.valueAsString,
      hostedZoneName: hostedZoneNameParam.valueAsString,
      artifactBucket: artifactBucketParam.valueAsString,
      blobAuthorizerReference,
      itemTableArn: itemTableArnParam.valueAsString,
      configTableArn: configTableArnParam.valueAsString,
      jwkCacheTableArn: jwkCacheTableArnParam.valueAsString,
    };

    this.construct = new MailboxEdgeConstruct(this, 'edge', constructProps);

    // Only create the certificate resource when hosted zone parameters are provided.
    // This avoids getting stuck on email validation when no hosted zone is available.
    const cfnCertificate = this.construct.certificate.node.defaultChild as cdk.CfnResource;
    cfnCertificate.cfnOptions.condition = hasHostedZone;

    // Always expose the output key so the regional stack can safely `GetAtt` it.
    // When HasHostedZone is false, the output value is an empty string.
    new cdk.CfnOutput(this, 'EdgeCertificateArn', {
      value: cdk.Fn.conditionIf(
        hasHostedZone.logicalId,
        this.construct.certificate.certificateArn,
        '',
      ).toString(),
      description: 'ARN of the ACM certificate for CloudFront/Lambda@Edge (empty when no hosted zone configured)',
    });

    new cdk.CfnOutput(this, 'BlobAuthorizerVersionArn', {
      value: this.construct.blobAuthorizerVersion.functionArn,
      description: 'ARN of the published blob-authorizer Lambda@Edge version',
    });
  }
}
