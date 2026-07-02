import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { MailboxEdgeConstruct, type MailboxEdgeConstructProps } from './mailbox-edge-construct';
import type { ResolvedArtifact } from '@serverlessinbox/artifact-registry';
import {
  applyServerlessInboxBaseTags,
  applyServerlessInboxComponentTag,
  applyServerlessInboxEdgeTags,
  type ServerlessInboxDeployer,
} from '../utils/serverless-inbox-tags';
import { MailboxResourceDescriptions } from '../utils/resource-descriptions';
import { addServerlessInboxResourceGroup } from '../utils/resource-group';

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

    const rootStackParam = new cdk.CfnParameter(this, 'root-stack', {
      type: 'String',
      description: 'Root (main) CloudFormation stack name (regional stack that created this edge stack)',
    });
    rootStackParam.overrideLogicalId('rootStack');

    const rootRegionParam = new cdk.CfnParameter(this, 'root-region', {
      type: 'String',
      description: 'Root (main) AWS region (regional stack region that created this edge stack)',
    });
    rootRegionParam.overrideLogicalId('rootRegion');

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

    // Apply product/correlation tags to everything in this edge stack, and add root back-references.
    applyServerlessInboxBaseTags(this, {
      product: 'mailbox',
      // root-stack is the main stack name (flows in via the rootStack param);
      // the base helper tags this edge stack's own name as `stack` (AWS::StackName).
      rootStack: rootStackParam.valueAsString,
      version: productVersionParam.valueAsString,
      deployer: deployerParam.valueAsString as unknown as ServerlessInboxDeployer,
    });
    applyServerlessInboxComponentTag(this, 'edge');
    applyServerlessInboxEdgeTags(this, {
      rootRegion: rootRegionParam.valueAsString,
    });

    // Add Name tags + native descriptions to every L1 in this edge sub-stack. Its resource ids
    // aren't in the main-stack component map, so supply an edge-tier fallback sentence. Anchor on
    // this stack's own id so path tails are computed relative to the sub-stack root.
    cdk.Aspects.of(this).add(new MailboxResourceDescriptions(this.node.id, {
      fallbackDescription: 'ServerlessInbox edge tier - CloudFront / Lambda@Edge auth and routing.',
    }));

    // Per-region (us-east-1) AWS Resource Group collecting this deployment's edge resources.
    // Matches the root-stack value flowing in from the main stack via the rootStack param.
    addServerlessInboxResourceGroup(this, 'resource-group', {
      rootStackValue: rootStackParam.valueAsString,
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
      // Allow "." (no prefix) or dot-wrapped labels like ".mailbox.".
      allowedPattern: '^\\.$|^\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.$',
      constraintDescription: 'Use "." for no namespace, or use a dot-wrapped DNS label like ".mailbox."',
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
    const blobAuthorizerReference: ResolvedArtifact = {
      key: blobAuthorizerKeyParam.valueAsString,
      bucket: artifactBucketParam.valueAsString,
      versionId: blobAuthorizerS3VersionIdParam.valueAsString,
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

    // RETAIN_ON_UPDATE_OR_DELETE the blob-authorizer Lambda@Edge function and version to prevent CloudFormation
    // from deleting them while CloudFront replicas still hold references. The resource sweeper
    // will delete them asynchronously after the replica propagation window drains (~4 hours).
    // RETAIN_ON_UPDATE_OR_DELETE ensures we don't orphan failed-create stubs while still protecting real deletions.
    (this.construct.blobAuthorizerFunction.node.defaultChild as cdk.CfnResource)
      .applyRemovalPolicy(cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
    (this.construct.blobAuthorizerVersion.node.defaultChild as cdk.CfnResource)
      .applyRemovalPolicy(cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

    // Only create the certificate resource when hosted zone parameters are provided.
    // This avoids getting stuck on email validation when no hosted zone is available.
    const cfnCertificate = this.construct.certificate;
    cfnCertificate.cfnOptions.condition = hasHostedZone;

    // Always expose the output key so the regional stack can safely `GetAtt` it.
    // When HasHostedZone is false, the output value is an empty string.
    const edgeCertificateArnOutput = new cdk.CfnOutput(this, 'edge-certificate-arn', {
      value: cdk.Fn.conditionIf(
        hasHostedZone.logicalId,
        this.construct.certificate.ref,
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
