import {
  ServerlessInboxResourceGroup,
  applyServerlessInboxBaseTagsWithDeployerType,
  applyServerlessInboxComponentTag,
  applyServerlessInboxEdgeTags,
} from '@serverlessinbox/mailbox-cdk-shared';
import type { ServerlessInboxDeployerType } from '@serverlessinbox/mailbox-cdk-shared';
import * as cdk                             from 'aws-cdk-lib';
import { Construct }                        from 'constructs';

import { retainOnUpdateOrDelete }           from '../../utils/cfn-resource';
import { MailboxResourceDescriptions }      from '../../utils/resource-descriptions';

import { MailboxEdgeConstruct }             from './mailbox-edge-construct';

/**
 * The values of the edge stack's CloudFormation parameters, one key per parameter. The stack declares
 * exactly these parameters and the deployer supplies a value for each; the hosted zone pair is
 * left out when the mailbox has no hosted zone.
 */
export interface MailboxEdgeStackParameters {
  readonly rootStack:                   string;
  readonly rootStackId:                 string;
  readonly rootRegion:                  string;
  readonly productVersion:              string;
  readonly deployerType:                ServerlessInboxDeployerType;
  readonly domainName:                  string;
  readonly prefix:                      string;
  readonly hostedZoneId?:               string;
  readonly hostedZoneName?:             string;
  readonly artifactBucket:              string;
  readonly jmapBlobDownloadKey:         string;
  readonly jmapBlobDownloadS3VersionId: string;
  readonly itemTableArn:                string;
  readonly configTableArn:              string;
  readonly authKeyStoreTableArn:        string;
  readonly logGroupName:                string;
  readonly jmapBlobDownloadRoleArn:     string;
}

/**
 * The stack deployed in us-east-1: CloudFormation parameters for the domain configuration and the S3
 * artifact locations, and the {@link MailboxEdgeConstruct} built from them.
 */
export class MailboxEdgeStack extends cdk.Stack {
  private static readonly PARAMETERS: Record<keyof MailboxEdgeStackParameters, cdk.CfnParameterProps> = {
    rootStack:                   {
      type:        'String',
      description: 'Root (main) CloudFormation stack name (regional stack that created this edge stack)',
    },
    rootStackId:                 {
      type:        'String',
      description: 'Unique id (stack id guid) of the root (main) CloudFormation stack',
    },
    rootRegion:                  {
      type:        'String',
      description: 'Root (main) AWS region (regional stack region that created this edge stack)',
    },
    productVersion:              {
      type:        'String',
      description: 'Serverless Inbox Mailbox stack version (for tagging/support)',
      default:     'unknown',
    },
    deployerType:                {
      type:          'String',
      description:   'Deployment mechanism label (cdk|cfn|marketplace) used for tagging',
      default:       'cfn',
      allowedValues: ['cdk', 'cfn', 'marketplace'],
    },
    domainName:                  {
      type:        'String',
      description: 'Base domain name (e.g. example.com)',
      // Match ACM domain validation (no trailing dot, no underscores, etc.).
      allowedPattern:        '^(\\*\\.)?(((?!-)[A-Za-z0-9-]{0,62}[A-Za-z0-9])\\.)+((?!-)[A-Za-z0-9-]{1,62}[A-Za-z0-9])$',
      constraintDescription: 'Must be a valid DNS name like example.com (no trailing dot).',
    },
    prefix:                      {
      type:                  'String',
      description:           'Prefix with dots: "." for no prefix, or ".{prefix}." for a prefix',
      default:               '.',
      allowedPattern:        '^\\.$|^\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.$',
      constraintDescription: 'Use "." for no namespace, or use a dot-wrapped DNS label like ".mailbox."',
    },
    hostedZoneId:                {
      type:        'String',
      description: 'Route53 hosted zone ID for DNS validation (optional)',
      default:     '',
    },
    hostedZoneName:              {
      type:        'String',
      description: 'Route53 hosted zone name (required if HostedZoneId is provided)',
      default:     '',
    },
    artifactBucket:              {
      type:        'String',
      description: 'S3 bucket containing artifacts',
    },
    jmapBlobDownloadKey:         {
      type:        'String',
      description: 'S3 key for jmap-blob-download Lambda code (full path including artifact prefix)',
    },
    jmapBlobDownloadS3VersionId: {
      type:        'String',
      description: 'S3 object version ID for jmap-blob-download Lambda code (optional)',
      default:     '',
    },
    itemTableArn:                {
      type:        'String',
      description: 'DynamoDB item table ARN (regional) used by jmap-blob-download',
    },
    configTableArn:              {
      type:        'String',
      description: 'DynamoDB config table ARN (regional) used by jmap-blob-download',
    },
    authKeyStoreTableArn:        {
      type:        'String',
      description: 'DynamoDB auth key store table ARN (regional) used by jmap-blob-download',
    },
    logGroupName:                {
      type:        'String',
      description: 'Name of the shared "jmap" pipeline log group (home region) that jmap-blob-download logs into',
    },
    jmapBlobDownloadRoleArn:     {
      type:        'String',
      description: 'ARN of the jmap-blob-download Lambda@Edge execution role (created in root stack)',
    },
  };

  public readonly construct: MailboxEdgeConstruct;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.templateOptions.description =
      'Serverless JMAP email server on AWS edge tier — CloudFront distribution with Lambda@Edge for authentication and request routing.';

    const parameters = this.declareParameters();

    this.applyTagsAndDescriptions(parameters);

    new ServerlessInboxResourceGroup(this, 'resource-group', {
      rootStackValue: parameters.rootStack,
    });

    const hasHostedZone = this.declareHasHostedZone(parameters);

    this.construct = this.createEdgeConstruct(parameters);

    this.retainEdgeFunction();
    this.construct.certificate.cfnOptions.condition = hasHostedZone;
    this.addOutputs(hasHostedZone);
  }

  /** One `CfnParameter` per key of {@link MailboxEdgeStackParameters}; its construct id is its logical id. */
  private declareParameters(): Required<MailboxEdgeStackParameters> {
    return {
      rootStack:                   this.declareParameter('rootStack'),
      rootStackId:                 this.declareParameter('rootStackId'),
      rootRegion:                  this.declareParameter('rootRegion'),
      productVersion:              this.declareParameter('productVersion'),
      deployerType:                this.declareParameter('deployerType') as ServerlessInboxDeployerType, // cast: the parameter's allowedValues are the deployer types
      domainName:                  this.declareParameter('domainName'),
      prefix:                      this.declareParameter('prefix'),
      hostedZoneId:                this.declareParameter('hostedZoneId'),
      hostedZoneName:              this.declareParameter('hostedZoneName'),
      artifactBucket:              this.declareParameter('artifactBucket'),
      jmapBlobDownloadKey:         this.declareParameter('jmapBlobDownloadKey'),
      jmapBlobDownloadS3VersionId: this.declareParameter('jmapBlobDownloadS3VersionId'),
      itemTableArn:                this.declareParameter('itemTableArn'),
      configTableArn:              this.declareParameter('configTableArn'),
      authKeyStoreTableArn:        this.declareParameter('authKeyStoreTableArn'),
      logGroupName:                this.declareParameter('logGroupName'),
      jmapBlobDownloadRoleArn:     this.declareParameter('jmapBlobDownloadRoleArn'),
    };
  }

  private declareParameter(name: keyof MailboxEdgeStackParameters): string {
    return new cdk.CfnParameter(this, name, MailboxEdgeStack.PARAMETERS[name]).valueAsString;
  }

  private applyTagsAndDescriptions(parameters: Required<MailboxEdgeStackParameters>): void {
    applyServerlessInboxBaseTagsWithDeployerType(this, {
      product:   'mailbox',
      rootStack: parameters.rootStack,
    }, parameters.deployerType, parameters.rootStackId);
    applyServerlessInboxComponentTag(this, 'edge');
    applyServerlessInboxEdgeTags(this, {
      rootRegion: parameters.rootRegion,
    });

    cdk.Aspects.of(this).add(new MailboxResourceDescriptions(this.node.id, {
      fallbackDescription: 'ServerlessInbox edge tier - CloudFront / Lambda@Edge auth and routing.',
    }));
  }

  private declareHasHostedZone(parameters: Required<MailboxEdgeStackParameters>): cdk.CfnCondition {
    const hasHostedZone = new cdk.CfnCondition(this, 'HasHostedZone', {
      expression: cdk.Fn.conditionAnd(
        cdk.Fn.conditionNot(cdk.Fn.conditionEquals(parameters.hostedZoneId, '')),
        cdk.Fn.conditionNot(cdk.Fn.conditionEquals(parameters.hostedZoneName, '')),
      ),
    });
    hasHostedZone.overrideLogicalId('hasHostedZone');

    return hasHostedZone;
  }

  private createEdgeConstruct(parameters: Required<MailboxEdgeStackParameters>): MailboxEdgeConstruct {
    return new MailboxEdgeConstruct(this, 'edge', {
      domainName:                parameters.domainName,
      prefix:                    parameters.prefix,
      hostedZoneId:              parameters.hostedZoneId,
      hostedZoneName:            parameters.hostedZoneName,
      artifactBucket:            parameters.artifactBucket,
      jmapBlobDownloadReference: {
        key:       parameters.jmapBlobDownloadKey,
        bucket:    parameters.artifactBucket,
        versionId: parameters.jmapBlobDownloadS3VersionId,
      },
      itemTableArn:              parameters.itemTableArn,
      configTableArn:            parameters.configTableArn,
      authKeyStoreTableArn:      parameters.authKeyStoreTableArn,
      productVersion:            parameters.productVersion,
      logGroupName:              parameters.logGroupName,
      jmapBlobDownloadRoleArn:   parameters.jmapBlobDownloadRoleArn,
    });
  }

  /** CloudFront replicas keep referencing the function and its version after a stack update or delete would drop them, so CloudFormation must not delete either. */
  private retainEdgeFunction(): void {
    retainOnUpdateOrDelete(this.construct.jmapBlobDownloadFunction);
    retainOnUpdateOrDelete(this.construct.jmapBlobDownloadVersion);
  }

  private addOutputs(hasHostedZone: cdk.CfnCondition): void {
    const edgeCertificateArnOutput = new cdk.CfnOutput(this, 'EdgeCertificateArn', {
      value:       cdk.Fn.conditionIf(
        hasHostedZone.logicalId,
        this.construct.certificate.ref,
        '',
      ).toString(),
      description: 'ARN of the ACM certificate for CloudFront/Lambda@Edge (empty when no hosted zone configured)',
    });
    edgeCertificateArnOutput.overrideLogicalId('edgeCertificateArn');

    const jmapBlobDownloadVersionArnOutput = new cdk.CfnOutput(this, 'JmapBlobDownloadVersionArn', {
      value:       this.construct.jmapBlobDownloadVersion.functionArn,
      description: 'ARN of the published jmap-blob-download Lambda@Edge version',
    });
    jmapBlobDownloadVersionArnOutput.overrideLogicalId('jmapBlobDownloadVersionArn');
  }
}
