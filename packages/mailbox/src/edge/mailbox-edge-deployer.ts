import { Aws, CustomResource, Stack, Token } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import type { IArtifactResolver, ResolvedArtifact } from '@serverlessinbox/artifact-registry-cdk';
import type { ServerlessInboxDeployerType } from '@serverlessinbox/mailbox-cdk-shared';
import { DeployerInfra, PositionHash, StackIdentity, serverlessInboxSubStackTags } from '@serverlessinbox/mailbox-cdk-shared';
import type { IDataTable } from '../data/data-tables';
import { MailboxEdgeDeployerWorker } from './mailbox-edge-deployer-worker';

/** Inputs of `MailboxEdgeDeployer`: the domain, the regional tables the edge stack is pointed at, and the tagging values. */
export interface MailboxEdgeDeployerProps {
  readonly artifactResolver: IArtifactResolver;

  /** Base domain name (e.g. example.com) */
  readonly domainName: string;

  /** Optional prefix between endpoint and base domain (e.g. "mailbox" -> admin.mailbox.example.com) */
  readonly prefix?: string;

  /** Route53 hosted zone for DNS validation and certificate creation (optional) */
  readonly hostedZone?: route53.IHostedZone;

  /** Whether to enable termination protection on the edge stack (default: false) */
  readonly terminationProtection?: boolean;

  /** Regional item table; its ARN is passed to the edge stack as a template parameter. */
  readonly itemTable: IDataTable;

  /** Regional config table; its ARN is passed to the edge stack as a template parameter. */
  readonly configTable: IDataTable;

  /**
   * Regional auth key store table. Read access is granted to the jmap-blob-download role, and its
   * ARN is passed to the edge stack as a template parameter.
   */
  readonly authKeyStoreTable: IDataTable;

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
  public readonly edgeStackId: string;

  /** Published Lambda@Edge version for the JMAP blob download (always present). */
  public readonly jmapBlobDownloadVersion: lambda.IVersion;

  /** us-east-1 ACM certificate for CloudFront (only when hosted zone info is provided). */
  public readonly edgeCertificate?: acm.ICertificate;

  public readonly jmapBlobDownloadRole: iam.IRole;

  private static readonly EDGE_STACK_RESOURCE_ID = 'edge-stack';

  private readonly resource: CustomResource;

  constructor(scope: Construct, id: string, props: MailboxEdgeDeployerProps) {
    super(scope, id);

    const stack = Stack.of(this);

    this.jmapBlobDownloadRole = this.createJmapBlobDownloadRole(props.authKeyStoreTable);

    // The deployed CloudFormation stack name, not the CDK logical stack id, so the template also
    // behaves correctly when deployed through plain CloudFormation. The position hash makes a moved
    // deployer deploy a new stack, so the delete of the old resource removes only the old stack.
    const edgeStackName = `${Aws.STACK_NAME}-edge-${PositionHash.ofChild(this, MailboxEdgeDeployer.EDGE_STACK_RESOURCE_ID)}`;

    // Matches the name above and the unhashed `${Aws.STACK_NAME}-edge` that earlier installs deployed,
    // whose resource is deleted with this policy in force.
    const edgeStackNamePattern = `${Aws.STACK_NAME}-edge*`;
    const edgeStackArn = stack.formatArn({
      service: 'cloudformation',
      region: 'us-east-1',
      resource: 'stack',
      resourceName: `${edgeStackNamePattern}/*`,
    });

    const infra = new DeployerInfra(this, 'infra', {
      artifactResolver: props.artifactResolver,
      stateMachineNamePrefix: 'mailbox-edge-deployer-',
      deployedStackName: 'edge',
      deployedStackArn: edgeStackArn,
      createWorker: (workerScope: Construct, workerId: string) => new MailboxEdgeDeployerWorker(workerScope, workerId, {
        artifactResolver: props.artifactResolver,
        stack,
        edgeStackNamePattern,
        edgeStackArn,
        rootStack: Aws.STACK_NAME,
        rootStackId: StackIdentity.guid,
        templateObjectArn: props.artifactResolver.getArn('mailbox-cdk-edge', 'edge-stack-template.json'),
        artifactObjectArns: [
          props.artifactResolver.getArn('mailbox-cdk-edge', 'lambdas/jmap-blob-download.zip'),
        ],
        hostedZoneId: props.hostedZone?.hostedZoneId,
        jmapBlobDownloadRoleArn: this.jmapBlobDownloadRole.roleArn,
      }),
    });

    this.resource = infra.deployStack(this, MailboxEdgeDeployer.EDGE_STACK_RESOURCE_ID, 'Custom::MailboxEdgeDeployer', {
      stackName: edgeStackName,
      templateUrl: props.artifactResolver.getUrl('mailbox-cdk-edge', 'edge-stack-template.json'),
      parameters: this.templateParameters(props, props.artifactResolver.resolve('mailbox-cdk-edge', 'lambdas/jmap-blob-download.zip')),
      tags: serverlessInboxSubStackTags({
        rootStack: Aws.STACK_NAME,
        rootStackId: StackIdentity.guid,
        stack: edgeStackName,
        version: props.productVersion,
      }),
      terminationProtection: props.terminationProtection ?? false,
      region: 'us-east-1',
    });

    this.edgeStackId = this.resource.ref;

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

  /**
   * Lambda@Edge execution role. Replicas keep running for about four hours after the function is
   * deleted, but on cached credentials, so they do not need the role to outlive the stack. On a
   * replacement CloudFormation creates the new role before deleting the old one, and updates the
   * edge function with the new ARN in the same operation.
   */
  private createJmapBlobDownloadRole(authKeyStoreTable: IDataTable): iam.Role {
    const role = new iam.Role(this, 'jmap-blob-download-role', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com'),
      ),
      description: `Serverless Inbox Mailbox: jmap-blob-download Lambda@Edge role (${Aws.STACK_NAME})`,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Only the auth key store is granted; the item and config table ARNs reach the edge stack as template parameters.
    authKeyStoreTable.grantRead(role);

    return role;
  }

  private templateParameters(props: MailboxEdgeDeployerProps, jmapBlobDownload: ResolvedArtifact): Record<string, string> {
    return {
      domainName: props.domainName,
      artifactBucket: jmapBlobDownload.bucket,
      jmapBlobDownloadKey: jmapBlobDownload.key,
      jmapBlobDownloadRoleArn: this.jmapBlobDownloadRole.roleArn,
      itemTableArn: props.itemTable.tableArn,
      configTableArn: props.configTable.tableArn,
      authKeyStoreTableArn: props.authKeyStoreTable.tableArn,
      logGroupName: props.logGroupName,
      rootStack: Aws.STACK_NAME,
      rootStackId: StackIdentity.guid,
      rootRegion: Stack.of(this).region,
      productVersion: props.productVersion,
      deployerType: props.deployerType,
      jmapBlobDownloadS3VersionId: jmapBlobDownload.versionId ?? '',
      prefix: this.dotWrappedPrefix(props.prefix),
      ...(props.hostedZone
        ? { hostedZoneId: props.hostedZone.hostedZoneId, hostedZoneName: props.hostedZone.zoneName }
        : {}),
    };
  }

  /**
   * The edge template expects a dot-wrapped prefix: "." for none, or ".{label}.". A bare label is
   * wrapped, an unresolved token (e.g. from Fn.conditionIf) is passed through untouched, since
   * trimming it would resolve it, and so is a prefix already wrapped.
   */
  private dotWrappedPrefix(prefix: string | undefined): string {
    if (prefix !== undefined && Token.isUnresolved(prefix)) {
      return prefix;
    }

    const label = (prefix ?? '').trim().replace(/^\.+/, '').replace(/\.+$/, '');
    return label ? `.${label}.` : '.';
  }
}
