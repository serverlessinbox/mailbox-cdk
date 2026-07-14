import * as cdk from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { CdkArtifactEngine, PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
import * as iam from 'aws-cdk-lib/aws-iam';
import { buildArtifactKey, buildReleasePointerKey, buildArtifactUrl, buildArtifactBucketName } from '@serverlessinbox/artifact-registry';

import { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider } from '../api/addons';
import { UpdateApiLambda } from '../lambdas/update-api';

/**
 * Props for constructing an UpdateAddon directly (internal use).
 * Not exported; users should use UpdateAddonProvider instead.
 */
export interface UpdateAddonProps {
  /** DynamoDB table for configuration. */
  readonly configTable: ITable;

  /** SQS queue for audit events (shared HTTP registry audit path). */
  readonly auditEventsQueue: IQueue;

  /** Optional base path for mount routes; defaults to `/update`. */
  readonly basePath?: string;

  /** Template artifact name (e.g., 'mailbox-standard'). */
  readonly templateName: string;

  /** Template version string (e.g., 'v0.0.53' or '0.0.0-dev'). */
  readonly templateVersion: string;

  /** Distribution tag (release line); defaults to 'stable'. */
  readonly distTag?: string;
}

/**
 * Admin API addon for human-gated CloudFormation ChangeSet operations.
 *
 * Mounts the update-api Lambda on the Admin API with its own execution role
 * that has CloudFormation ChangeSet permissions.
 *
 * Contributes { update: { available: true } } to the admin UI config.
 *
 * Implements IAdminApiAddon.
 */
export class UpdateAddon extends Construct implements IAdminApiAddon {
  public readonly basePath: string;
  public uiConfig?: Record<string, unknown>;

  private readonly _lambdaConstruct: UpdateApiLambda;

  constructor(scope: Construct, id: string, props: UpdateAddonProps) {
    super(scope, id);

    this.basePath = props.basePath ?? '/update';
    this.uiConfig = {
      update: {
        available: true,
      },
    };

    const rootStackArn = cdk.Stack.of(this).stackId;
    const stack = cdk.Stack.of(this);
    const stackName = stack.stackName;
    const region = stack.region;

    // Self-load the artifact engine using the established cognito pattern
    const resolver = PinnedResolver.loadFromArtifactMetadata(this);
    const artifactEngine = new CdkArtifactEngine(this, resolver);
    const artifactBucketBase = artifactEngine.getBucketBase();

    // Build release pointer key and URL template using artifact-registry functions
    const pointerKey = buildReleasePointerKey('template', props.templateName, {
      distTag: props.distTag ?? 'stable',
    });
    const pointerBucket = buildArtifactBucketName(artifactBucketBase, region);

    // Build template URL template with placeholders for version and objectName
    const templateUrlTemplate = buildArtifactUrl(
      pointerBucket,
      region,
      buildArtifactKey('template', props.templateName, { type: 'release-template' }),
    );

    // Create SSM StringParameter for template version.
    // This resource is rendered into the CloudFormation template and survives quick-create deploys.
    const templateVersionParam = new ssm.StringParameter(this, 'template-version', {
      stringValue: props.templateVersion,
      tier: ssm.ParameterTier.STANDARD,
    });

    // Create the update-api Lambda with its own role and CFN permissions.
    this._lambdaConstruct = new UpdateApiLambda(this, 'lambda', {
      rootStackArn,
      configTable: props.configTable,
      artifactBucketBase,
      artifactResolver: artifactEngine,
      templateVersionParamName: templateVersionParam.parameterName,
      pointerBucket,
      pointerKey,
      templateUrlTemplate,
      auditEventsQueue: props.auditEventsQueue,
      distTag: props.distTag,
    });

    // Grant the Lambda read access to the template-version parameter.
    templateVersionParam.grantRead(this._lambdaConstruct);

    // Create CloudFormation execution role for ChangeSet operations.
    // Trust policy: CloudFormation service principal only. CloudFormation does not populate
    // aws:SourceArn or aws:SourceAccount in the STS:AssumeRole call for roles passed via
    // CreateChangeSet RoleARN (unlike registry extensions or StackSets admin roles), so a
    // confused-deputy condition would be unsatisfiable and break all self-updates. Residual
    // risk is bounded: iam:PassRole on this role is granted only to the update-api Lambda,
    // and its CreateChangeSet operations are scoped to the single root-stack ARN.
    //
    // This role is intentionally broad (no permissions boundary) for now. A permissions boundary
    // confining it is deferred as a separate hardening workitem (stack-self-update boundary
    // hardening). This matches CDK's own bootstrap cfn-exec-role pattern: broad, gated by who can
    // assume/pass it (here only the update-api Lambda, scoped to the one stack ARN).
    const cfnExecRole = new iam.Role(this, 'cfn-exec-role', {
      roleName: `${stackName}-cfn-exec-role`,
      assumedBy: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
      description: 'CloudFormation execution role for stack self-update via ChangeSet API',
    });

    // Add identity policy grants to the role.
    // These are the permissions that allow CloudFormation to manage the stack.
    cfnExecRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'StackResourceServices',
        effect: iam.Effect.ALLOW,
        actions: [
          'lambda:*',
          'dynamodb:*',
          's3:*',
          'sqs:*',
          'ses:*',
          'cognito-idp:*',
          'cloudfront:*',
          'apigateway:*',
          'logs:*',
          'events:*',
          'acm:*',
          'route53:*',
          'states:*',
          'ssm:PutParameter',
          'ssm:DeleteParameter',
          'ssm:GetParameter',
          'ssm:GetParameters',
          'ssm:AddTagsToResource',
          'ssm:RemoveTagsFromResource',
          'ssm:ListTagsForResource',
        ],
        resources: ['*'],
      })
    );

    cfnExecRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'IamForChildRolesAndPolicies',
        effect: iam.Effect.ALLOW,
        actions: [
          'iam:CreateRole',
          'iam:DeleteRole',
          'iam:UpdateRole',
          'iam:UpdateAssumeRolePolicy',
          'iam:TagRole',
          'iam:UntagRole',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:CreatePolicy',
          'iam:DeletePolicy',
          'iam:CreatePolicyVersion',
          'iam:DeletePolicyVersion',
          'iam:SetDefaultPolicyVersion',
          'iam:TagPolicy',
          'iam:UntagPolicy',
          'iam:PassRole',
          'iam:CreateServiceLinkedRole',
          'iam:GetRole',
          'iam:GetPolicy',
          'iam:GetPolicyVersion',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
        ],
        resources: ['*'],
      })
    );

    cfnExecRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SelfStackCfnMeta',
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplate',
        ],
        resources: ['*'],
      })
    );

    // Pass role ARN to the Lambda via environment variable and grant PassRole
    this._lambdaConstruct.addEnvironment('CFN_EXECUTION_ROLE_ARN', cfnExecRole.roleArn);
    if (this._lambdaConstruct.role) {
      this._lambdaConstruct.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['iam:PassRole'],
          resources: [cfnExecRole.roleArn],
        })
      );
    }
  }

  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void {
    api.addRoutes({
      path: `${this.basePath}/{proxy+}`,
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('update', this._lambdaConstruct),
      authorizer,
    });
  }
}

/**
 * Props for constructing UpdateAddonProvider.
 */
export interface UpdateAddonProviderProps {
  /** Template artifact name (e.g., 'mailbox-standard'). */
  readonly templateName: string;

  /** Template version string (e.g., 'v0.0.53' or '0.0.0-dev'). */
  readonly templateVersion: string;

  /** Distribution tag (release line); defaults to 'stable'. */
  readonly distTag?: string;
}

/**
 * Provider for the Update addon. Pass this to Mailbox's adminApiAddonProviders
 * to enable human-gated CloudFormation ChangeSet operations in the Admin API.
 */
export class UpdateAddonProvider implements IAdminApiAddonProvider {
  constructor(private readonly props: UpdateAddonProviderProps) {}

  createAdminApiAddons(scope: Construct, ctx: AdminApiAddonContext): IAdminApiAddon[] {
    return [
      new UpdateAddon(scope, 'update-addon', {
        configTable: ctx.configTable,
        auditEventsQueue: ctx.auditEventsQueue,
        templateName: this.props.templateName,
        templateVersion: this.props.templateVersion,
        distTag: this.props.distTag,
      }),
    ];
  }
}
