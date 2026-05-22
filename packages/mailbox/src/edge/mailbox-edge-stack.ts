import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { MailboxEdgeConstruct, type MailboxEdgeConstructProps } from './mailbox-edge-construct';
import { type ArtifactReference } from '../artifacts/artifact-prefix';
import {
  applyServerlessInboxBaseTags,
  applyServerlessInboxComponentTag,
  applyServerlessInboxEdgeTags,
  type ServerlessInboxDeployer,
} from '../utils/serverless-inbox-tags';

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

    const originDeploymentParam = new cdk.CfnParameter(this, 'origin-deployment', {
      type: 'String',
      description: 'Originating CloudFormation stack name (regional stack that created this edge stack)',
    });
    originDeploymentParam.overrideLogicalId('originDeployment');

    const originRegionParam = new cdk.CfnParameter(this, 'origin-region', {
      type: 'String',
      description: 'Originating AWS region (regional stack region that created this edge stack)',
    });
    originRegionParam.overrideLogicalId('originRegion');

    const productVersionParam = new cdk.CfnParameter(this, 'product-version', {
      type: 'String',
      description: 'Serverless Inbox Mailbox stack version (for tagging/support)',
      default: 'unknown',
    });
    productVersionParam.overrideLogicalId('productVersion');

    const deployerParam = new cdk.CfnParameter(this, 'deployer', {
      type: 'String',
      description: 'Deployment mechanism label (cdk|cfn|marketplace) used for tagging',
      default: 'cfn',
      allowedValues: ['cdk', 'cfn', 'marketplace'],
    });
    deployerParam.overrideLogicalId('deployer');

    // Apply product/deployment tags to everything in this edge stack, and add origin back-references.
    applyServerlessInboxBaseTags(this, {
      product: 'mailbox',
      // In the edge stack, deployment is the edge stack name (AWS::StackName).
      version: productVersionParam.valueAsString,
      deployer: deployerParam.valueAsString as unknown as ServerlessInboxDeployer,
    });
    applyServerlessInboxComponentTag(this, 'edge');
    applyServerlessInboxEdgeTags(this, {
      originDeployment: originDeploymentParam.valueAsString,
      originRegion: originRegionParam.valueAsString,
    });

    // Define CloudFormation parameters so the template is configurable
    const domainNameParam = new cdk.CfnParameter(this, 'domain-name', {
      type: 'String',
      description: 'Base domain name (e.g. example.com)',
      // Match ACM domain validation (no trailing dot, no underscores, etc.).
      allowedPattern: '^(\\*\\.)?(((?!-)[A-Za-z0-9-]{0,62}[A-Za-z0-9])\\.)+((?!-)[A-Za-z0-9-]{1,62}[A-Za-z0-9])$',
      constraintDescription: 'Must be a valid DNS name like example.com (no trailing dot).',
    });
    domainNameParam.overrideLogicalId('domainName');

    const prefixParam = new cdk.CfnParameter(this, 'prefix', {
      type: 'String',
      description: 'Prefix with dots: "." for no prefix, or ".{prefix}." for a prefix',
      default: '.',
      // No empty strings: keeps deployments predictable and avoids conditional logic.
      // Examples: "." or ".mailbox.".
      allowedPattern: '^\\.$|^\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.$',
      constraintDescription: 'Must be "." or a dot-wrapped DNS label like ".mailbox."',
    });
    prefixParam.overrideLogicalId('prefix');

    const hostedZoneIdParam = new cdk.CfnParameter(this, 'hosted-zone-id', {
      type: 'String',
      description: 'Route53 hosted zone ID for DNS validation (optional)',
      default: '',
    });
    hostedZoneIdParam.overrideLogicalId('hostedZoneId');

    const hostedZoneNameParam = new cdk.CfnParameter(this, 'hosted-zone-name', {
      type: 'String',
      description: 'Route53 hosted zone name (required if HostedZoneId is provided)',
      default: '',
    });
    hostedZoneNameParam.overrideLogicalId('hostedZoneName');

    const hasHostedZone = new cdk.CfnCondition(this, 'has-hosted-zone', {
      expression: cdk.Fn.conditionAnd(
        cdk.Fn.conditionNot(cdk.Fn.conditionEquals(hostedZoneIdParam.valueAsString, '')),
        cdk.Fn.conditionNot(cdk.Fn.conditionEquals(hostedZoneNameParam.valueAsString, '')),
      ),
    });
    hasHostedZone.overrideLogicalId('hasHostedZone');

    const artifactBucketParam = new cdk.CfnParameter(this, 'artifact-bucket', {
      type: 'String',
      description: 'S3 bucket containing artifacts',
    });
    artifactBucketParam.overrideLogicalId('artifactBucket');

    const blobAuthorizerKeyParam = new cdk.CfnParameter(this, 'blob-authorizer-key', {
      type: 'String',
      description: 'S3 key for blob-authorizer Lambda code (full path including artifact prefix)',
    });
    blobAuthorizerKeyParam.overrideLogicalId('blobAuthorizerKey');

    const blobAuthorizerS3VersionIdParam = new cdk.CfnParameter(this, 'blob-authorizer-s3-version-id', {
      type: 'String',
      description: 'S3 object version ID for blob-authorizer Lambda code (optional)',
      default: '',
    });
    blobAuthorizerS3VersionIdParam.overrideLogicalId('blobAuthorizerS3VersionId');

    const itemTableArnParam = new cdk.CfnParameter(this, 'item-table-arn', {
      type: 'String',
      description: 'DynamoDB item table ARN (regional) used by blob-authorizer',
    });
    itemTableArnParam.overrideLogicalId('itemTableArn');

    const configTableArnParam = new cdk.CfnParameter(this, 'config-table-arn', {
      type: 'String',
      description: 'DynamoDB config table ARN (regional) used by blob-authorizer',
    });
    configTableArnParam.overrideLogicalId('configTableArn');

    const authKeyStoreTableArnParam = new cdk.CfnParameter(this, 'auth-key-store-table-arn', {
      type: 'String',
      description: 'DynamoDB auth key store table ARN (regional) used by blob-authorizer',
    });
    authKeyStoreTableArnParam.overrideLogicalId('authKeyStoreTableArn');

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
      authKeyStoreTableArn: authKeyStoreTableArnParam.valueAsString,
    };

    this.construct = new MailboxEdgeConstruct(this, 'edge', constructProps);

    // Only create the certificate resource when hosted zone parameters are provided.
    // This avoids getting stuck on email validation when no hosted zone is available.
    const cfnCertificate = this.construct.certificate.node.defaultChild as cdk.CfnResource;
    cfnCertificate.cfnOptions.condition = hasHostedZone;

    // Always expose the output key so the regional stack can safely `GetAtt` it.
    // When HasHostedZone is false, the output value is an empty string.
    const edgeCertificateArnOutput = new cdk.CfnOutput(this, 'edge-certificate-arn', {
      value: cdk.Fn.conditionIf(
        hasHostedZone.logicalId,
        this.construct.certificate.certificateArn,
        '',
      ).toString(),
      description: 'ARN of the ACM certificate for CloudFront/Lambda@Edge (empty when no hosted zone configured)',
    });
    edgeCertificateArnOutput.overrideLogicalId('edgeCertificateArn');

    const blobAuthorizerVersionArnOutput = new cdk.CfnOutput(this, 'blob-authorizer-version-arn', {
      value: this.construct.blobAuthorizerVersion.functionArn,
      description: 'ARN of the published blob-authorizer Lambda@Edge version',
    });
    blobAuthorizerVersionArnOutput.overrideLogicalId('blobAuthorizerVersionArn');
  }
}
