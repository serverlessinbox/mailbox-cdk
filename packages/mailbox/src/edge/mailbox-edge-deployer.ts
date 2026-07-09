import { Aws, CustomResource, Duration, Stack, Token } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { StackDeployerInfra } from '../features/stack-deployer';
import { grantEdgeDeployerWorkerPermissions } from './mailbox-edge-deployer-grants';
import { serverlessInboxSubStackTags } from '../utils/serverless-inbox-tags';

export interface MailboxEdgeDeployerProps {
  /**
   * Artifact resolver for loading Lambda code and artifact locations from S3
   */
  readonly artifactResolver: ICdkArtifactEngine;

  /** Base domain name (e.g. example.com) */
  readonly domainName: string;

  /** Optional prefix between endpoint and base domain (e.g. "mailbox" -> admin.mailbox.example.com) */
  readonly prefix?: string;

  /** Route53 hosted zone ID for DNS validation (optional) */
  readonly hostedZoneId?: string;

  /** Route53 hosted zone name (required if hostedZoneId is provided) */
  readonly hostedZoneName?: string;

  /** Whether to enable termination protection on the edge stack (default: false) */
  readonly terminationProtection?: boolean;

  /** DynamoDB item table ARN (regional) used by blob-authorizer */
  readonly itemTableArn: string;

  /** DynamoDB config table ARN (regional) used by blob-authorizer */
  readonly configTableArn: string;

  /** DynamoDB auth key store table ARN (regional) used by blob-authorizer */
  readonly authKeyStoreTableArn: string;

  /** Product/stack version used for tagging edge resources. */
  readonly productVersion: string;

  /** Optional deployer label used for tagging (default: 'cfn'). */
  readonly deployer?: 'cdk' | 'cfn' | 'marketplace';
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

  /** Exposes the raw output map (access via getOutput). */
  private readonly resource: CustomResource;

  constructor(scope: Construct, id: string, props: MailboxEdgeDeployerProps) {
    super(scope, id);

    const stack = Stack.of(this);

    // IMPORTANT: use the *deployed* CloudFormation stack name, not the CDK logical stack id.
    // This ensures the synthesized template behaves correctly when deployed via pure CloudFormation.
    const edgeStackName = `${Aws.STACK_NAME}-edge`;
    const edgeStackArn = stack.formatArn({
      service: 'cloudformation',
      region: 'us-east-1',
      resource: 'stack',
      resourceName: `${edgeStackName}/*`,
    });

    // Worker Lambda, Step Functions workflow, and Starter Lambda wiring.
    const infra = new StackDeployerInfra(this, 'infra', {
      artifactResolver: props.artifactResolver,
      stateMachineNamePrefix: 'mailbox-edge-deployer-',
    });

    const templateUrl = props.artifactResolver.getUrl('mailbox-cdk-edge', 'edge-stack-template.json', 'us-east-1');

    grantEdgeDeployerWorkerPermissions(infra.worker, {
      stack,
      edgeStackArn,
      rootStack: Aws.STACK_NAME,
      templateObjectArn: props.artifactResolver.getArn('mailbox-cdk-edge', 'edge-stack-template.json', 'us-east-1'),
      artifactObjectArns: [
        props.artifactResolver.getArn('mailbox-cdk-edge', 'lambdas/blob-authorizer.zip', 'us-east-1'),
      ],
    });

    // Build CloudFormation parameters from the edge construct props
    const blobAuthorizerResolved = props.artifactResolver.resolve('mailbox-cdk-edge', 'lambdas/blob-authorizer.zip', 'us-east-1');

    const deployer = props.deployer ?? 'cfn';

    const cfnParameters: Record<string, string> = {
      domainName: props.domainName,
      artifactBucket: blobAuthorizerResolved.bucket,
      blobAuthorizerKey: blobAuthorizerResolved.key,
      itemTableArn: props.itemTableArn,
      configTableArn: props.configTableArn,
      authKeyStoreTableArn: props.authKeyStoreTableArn,

      // Tagging/back-reference parameters (consumed by the edge stack template).
      // Keys MUST match the edge stack's CfnParameter overrideLogicalId (rootStack / rootRegion).
      rootStack: Aws.STACK_NAME,
      rootRegion: Stack.of(this).region,
      productVersion: props.productVersion,
      deployer: deployer,
      blobAuthorizerS3VersionId: blobAuthorizerResolved.versionId ?? '',
    };

    // Edge template expects a dot-wrapped prefix: "." for no prefix, or ".{label}.".
    // Props.prefix may be either:
    // - A bare label (e.g., "mailbox") — normalize to dot-wrapped form
    // - An unresolved CDK token (e.g., from Fn.conditionIf) — pass through as-is
    // - Already dot-wrapped (e.g., ".mailbox.") — pass through as-is
    // IMPORTANT: Check Token.isUnresolved BEFORE calling .trim(), which would resolve the token.
    if (Token.isUnresolved(props.prefix)) {
      // Unresolved token (e.g., Fn.conditionIf) — pass through as-is
      cfnParameters.prefix = props.prefix as string;
    } else {
      // Resolved string — normalize
      const rawPrefix = (props.prefix ?? '').trim();
      const normalizedPrefixLabel = rawPrefix.replace(/^\.+/, '').replace(/\.+$/, '');
      cfnParameters.prefix = normalizedPrefixLabel ? `.${normalizedPrefixLabel}.` : '.';
    }

    if (props.hostedZoneId && props.hostedZoneName) {
      cfnParameters.hostedZoneId = props.hostedZoneId;
      cfnParameters.hostedZoneName = props.hostedZoneName;
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

    // Import edge stack outputs as strongly typed CDK interfaces.
    this.blobAuthorizerVersion = lambda.Version.fromVersionArn(
      this,
      'blob-authorizer-version',
      this.getOutput('blobAuthorizerVersionArn'),
    );

    const hasHostedZone = Boolean(props.hostedZoneId && props.hostedZoneName);
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
