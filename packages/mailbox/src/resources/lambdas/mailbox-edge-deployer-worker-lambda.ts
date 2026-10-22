import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import {
  DeployerWorkerLambda,
  ServerlessInboxTagKeys,
  rootStackRequestTagConditions,
  rootStackResourceTagConditions,
} from '@serverlessinbox/mailbox-cdk-shared';
import type { RootStack }        from '@serverlessinbox/mailbox-cdk-shared';
import { PolicyStatement }       from 'aws-cdk-lib/aws-iam';
import { ArnFormat, Aws, Stack } from 'aws-cdk-lib';
import { Construct }             from 'constructs';

export interface MailboxEdgeDeployerWorkerLambdaProps {
  readonly artifactResolver: IArtifactResolver;
  readonly stack:            Stack;
  /**
   * Wildcard over the names the edge stack has had (`${AWS::StackName}-edge*`). Scopes the grants on the
   * stack's Lambda functions and resource group, which are named after the stack.
   */
  readonly edgeStackNamePattern: string;
  /** ARN pattern of the edge stack, built from the same `edgeStackNamePattern`. */
  readonly edgeStackArn: string;
  readonly rootStack:    string;
  /** The guid of the root stack, tagged as `serverless-inbox:root-stack-id`. */
  readonly rootStackId:       string;
  readonly templateObjectArn: string;
  /** Additional S3 object ARNs (e.g. Lambda zip files) that CloudFormation needs to read during stack deployment. */
  readonly artifactObjectArns: string[];
  /** Route53 hosted zone used for the edge certificate's DNS validation (omit when no hosted zone is configured). */
  readonly hostedZoneId?: string;
  /** ARN of the jmap-blob-download Lambda@Edge execution role (created in root stack) */
  readonly jmapBlobDownloadRoleArn: string;
}

/**
 * Worker Lambda that deploys the edge stack via CloudFormation in us-east-1.
 *
 * CloudFormation (called without a RoleArn) uses the CALLER's permissions to create/update/delete
 * every resource in the template, so this role needs create/delete rights for exactly the resource
 * types the edge template contains: an ACM certificate, one Lambda function + version, and a resource
 * group. The execution role of the Lambda function is created outside the edge stack, so the worker
 * only needs iam:PassRole on that one role.
 *
 * Scoping strategy: CFN-generated physical NAMES for Lambda functions are truncated to 64 chars for
 * long stack names, so name-prefix ARN patterns break. Lambda mutations carry a tag-condition fallback
 * keyed on the `serverless-inbox:root-stack-id` tag that the edge template applies to the function, with
 * the `root-stack` name as the fallback for a function that has no id tag.
 *
 * The edge template contains no CloudWatch Log Groups, so this worker needs NO logs permissions.
 */
export class MailboxEdgeDeployerWorkerLambda extends DeployerWorkerLambda {
  constructor(scope: Construct, id: string, props: MailboxEdgeDeployerWorkerLambdaProps) {
    super(scope, id, {
      artifactResolver:  props.artifactResolver,
      deployedStackName: 'edge',
    });

    // Grants inherited from the shared deployer worker
    this.grantStackLifecycle(props.edgeStackArn);
    this.grantArtifactRead([props.templateObjectArn, ...props.artifactObjectArns]);
    this.grantTaggingApi([ServerlessInboxTagKeys.edge, ServerlessInboxTagKeys.rootRegion]);

    // Grants for the resources of the edge stack
    const rootStack: RootStack = { name: props.rootStack, id: props.rootStackId };
    this.grantCertificateLifecycle(props.stack, rootStack);
    this.grantLambdaFunctionLifecycle(props.stack, props.edgeStackNamePattern, rootStack);
    this.grantExecutionRolePassage(props.jmapBlobDownloadRoleArn);
    this.grantResourceGroupLifecycle(props.stack, props.edgeStackNamePattern);

    if (props.hostedZoneId !== undefined) {
      this.grantDnsValidationAccess(props.hostedZoneId);
    }
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
  private grantCertificateLifecycle(stack: Stack, rootStack: RootStack): void {
    const certificateArnPrefix = stack.formatArn({
      service:      'acm',
      region:       'us-east-1',
      resource:     'certificate',
      resourceName: '*',
    });
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   [
          'acm:RequestCertificate',
        ],
        resources: [certificateArnPrefix],
      })
    );
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   [
          'acm:DescribeCertificate',
          'acm:ListTagsForCertificate',
        ],
        resources: [certificateArnPrefix],
      })
    );
    for (const conditions of rootStackRequestTagConditions(rootStack)) {
      this.addToRolePolicy(
        new PolicyStatement({
          actions:   ['acm:AddTagsToCertificate'],
          resources: [certificateArnPrefix],
          conditions,
        })
      );
    }
    for (const conditions of rootStackResourceTagConditions(rootStack)) {
      this.addToRolePolicy(
        new PolicyStatement({
          actions:   ['acm:AddTagsToCertificate'],
          resources: [certificateArnPrefix],
          conditions,
        })
      );
      this.addToRolePolicy(
        new PolicyStatement({
          actions:   ['acm:RemoveTagsFromCertificate'],
          resources: [certificateArnPrefix],
          conditions,
        })
      );
      this.addToRolePolicy(
        new PolicyStatement({
          actions:   ['acm:DeleteCertificate'],
          resources: [certificateArnPrefix],
          conditions,
        })
      );
    }
  }

  /**
   * Lambda function ARNs use a COLON separator (`:function:name`), so ArnFormat.COLON_RESOURCE_NAME is
   * required; the slash form silently matches nothing.
   *
   * The same actions are granted three ways: on the function ARN prefix, on `*` with a function-name
   * condition (CreateFunction evaluates against `*` with the name in the request context), and on `*` with
   * the root-stack tag condition. The tag-scoped statement is the one that survives name truncation: the
   * CFN-generated function name is cut to 64 chars for long stack names, which breaks both name-prefix
   * patterns. lambda:TagResource/UntagResource carry no aws:TagKeys constraint because they act on functions
   * already scoped by the root-stack tag; the Resource Groups Tagging API is the one constrained by
   * aws:TagKeys.
   */
  private grantLambdaFunctionLifecycle(stack: Stack, edgeStackNamePattern: string, rootStack: RootStack): void {
    const edgeLambdaActions   = [
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
      service:      'lambda',
      region:       'us-east-1',
      resource:     'function',
      resourceName: edgeStackNamePattern,
      arnFormat:    ArnFormat.COLON_RESOURCE_NAME,
    });
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   edgeLambdaActions,
        resources: [edgeLambdaArnPrefix],
      })
    );
    this.addToRolePolicy(
      new PolicyStatement({
        actions:    edgeLambdaActions,
        resources:  ['*'],
        conditions: {
          StringLike: {
            'lambda:FunctionName': edgeStackNamePattern,
          },
        },
      })
    );
    for (const conditions of rootStackResourceTagConditions(rootStack)) {
      this.addToRolePolicy(
        new PolicyStatement({
          actions:   [
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
          conditions,
        })
      );
    }
  }

  /** Gated to the Lambda services, so the role cannot be passed to any other service. */
  private grantExecutionRolePassage(jmapBlobDownloadRoleArn: string): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions:    ['iam:PassRole'],
        resources:  [jmapBlobDownloadRoleArn],
        conditions: {
          StringEquals: {
            'iam:PassedToService': ['lambda.amazonaws.com', 'edgelambda.amazonaws.com'],
          },
        },
      })
    );
  }

  /**
   * AWS Resource Groups service actions (distinct from the tag:* Resource Groups Tagging API). The edge
   * template creates one group named `<edge-stack-name>-serverless-inbox`, so everything except CreateGroup
   * is scoped to it. CreateGroup stays on `*`: group-ARN scoping for it is unverified, and a wrongly scoped
   * create fails the whole edge deployment.
   */
  private grantResourceGroupLifecycle(stack: Stack, edgeStackNamePattern: string): void {
    const edgeResourceGroupArn = stack.formatArn({
      service:      'resource-groups',
      region:       'us-east-1',
      resource:     'group',
      resourceName: `${edgeStackNamePattern}-serverless-inbox`,
    });
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   ['resource-groups:CreateGroup'],
        resources: ['*'],
      })
    );
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   [
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

  /** Route53 record writes for the certificate's DNS validation. GetChange ARNs are random ids and cannot be scoped further. */
  private grantDnsValidationAccess(hostedZoneId: string): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   [
          'route53:ChangeResourceRecordSets',
          'route53:ListResourceRecordSets',
        ],
        resources: [`arn:${Aws.PARTITION}:route53:::hostedzone/${hostedZoneId}`],
      })
    );
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   ['route53:GetChange'],
        resources: [`arn:${Aws.PARTITION}:route53:::change/*`],
      })
    );
  }
}
