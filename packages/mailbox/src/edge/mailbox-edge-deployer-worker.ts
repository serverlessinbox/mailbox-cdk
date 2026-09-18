import { ArnFormat, Aws, Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import {
  DeployerWorkerLambda,
  rootStackRequestTagCondition,
  rootStackResourceTagCondition,
} from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';

export interface MailboxEdgeDeployerWorkerProps {
  readonly artifactResolver: ICdkArtifactEngine;
  readonly stack: Stack;
  /** Deployed CloudFormation stack name of the edge stack (`${AWS::StackName}-edge`). */
  readonly edgeStackName: string;
  readonly edgeStackArn: string;
  readonly rootStack: string;
  readonly templateObjectArn: string;
  /** Additional S3 object ARNs (e.g. Lambda zip files) that CloudFormation needs to read during stack deployment. */
  readonly artifactObjectArns: string[];
  /** Route53 hosted zone used for the edge certificate's DNS validation (omit when no hosted zone is configured). */
  readonly hostedZoneId?: string;
}

/**
 * Worker Lambda that deploys the edge stack via CloudFormation in us-east-1.
 *
 * CloudFormation (called without a RoleArn) uses the CALLER's permissions to create/update/delete
 * every resource in the template, so this role needs create/delete rights for exactly the resource
 * types the edge template contains: an ACM certificate, one IAM role (+ inline policy + managed
 * policy attachment), one Lambda function + version, and a resource group. Keep this list in
 * lockstep with the edge template — a new resource type there needs a scoped grant here.
 *
 * Scoping strategy: CFN-generated physical NAMES are truncated to the service's length limit
 * (64 chars for IAM roles and Lambda functions), so name-prefix ARN patterns break for long stack
 * names. The IAM role is therefore scoped by its deterministic PATH (never truncated), and Lambda
 * mutations carry a tag-condition fallback keyed on the `serverless-inbox:root-stack` tag that the
 * edge template applies to the function.
 *
 * The edge template contains no CloudWatch Log Groups, so this worker needs NO logs permissions
 * (its own logging comes from its execution role's basic policy). If a log group is ever added to
 * the edge template, grant logs actions here scoped to `log-group:<edge-stack-name>*`.
 */
export class MailboxEdgeDeployerWorker extends DeployerWorkerLambda {
  constructor(scope: Construct, id: string, props: MailboxEdgeDeployerWorkerProps) {
    super(scope, id, {
      artifactResolver: props.artifactResolver,
      serviceName: 'stack-deployer-edge-worker',
    });

    this.grantStackLifecycle(props.edgeStackArn);
    this.grantTemplateAndArtifactRead(props.templateObjectArn, props.artifactObjectArns);
    this.grantCertificateLifecycle(props.stack, props.rootStack);
    this.grantLambdaFunctionLifecycle(props.stack, props.edgeStackName, props.rootStack);
    this.grantExecutionRoleLifecycle(props.stack, props.edgeStackName);
    this.grantTaggingApiAccess();
    this.grantResourceGroupLifecycle(props.stack, props.edgeStackName);

    if (props.hostedZoneId !== undefined) {
      this.grantDnsValidationAccess(props.hostedZoneId);
    }
  }

  private grantStackLifecycle(edgeStackArn: string): void {
    // Allow the deployer to manage CloudFormation stacks in us-east-1
    this.addToRolePolicy(
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
  }

  private grantTemplateAndArtifactRead(templateObjectArn: string, artifactObjectArns: string[]): void {
    // Allow reading the edge stack template and ALL Lambda artifact zips from S3.
    // CloudFormation uses the CALLER's identity (this worker role) to fetch Lambda zip files
    // when creating AWS::Lambda::Function resources — individual object ARNs are not sufficient.
    // Edge artifacts are always in the us-east-1 artifact bucket regardless of regional stack.
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          's3:GetObject',
          's3:GetObjectVersion',
        ],
        resources: [templateObjectArn, ...artifactObjectArns],
      })
    );
  }

  /**
   * ACM certificate lifecycle. Certificate ARNs are random UUIDs, so only the account/region can
   * be pinned. Scoping strategy prevents tagging-based escalation:
   * - RequestCertificate is granted unconditionally on the region+account ARN prefix. CloudFormation
   *   creates ACM certificates untagged, then applies tags via a separate AddTagsToCertificate call,
   *   so aws:RequestTag is never satisfied on RequestCertificate in the CFN path. Scope by region+account
   *   instead. Low risk: RequestCertificate only creates new certs (random ARNs), cannot read/modify/delete
   *   existing certs.
   * - AddTagsToCertificate: split into two statements (see below). RequestTag covers the CREATE path;
   *   ResourceTag covers the UPDATE path. On CREATE, CloudFormation tags the untagged cert with root-stack.
   *   On UPDATE, CloudFormation sends only changed tags (root-stack may be absent), so ResourceTag is needed
   *   to match the already-tagged cert. Together they block escalation via tagging foreign certs into scope.
   * - RemoveTagsFromCertificate is gated by aws:ResourceTag so only already-owned certs can be untagged.
   * - DeleteCertificate is gated by aws:ResourceTag as the final ownership check.
   */
  private grantCertificateLifecycle(stack: Stack, rootStack: string): void {
    const certificateArnPrefix = stack.formatArn({
      service: 'acm',
      region: 'us-east-1',
      resource: 'certificate',
      resourceName: '*',
    });
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'acm:RequestCertificate',
        ],
        resources: [certificateArnPrefix],
      })
    );
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'acm:DescribeCertificate',
          'acm:ListTagsForCertificate',
        ],
        resources: [certificateArnPrefix],
      })
    );
    // AddTags on CREATE: CloudFormation tags the initially-untagged cert, so root-stack is in the request.
    // aws:RequestTag gates to only the CREATE path.
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'acm:AddTagsToCertificate',
        ],
        resources: [certificateArnPrefix],
        conditions: {
          StringEquals: rootStackRequestTagCondition(rootStack),
        },
      })
    );
    // AddTags on an UPDATE: CloudFormation sends only changed tags, so root-stack may be absent from the
    // request (aws:RequestTag above won't match) — but the cert already exists and carries the root-stack
    // tag from creation, so aws:ResourceTag links it. Union of the two covers create + update.
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['acm:AddTagsToCertificate'],
        resources: [certificateArnPrefix],
        conditions: {
          StringEquals: rootStackResourceTagCondition(rootStack),
        },
      })
    );
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'acm:RemoveTagsFromCertificate',
        ],
        resources: [certificateArnPrefix],
        conditions: {
          StringEquals: rootStackResourceTagCondition(rootStack),
        },
      })
    );
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['acm:DeleteCertificate'],
        resources: [certificateArnPrefix],
        conditions: {
          StringEquals: rootStackResourceTagCondition(rootStack),
        },
      })
    );
  }

  private grantLambdaFunctionLifecycle(stack: Stack, edgeStackName: string, rootStack: string): void {
    // Lambda function + version lifecycle. NOTE: Lambda function ARNs use a COLON separator
    // (`:function:name`), so ArnFormat.COLON_RESOURCE_NAME is required — the slash form silently
    // matches nothing.
    const edgeLambdaActions = [
      'lambda:CreateFunction',
      'lambda:DeleteFunction',
      'lambda:UpdateFunctionCode',
      'lambda:UpdateFunctionConfiguration',
      'lambda:GetFunction',
      'lambda:ListVersionsByFunction',
      'lambda:PublishVersion',
      'lambda:TagResource',
      'lambda:UntagResource',
    ];
    const edgeLambdaArnPrefix = stack.formatArn({
      service: 'lambda',
      region: 'us-east-1',
      resource: 'function',
      resourceName: `${edgeStackName}-*`,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });
    this.addToRolePolicy(
      new PolicyStatement({
        actions: edgeLambdaActions,
        resources: [edgeLambdaArnPrefix],
      })
    );
    // Same grant expressed as a function-name condition. Some Lambda authorization paths (notably
    // CreateFunction) evaluate against resource "*" with the name in the request context.
    this.addToRolePolicy(
      new PolicyStatement({
        actions: edgeLambdaActions,
        resources: ['*'],
        conditions: {
          StringLike: {
            'lambda:FunctionName': `${edgeStackName}-*`,
          },
        },
      })
    );
    // Tag-scoped fallback for post-create operations: the CFN-generated function name is truncated
    // to 64 chars for long stack names, breaking both name-prefix patterns above. The root-stack tag
    // applied by the edge template is immune to truncation and keeps updates/deletion working.
    // TagResource/UntagResource are not further constrained by aws:TagKeys because the set of tags
    // applied by the edge stack is broad (product, version, deployer, component, edge, root-region,
    // artifact metadata — 12+ tags) and may grow; a hard-coded allowlist would become stale and break
    // future deployments. This accepts a residual risk that the worker could modify any tag on the
    // Lambda, but such modifications would be observable in CloudTrail/resource inventory and
    // are scoped to resources already owned by this deployment (root-stack condition).
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'lambda:DeleteFunction',
          'lambda:UpdateFunctionCode',
          'lambda:UpdateFunctionConfiguration',
          'lambda:GetFunction',
          'lambda:ListVersionsByFunction',
          'lambda:PublishVersion',
          'lambda:TagResource',
          'lambda:UntagResource',
        ],
        resources: ['*'],
        conditions: {
          StringEquals: rootStackResourceTagCondition(rootStack),
        },
      })
    );
  }

  private grantExecutionRoleLifecycle(stack: Stack, edgeStackName: string): void {
    // The edge template's single IAM role (blob-authorizer execution role) is scoped by name-prefix
    // `<edge-stack-name>-*` (see mailbox-edge-construct.ts). This pattern covers the CFN-generated
    // role name and avoids path-based scoping that would break existing deployments already created
    // with the default path. Known caveat: a very long root-stack name could truncate the role name
    // past IAM's 64-char limit; a deliberate path-based migration is the future fix.
    const edgeRoleArnPrefix = stack.formatArn({
      service: 'iam',
      region: '',
      // IAM is global (no region), but ARNs are account-scoped.
      account: stack.account,
      resource: 'role',
      resourceName: `${edgeStackName}-*`,
    });
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'iam:CreateRole',
          'iam:DeleteRole',
          'iam:TagRole',
          'iam:UntagRole',
          'iam:PutRolePolicy',
          'iam:GetRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:DetachRolePolicy',
          'iam:GetRole',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
        ],
        resources: [edgeRoleArnPrefix],
      })
    );
    // iam:PassRole is scoped to the same role path but additionally gated to only Lambda services
    // to prevent passing the role to other services or to unauthorized principals.
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [edgeRoleArnPrefix],
        conditions: {
          StringEquals: {
            'iam:PassedToService': ['lambda.amazonaws.com', 'edgelambda.amazonaws.com'],
          },
        },
      })
    );
    // iam:AttachRolePolicy is scoped to the role path but additionally gated to only the managed
    // policy that CloudFormation applies to Lambda execution roles, preventing privilege escalation
    // via unrestricted policy attachment.
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['iam:AttachRolePolicy'],
        resources: [edgeRoleArnPrefix],
        conditions: {
          StringEquals: {
            'iam:PolicyARN': 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          },
        },
      })
    );
  }

  private grantTaggingApiAccess(): void {
    // Some CloudFormation resources use the Resource Groups Tagging API behind the scenes.
    // Grant it broadly; the individual service actions above remain scoped.
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'tag:GetResources',
          'tag:TagResources',
          'tag:UntagResources',
        ],
        resources: ['*'],
      })
    );
  }

  private grantResourceGroupLifecycle(stack: Stack, edgeStackName: string): void {
    // AWS Resource Groups SERVICE actions (distinct from the tag:* Resource Groups Tagging API above).
    // The edge template creates one group with the deterministic name
    // `<edge-stack-name>-serverless-inbox` (see utils/resource-group.ts), so everything except
    // CreateGroup is scoped to it. CreateGroup stays on "*" — group-ARN scoping for it is unverified
    // and a wrongly-scoped create fails the whole edge deployment.
    const edgeResourceGroupArn = stack.formatArn({
      service: 'resource-groups',
      region: 'us-east-1',
      resource: 'group',
      resourceName: `${edgeStackName}-serverless-inbox`,
    });
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['resource-groups:CreateGroup'],
        resources: ['*'],
      })
    );
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'resource-groups:DeleteGroup',
          'resource-groups:GetGroup',
          'resource-groups:GetGroupQuery',
          'resource-groups:GetGroupConfiguration',
          'resource-groups:UpdateGroup',
          'resource-groups:UpdateGroupQuery',
          'resource-groups:Tag',
          'resource-groups:Untag',
          'resource-groups:GetTags',
        ],
        resources: [edgeResourceGroupArn],
      })
    );
  }

  private grantDnsValidationAccess(hostedZoneId: string): void {
    // Route53 record writes for the certificate's DNS validation. Only needed (and only granted)
    // when a hosted zone is configured — without one, the certificate resource is conditioned out
    // of the edge stack. GetChange ARNs are random ids and cannot be scoped further.
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'route53:ChangeResourceRecordSets',
          'route53:ListResourceRecordSets',
        ],
        resources: [`arn:${Aws.PARTITION}:route53:::hostedzone/${hostedZoneId}`],
      })
    );
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['route53:GetChange'],
        resources: [`arn:${Aws.PARTITION}:route53:::change/*`],
      })
    );
  }
}
