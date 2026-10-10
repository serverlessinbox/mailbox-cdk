import { Aws, CustomResource, Duration, Stack, Token } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ServerlessInboxDeployerType } from '@serverlessinbox/mailbox-cdk-shared';
import { DeployerInfra, serverlessInboxSubStackTags } from '@serverlessinbox/mailbox-cdk-shared';
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
   * Regional auth key store table. Read access is granted to the blob-authorizer role, and its
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

  /** Published Lambda@Edge version for blob authorization (always present). */
  public readonly blobAuthorizerVersion: lambda.IVersion;

  /** us-east-1 ACM certificate for CloudFront (only when hosted zone info is provided). */
  public readonly edgeCertificate?: acm.ICertificate;

  public readonly blobAuthorizerRole: iam.IRole;

  private readonly resource: CustomResource;

  constructor(scope: Construct, id: string, props: MailboxEdgeDeployerProps) {
    super(scope, id);

    const stack = Stack.of(this);

    // Lambda@Edge execution role. Note: replicas continue running for ~4 hours after function deletion,
    // but they operate with cached credentials and do not need the role to remain. The role is deleted
    // with the stack. On replacement (stack update), CloudFormation creates the new role before deleting
    // the old one, and the edge function is updated with the new ARN in the same operation.
    this.blobAuthorizerRole = new iam.Role(this, 'blob-authorizer-role', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com'),
      ),
      description: `Serverless Inbox Mailbox: blob-authorizer Lambda@Edge role (${Aws.STACK_NAME})`,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Only the auth key store is granted to the role; the item and config table ARNs reach the
    // edge stack as template parameters.
    props.authKeyStoreTable.grantRead(this.blobAuthorizerRole);

    // Uses the deployed CloudFormation stack name, not the CDK logical stack id, so the
    // synthesized template behaves correctly when deployed via pure CloudFormation.
    const edgeStackName = `${Aws.STACK_NAME}-edge`;
    const edgeStackArn = stack.formatArn({
      service: 'cloudformation',
      region: 'us-east-1',
      resource: 'stack',
      resourceName: `${edgeStackName}/*`,
    });

    const infra = new DeployerInfra(this, 'infra', {
      artifactResolver: props.artifactResolver,
      stateMachineNamePrefix: 'mailbox-edge-deployer-',
      parent: 'edge',
      createWorker: (workerScope: Construct, workerId: string) => new MailboxEdgeDeployerWorker(workerScope, workerId, {
        artifactResolver: props.artifactResolver,
        stack,
        edgeStackName,
        edgeStackArn,
        rootStack: Aws.STACK_NAME,
        templateObjectArn: props.artifactResolver.getArn('mailbox-cdk-edge', 'edge-stack-template.json'),
        artifactObjectArns: [
          props.artifactResolver.getArn('mailbox-cdk-edge', 'lambdas/blob-authorizer.zip'),
        ],
        hostedZoneId: props.hostedZone?.hostedZoneId,
        blobAuthorizerRoleArn: this.blobAuthorizerRole.roleArn,
      }),
    });

    const templateUrl = props.artifactResolver.getUrl('mailbox-cdk-edge', 'edge-stack-template.json');

    const blobAuthorizerResolved = props.artifactResolver.resolve('mailbox-cdk-edge', 'lambdas/blob-authorizer.zip');

    const cfnParameters: Record<string, string> = {
      domainName: props.domainName,
      artifactBucket: blobAuthorizerResolved.bucket,
      blobAuthorizerKey: blobAuthorizerResolved.key,
      blobAuthorizerRoleArn: this.blobAuthorizerRole.roleArn,
      itemTableArn: props.itemTable.tableArn,
      configTableArn: props.configTable.tableArn,
      authKeyStoreTableArn: props.authKeyStoreTable.tableArn,
      logGroupName: props.logGroupName,

      // Tagging and back-reference parameters. Keys must match the edge stack's CfnParameter
      // overrideLogicalId (rootStack / rootRegion).
      rootStack: Aws.STACK_NAME,
      rootRegion: Stack.of(this).region,
      productVersion: props.productVersion,
      deployerType: props.deployerType,
      blobAuthorizerS3VersionId: blobAuthorizerResolved.versionId ?? '',
    };

    // Edge template expects a dot-wrapped prefix: "." for no prefix, or ".{label}.".
    // Props.prefix may be either:
    // - A bare label (e.g., "mailbox") — normalize to dot-wrapped form
    // - An unresolved CDK token (e.g., from Fn.conditionIf) — pass through as-is
    // - Already dot-wrapped (e.g., ".mailbox.") — pass through as-is
    // Token.isUnresolved is checked before calling .trim(), which would resolve the token.
    if (Token.isUnresolved(props.prefix)) {
      cfnParameters.prefix = props.prefix as string;
    } else {
      const rawPrefix = (props.prefix ?? '').trim();
      const normalizedPrefixLabel = rawPrefix.replace(/^\.+/, '').replace(/\.+$/, '');
      cfnParameters.prefix = normalizedPrefixLabel ? `.${normalizedPrefixLabel}.` : '.';
    }

    if (props.hostedZone) {
      cfnParameters.hostedZoneId = props.hostedZone.hostedZoneId;
      cfnParameters.hostedZoneName = props.hostedZone.zoneName;
    }

    this.resource = new CustomResource(this, 'resource', {
      serviceToken: infra.starter.functionArn,
      resourceType: 'Custom::MailboxEdgeDeployer',
      serviceTimeout: Duration.hours(1), // caps CFN's default multi-hour wait
      properties: {
        stackName: edgeStackName,
        templateUrl,
        parameters: cfnParameters,
        // Object-level correlation tags on the edge AWS::CloudFormation::Stack itself.
        tags: serverlessInboxSubStackTags({
          rootStack: Aws.STACK_NAME,
          stack: edgeStackName,
          version: props.productVersion,
        }),
        terminationProtection: props.terminationProtection ?? false,
        region: 'us-east-1',
      },
    });

    // Ensure the workflow remains until after the custom resource is deleted.
    this.resource.node.addDependency(infra.workflow.stateMachine);

    this.edgeStackId = this.resource.ref;

    this.blobAuthorizerVersion = lambda.Version.fromVersionArn(
      this,
      'blob-authorizer-version',
      this.getOutput('blobAuthorizerVersionArn'),
    );

    const hasHostedZone = Boolean(props.hostedZone);
    if (hasHostedZone) {
      const certificateArn = this.getOutput('edgeCertificateArn');
      this.edgeCertificate = acm.Certificate.fromCertificateArn(
        this,
        'edge-certificate',
        certificateArn,
      );
    }
  }

  /** Read a specific CloudFormation output (OutputKey) from the deployed edge stack. */
  public getOutput(outputKey: string): string {
    return this.resource.getAttString(outputKey);
  }
}
