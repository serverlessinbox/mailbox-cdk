import type { IArtifactResolver, ResolvedArtifact }                                                                                        from '@serverlessinbox/artifact-registry-cdk';
import type { ServerlessInboxDeployerType }                                                                                                from '@serverlessinbox/mailbox-cdk-shared';
import { ArtifactObject, ComponentDescription, DeployedStack, DeployerInfra, PositionHash, StackIdentity, serverlessInboxSubStackTags }    from '@serverlessinbox/mailbox-cdk-shared';
import * as acm                                                                                                                            from 'aws-cdk-lib/aws-certificatemanager';
import * as iam                                                                                                                            from 'aws-cdk-lib/aws-iam';
import * as lambda                                                                                                                         from 'aws-cdk-lib/aws-lambda';
import * as route53                                                                                                                        from 'aws-cdk-lib/aws-route53';
import { Aws, CustomResource, Stack }                                                                                                      from 'aws-cdk-lib';
import { Construct }                                                                                                                       from 'constructs';

import { JmapBlobDownloadLambda }                                                                                                          from '../../resources/lambdas/jmap-blob-download-lambda';
import { MailboxEdgeDeployerWorkerLambda }                                                                                                 from '../../resources/lambdas/mailbox-edge-deployer-worker-lambda';
import { EdgeFunctionRole }                                                                                                                from '../../resources/roles/edge-function-role';
import type { IAuthKeyStoreTable }                                                                                                         from '../../resources/tables/auth-key-store-table';
import type { IDataTable }                                                                                                                 from '../../resources/tables/data-tables';
import type { IMailboxDomainNames }                                                                                                        from '../domains/mailbox-domains';

import type { MailboxEdgeStackParameters }                                                                                                 from './mailbox-edge-stack';

/** Inputs of `MailboxEdgeDeployer`: the domain, the regional tables the edge stack is pointed at, and the tagging values. */
export interface MailboxEdgeDeployerProps {
  readonly artifactResolver: IArtifactResolver;

  /** The endpoint names; the edge certificate covers the webmail, admin, auth and cdn names. */
  readonly domains: IMailboxDomainNames;

  /** Route53 hosted zone for DNS validation and certificate creation (optional) */
  readonly hostedZone?: route53.IHostedZone;

  /** Regional item table; its ARN is passed to the edge stack as a template parameter. */
  readonly itemTable: IDataTable;

  /** Regional config table; its ARN is passed to the edge stack as a template parameter. */
  readonly configTable: IDataTable;

  /**
   * Regional auth key store table. Read access is granted to the jmap-blob-download role, and its
   * ARN is passed to the edge stack as a template parameter.
   */
  readonly authKeyStoreTable: IAuthKeyStoreTable;

  /** Product/stack version used for tagging edge resources. */
  readonly productVersion: string;

  /** Name of the shared home-region log group, passed to the edge stack as its `logGroupName` parameter. */
  readonly logGroupName: string;

  /** Deployment mechanism label, resolved once by the composition root and threaded down for tagging. */
  readonly deployerType: ServerlessInboxDeployerType;
}

/**
 * Deploys the MailboxEdgeStack to us-east-1 from a versioned/channeled template in S3,
 * and exposes its Outputs back into the current (regional) stack.
 */
export class MailboxEdgeDeployer extends Construct {
  private static readonly EDGE_STACK_RESOURCE_ID = 'edge-stack';
  private static readonly EDGE_REGION            = 'us-east-1';
  private static readonly TEMPLATE_OBJECT        = 'edge-stack-template.json';
  private static readonly BLOB_DOWNLOAD_OBJECT   = `lambdas/${JmapBlobDownloadLambda.ARTIFACT_NAME}.zip`;

  /** Published Lambda@Edge version for the JMAP blob download (always present). */
  public readonly jmapBlobDownloadVersion: lambda.IVersion;

  /** us-east-1 ACM certificate for CloudFront (only when hosted zone info is provided). */
  public readonly edgeCertificate?: acm.ICertificate;

  public readonly jmapBlobDownloadRole: iam.IRole;

  private readonly resource: CustomResource;

  constructor(scope: Construct, id: string, props: MailboxEdgeDeployerProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Deploys the us-east-1 edge stack (Lambda@Edge / CloudFront Functions) needed for CDN auth and routing.');

    // The deployed CloudFormation stack name, not the CDK logical stack id, so the template also
    // behaves correctly when deployed through plain CloudFormation. The position hash makes a moved
    // deployer deploy a new stack, so the delete of the old resource removes only the old stack.
    const edgeStackName = `${Aws.STACK_NAME}-edge-${PositionHash.ofChild(this, MailboxEdgeDeployer.EDGE_STACK_RESOURCE_ID)}`;

    // Scopes the functions and replica log groups, which are named from the edge stack name, and the hashed stack's resource group.
    const edgeStackNamePattern = `${Aws.STACK_NAME}-edge-*`;
    this.jmapBlobDownloadRole  = new EdgeFunctionRole(this, 'jmap-blob-download-role', { authKeyStoreTable: props.authKeyStoreTable, edgeStackNamePattern });
    const edgeStack            = new DeployedStack(Stack.of(this).formatArn({
      service:      'cloudformation',
      region:       MailboxEdgeDeployer.EDGE_REGION,
      resource:     'stack',
      resourceName: `${edgeStackNamePattern}/*`,
    }));

    const infra = new DeployerInfra(this, 'infra', {
      artifactResolver:       props.artifactResolver,
      stateMachineNamePrefix: 'mailbox-edge-deployer-',
      deployedStackName:      'edge',
      deployedStack:          edgeStack,
      createWorker:           (workerScope: Construct, workerId: string) => new MailboxEdgeDeployerWorkerLambda(workerScope, workerId, {
        artifactResolver: props.artifactResolver,
        edgeStackNamePattern,
        edgeStack,
        rootStack:            Aws.STACK_NAME,
        rootStackId:          StackIdentity.guid,
        template:             new ArtifactObject(props.artifactResolver, JmapBlobDownloadLambda.ARTIFACT_PACKAGE, MailboxEdgeDeployer.TEMPLATE_OBJECT),
        artifactObjects:      [
          new ArtifactObject(props.artifactResolver, JmapBlobDownloadLambda.ARTIFACT_PACKAGE, MailboxEdgeDeployer.BLOB_DOWNLOAD_OBJECT),
        ],
        hostedZoneId:         props.hostedZone?.hostedZoneId,
        jmapBlobDownloadRole: this.jmapBlobDownloadRole,
      }),
    });

    this.resource = infra.deployStack(this, MailboxEdgeDeployer.EDGE_STACK_RESOURCE_ID, 'Custom::MailboxEdgeDeployer', {
      stackName:             edgeStackName,
      templateUrl:           props.artifactResolver.getUrl(JmapBlobDownloadLambda.ARTIFACT_PACKAGE, MailboxEdgeDeployer.TEMPLATE_OBJECT),
      parameters:            {
        ...this.templateParameters(props, props.artifactResolver.resolve(JmapBlobDownloadLambda.ARTIFACT_PACKAGE, MailboxEdgeDeployer.BLOB_DOWNLOAD_OBJECT)),
      },
      tags:                  serverlessInboxSubStackTags({
        rootStack:   Aws.STACK_NAME,
        rootStackId: StackIdentity.guid,
        stack:       edgeStackName,
      }),
      terminationProtection: false,
      region:                MailboxEdgeDeployer.EDGE_REGION,
    });

    this.jmapBlobDownloadVersion = lambda.Version.fromVersionArn(
      this,
      'jmap-blob-download-version',
      this.getOutput('jmapBlobDownloadVersionArn'),
    );

    if (props.hostedZone) {
      this.edgeCertificate = acm.Certificate.fromCertificateArn(
        this,
        'edge-certificate',
        this.getOutput('edgeCertificateArn'),
      );
    }
  }

  /** Read a specific CloudFormation output (OutputKey) from the deployed edge stack. */
  public getOutput(outputKey: string): string {
    return this.resource.getAttString(outputKey);
  }

  private templateParameters(props: MailboxEdgeDeployerProps, jmapBlobDownload: ResolvedArtifact): MailboxEdgeStackParameters {
    return {
      artifactBucket:              jmapBlobDownload.bucket,
      jmapBlobDownloadKey:         jmapBlobDownload.key,
      jmapBlobDownloadRoleArn:     this.jmapBlobDownloadRole.roleArn,
      itemTableArn:                props.itemTable.tableArn,
      configTableArn:              props.configTable.tableArn,
      authKeyStoreTableArn:        props.authKeyStoreTable.tableArn,
      logGroupName:                props.logGroupName,
      rootStack:                   Aws.STACK_NAME,
      rootStackId:                 StackIdentity.guid,
      rootRegion:                  Aws.REGION,
      productVersion:              props.productVersion,
      deployerType:                props.deployerType,
      jmapBlobDownloadS3VersionId: jmapBlobDownload.versionId ?? '',
      ...(props.hostedZone
        ? {
          hostedZoneId:   props.hostedZone.hostedZoneId,
          hostedZoneName: props.hostedZone.zoneName,
          webmailHost:    props.domains.webmail,
          adminHost:      props.domains.admin,
          cdnHost:        props.domains.cdn,
        }
        : {}),
    };
  }
}
