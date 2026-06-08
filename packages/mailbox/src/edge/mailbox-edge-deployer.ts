import { Aws, CustomResource, Duration, Fn, Stack } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { TypeScriptLambda } from '../utils/ts-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { MailboxEdgeDeployerWorkflow } from './mailbox-edge-deployer-workflow';

export interface MailboxEdgeDeployerProps {
  /**
   * Artifact resolver for loading Lambda code and artifact locations from S3
   */
  readonly artifactResolver: IArtifactResolver;

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

  /** Optional product/stack version used for tagging edge resources. */
  readonly productVersion?: string;

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
    const edgeStackName = `${Aws.STACK_NAME}-edge-stack`;
    const edgeStackArn = stack.formatArn({
      service: 'cloudformation',
      region: 'us-east-1',
      resource: 'stack',
      resourceName: `${edgeStackName}/*`,
    });

    // CloudFormation (when called without a RoleArn) uses the caller's permissions to create/delete
    // resources. Since the edge template creates CloudWatch Log Groups with RemovalPolicy.DESTROY,
    // the deployer needs explicit permissions to delete those log groups during stack deletion.
    const edgeLogGroupArnPrefix = stack.formatArn({
      service: 'logs',
      region: 'us-east-1',
      resource: 'log-group',
      // CDK-generated LogGroup names are prefixed with the stack name.
      resourceName: `${edgeStackName}*`,
    });

    // IMPORTANT: CDK-generated physical names for resources created by the edge stack template
    // are typically prefixed with the *stack name* (AWS::StackName) plus the logical id.
    // Since our deployer itself runs in a regional stack, and we want a synthesized template to work
    // under pure CloudFormation too, scope permissions using AWS::StackName rather than a hard-coded prefix.
    const edgeLambdaArnPrefix = stack.formatArn({
      service: 'lambda',
      region: 'us-east-1',
      resource: 'function',
      resourceName: `${Aws.STACK_NAME}-*`,
    });

    const edgeRoleArnPrefix = stack.formatArn({
      service: 'iam',
      region: '',
      // IAM is global (no region), but ARNs are account-scoped.
      account: stack.account,
      resource: 'role',
      resourceName: `${Aws.STACK_NAME}-*`,
    });

    // Worker Lambda: invoked by Step Functions to manage the us-east-1 edge stack and send CFN responses.
    // Uses the published artifact (no CDK bundling) to keep this deployable via pure CloudFormation.
    const worker = new TypeScriptLambda(this, 'worker', {
      lambdaId: 'edge-deployer',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      handler: 'index.workerHandler',
      timeout: Duration.minutes(15),
      memorySize: 512,
    });

    // Orchestrate long-running edge stack operations via Step Functions.
    // CFN triggers the Lambda once; the Lambda starts the state machine which invokes the same Lambda to poll.
    // State machine name must be <= 80 chars. CloudFormation stack names can be long (up to 128),
    // so derive a stable, per-stack short id from AWS::StackId instead.
    // StackId is an ARN like: arn:aws:cloudformation:region:acct:stack/stack-name/guid
    const stackGuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
    const stateMachineName = Fn.join('', ['MailboxEdgeDeployer-', stackGuid]);

    const workflow = new MailboxEdgeDeployerWorkflow(this, 'workflow', {
      handler: worker,
      checkInterval: Duration.seconds(20),
      timeout: Duration.minutes(90),
      stateMachineName,
    });

    // Starter Lambda: CFN custom resource entrypoint. It only starts the Step Functions execution.
    // Keeping this separate avoids a Lambda<->StateMachine circular dependency.
    const starter = new TypeScriptLambda(this, 'starter', {
      lambdaId: 'edge-deployer',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      handler: 'index.starterHandler',
      timeout: Duration.minutes(1),
      memorySize: 256,
    });

    starter.addEnvironment('MAILBOX_EDGE_DEPLOYER_STATE_MACHINE_ARN', workflow.stateMachine.stateMachineArn);

    // Starter needs StepFunctions to kick off long-running operations.
    starter.addToRolePolicy(
      new PolicyStatement({
        actions: ['states:StartExecution'],
        resources: [workflow.stateMachine.stateMachineArn],
      })
    );

    // Allow the deployer to manage CloudFormation stacks in us-east-1
    worker.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'cloudformation:CreateStack',
          'cloudformation:UpdateStack',
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplateSummary',
          'cloudformation:GetStackPolicy',
          'cloudformation:SetStackPolicy',
        ],
        resources: [edgeStackArn],
      })
    );

    // Allow reading the edge stack template and Lambda code from S3
    // The artifact resolver provides the bucket name and artifact paths
    // Edge artifacts are always in us-east-1 regardless of regional stack
    const templateUrl = props.artifactResolver.getUrl('mailbox-cdk-edge', 'edge-stack-template.json', 'us-east-1');

    worker.addToRolePolicy(
      new PolicyStatement({
        actions: [
          's3:GetObject',
          's3:GetObjectVersion',
        ],
        resources: [
          props.artifactResolver.getArn('mailbox-cdk-edge', 'edge-stack-template.json'),
          props.artifactResolver.getArn('mailbox-cdk-edge', 'lambdas/blob-authorizer.zip'),
        ],
      })
    );

    // CloudFormation needs these permissions to create the edge resources
    // These are granted to the handler so it can pass them to CloudFormation
    worker.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'acm:RequestCertificate',
          'acm:DescribeCertificate',
          'acm:DeleteCertificate',
          'acm:ListTagsForCertificate',
          'acm:AddTagsToCertificate',
        ],
        resources: ['arn:aws:acm:us-east-1:*:certificate/*'],
      })
    );

    worker.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'lambda:CreateFunction',
          'lambda:DeleteFunction',
          'lambda:UpdateFunctionCode',
          'lambda:UpdateFunctionConfiguration',
          'lambda:GetFunction',
          'lambda:ListVersionsByFunction',
          'lambda:PublishVersion',
          'lambda:AddPermission',
          'lambda:RemovePermission',
          'lambda:TagResource',
          'lambda:UntagResource',
        ],
        resources: [edgeLambdaArnPrefix],
      })
    );

    // Some Lambda APIs (notably CreateFunction) are evaluated against resource "*".
    // Keep this safe by constraining the allowed function name prefix.
    worker.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'lambda:CreateFunction',
          'lambda:DeleteFunction',
          'lambda:UpdateFunctionCode',
          'lambda:UpdateFunctionConfiguration',
          'lambda:GetFunction',
          'lambda:ListVersionsByFunction',
          'lambda:PublishVersion',
          'lambda:AddPermission',
          'lambda:RemovePermission',
          'lambda:TagResource',
          'lambda:UntagResource',
        ],
        resources: ['*'],
        conditions: {
          StringLike: {
            'lambda:FunctionName': `${Aws.STACK_NAME}-*`,
          },
        },
      })
    );

    worker.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'iam:PassRole',
          'iam:CreateRole',
          'iam:DeleteRole',
          'iam:TagRole',
          'iam:UntagRole',
          'iam:PutRolePolicy',
          'iam:GetRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:GetRole',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
        ],
        resources: [edgeRoleArnPrefix],
      })
    );

    // CreateRole is sometimes evaluated against resource "*" (not the role ARN) which would bypass
    // the ARN-scoped statement above. Allow it explicitly.
    worker.addToRolePolicy(
      new PolicyStatement({
        actions: ['iam:CreateRole'],
        resources: ['*'],
      })
    );

    // Some IAM tagging paths are also evaluated against resource "*".
    // Keep this safe by constraining the allowed role name prefix.
    worker.addToRolePolicy(
      new PolicyStatement({
        actions: ['iam:TagRole', 'iam:UntagRole'],
        resources: ['*'],
        conditions: {
          StringLike: {
            'iam:RoleName': `${Aws.STACK_NAME}-*`,
          },
        },
      })
    );

    // IAM CreateRole (and initial tagging) is commonly evaluated against resource "*".
    // Constrain by RoleName so CloudFormation can create stack-prefixed roles but nothing else.
    worker.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'iam:CreateRole',
          'iam:TagRole',
          'iam:UntagRole',
          'iam:PutRolePolicy',
          'iam:GetRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:GetRole',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
          'iam:DeleteRole',
        ],
        resources: ['*'],
        conditions: {
          StringLike: {
            'iam:RoleName': `${Aws.STACK_NAME}-*`,
          },
        },
      })
    );

    // Some CloudFormation resources use the Resource Groups Tagging API behind the scenes.
    // Grant it broadly; the individual service actions above remain scoped.
    worker.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'tag:GetResources',
          'tag:TagResources',
          'tag:UntagResources',
        ],
        resources: ['*'],
      })
    );

    worker.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'logs:DeleteLogGroup',
          'logs:PutRetentionPolicy',
          // CloudFormation uses TagResource/UntagResource when creating Log Groups with tags.
          'logs:TagResource',
          'logs:UntagResource',
          // Backwards-compatible explicit log-group tagging APIs.
          'logs:TagLogGroup',
          'logs:UntagLogGroup',
        ],
        resources: [
          edgeLogGroupArnPrefix,
          // Some APIs (and some error reporting paths) refer to the log-stream ARN shape.
          `${edgeLogGroupArnPrefix}:log-stream:*`,
          // Some IAM evaluations use an extra suffix segment.
          `${edgeLogGroupArnPrefix}:*`,
        ],
      })
    );

    // Some CloudWatch Logs tagging calls are evaluated against resource "*" (or against an ARN shape
    // that doesn't match our prefix), which manifests as a missing logs:TagResource permission.
    // Keep this narrowly scoped to tagging operations only.
    worker.addToRolePolicy(
      new PolicyStatement({
        actions: ['logs:TagResource', 'logs:UntagResource'],
        resources: ['*'],
      })
    );

    // CloudFormation rollback/delete has repeatedly evaluated DeleteLogGroup in ways that don't match
    // our intended ARN prefix (notably showing a log-stream-shaped ARN in the error message).
    // To stop manual cleanups, allow DeleteLogGroup broadly for this worker.
    worker.addToRolePolicy(
      new PolicyStatement({
        actions: ['logs:DeleteLogGroup'],
        resources: ['*'],
      })
    );

    // CreateLogGroup is typically evaluated against resource "*".
    worker.addToRolePolicy(
      new PolicyStatement({
        actions: ['logs:CreateLogGroup'],
        resources: ['*'],
      })
    );

    worker.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'route53:ChangeResourceRecordSets',
          'route53:ListResourceRecordSets',
          'route53:GetChange',
        ],
        resources: ['*'],
      })
    );

    // Build CloudFormation parameters from the edge construct props
    const blobAuthorizerKey = props.artifactResolver.getKey('mailbox-cdk-edge', 'lambdas/blob-authorizer.zip');
    const blobAuthorizerVersionId = props.artifactResolver.getVersionId('mailbox-cdk-edge', 'lambdas/blob-authorizer.zip');

    const deployer = props.deployer ?? 'cfn';

    const cfnParameters: Record<string, string> = {
      domainName: props.domainName,
      artifactBucket: 'mailbox-artifacts-us-east-1',
      blobAuthorizerKey: blobAuthorizerKey,
      itemTableArn: props.itemTableArn,
      configTableArn: props.configTableArn,
      authKeyStoreTableArn: props.authKeyStoreTableArn,

      // Tagging/back-reference parameters (consumed by the edge stack template)
      originDeployment: Aws.STACK_NAME,
      originRegion: Stack.of(this).region,
      productVersion: props.productVersion ?? 'unknown',
      deployer: deployer,
    };

    // Include version ID if available in artifact resolver
    if (blobAuthorizerVersionId) {
      cfnParameters.blobAuthorizerS3VersionId = blobAuthorizerVersionId;
    }

    // Edge template expects a dot-wrapped prefix: "." for no prefix, or ".{label}.".
    // Accept callers passing either raw label or dot-wrapped form and normalize.
    const rawPrefix = (props.prefix ?? '').trim();
    const normalizedPrefixLabel = rawPrefix.replace(/^\.+/, '').replace(/\.+$/, '');
    cfnParameters.prefix = normalizedPrefixLabel ? `.${normalizedPrefixLabel}.` : '.';

    if (props.hostedZoneId && props.hostedZoneName) {
      cfnParameters.hostedZoneId = props.hostedZoneId;
      cfnParameters.hostedZoneName = props.hostedZoneName;
    }

    this.resource = new CustomResource(this, 'resource', {
      serviceToken: starter.functionArn,
      resourceType: 'Custom::MailboxEdgeDeployer',
      properties: {
        stackName: edgeStackName,
        templateUrl,
        parameters: cfnParameters,
        terminationProtection: props.terminationProtection ?? false,
      },
    });

    // Ensure the workflow remains until after the custom resource is deleted.
    this.resource.node.addDependency(workflow.stateMachine);

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
