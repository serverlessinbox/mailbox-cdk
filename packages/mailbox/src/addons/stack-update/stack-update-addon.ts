import * as cdk from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import { CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { IDataTable } from '../../data/data-tables';
import type { IAuditEventsQueue } from '../../features/audit-writing/audit-events-queue';
import { buildArtifactKey, buildReleasePointerKey, buildArtifactUrl, buildArtifactBucketName } from '@serverlessinbox/artifact-registry';

import { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider } from '../../api/addons';
import type { IArtifactResolver } from '../../artifacts/i-artifact-resolver';
import { StackUpdateApiLambda } from '../../lambdas/stack-update-api';
import { TemplateVersionParam, type ITemplateVersionParam } from './template-version-param';

/**
 * Props for constructing a StackUpdateAddon directly (internal use).
 * Not exported; users should use StackUpdateAddonProvider instead.
 */
export interface StackUpdateAddonProps {
  /** DynamoDB table for configuration. */
  readonly configTable: IDataTable;

  /** SQS queue for audit events (shared HTTP registry audit path). */
  readonly auditEventsQueue: IAuditEventsQueue;

  /** Artifact resolver for resolving mailbox-go package. */
  readonly artifactResolver: IArtifactResolver;

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
 * Mounts the stack-update-api Lambda on the Admin API with its own execution role
 * that has CloudFormation ChangeSet permissions.
 *
 * Contributes { stackUpdate: { available: true } } to the admin UI config.
 *
 * Implements IAdminApiAddon.
 */
export class StackUpdateAddon extends Construct implements IAdminApiAddon {
  public uiConfig?: Record<string, unknown>;

  private readonly lambdaConstruct: StackUpdateApiLambda;
  public readonly templateVersionParamAccess: ITemplateVersionParam;

  constructor(scope: Construct, id: string, props: StackUpdateAddonProps) {
    super(scope, id);

    this.uiConfig = {
      stackUpdate: {
        available: true,
      },
    };

    const rootStackArn = cdk.Stack.of(this).stackId;
    const stack = cdk.Stack.of(this);
    const region = stack.region;

    const artifactEngine = new CdkArtifactEngine(this, props.artifactResolver);
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
    const templateVersionParamConstruct = new TemplateVersionParam(this, 'template-version', {
      templateVersion: props.templateVersion,
    });
    this.templateVersionParamAccess = templateVersionParamConstruct;
    const templateVersionParam = templateVersionParamConstruct.parameter;

    // Create the stack-update-api Lambda with its own role and CFN permissions.
    this.lambdaConstruct = new StackUpdateApiLambda(this, 'lambda', {
      rootStackArn,
      configTable: props.configTable,
      artifactBucketBase,
      artifactResolver: artifactEngine,
      templateVersionParamName: templateVersionParam.parameterName,
      pointerBucket,
      pointerKey,
      templateUrlTemplate,
      auditEventsQueue: props.auditEventsQueue,
    });

    // Grant the Lambda read access to the template-version parameter.
    templateVersionParam.grantRead(this.lambdaConstruct);
  }

  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void {
    api.addRoutes({
      path: '/stack-update/{proxy+}',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('stack-update', this.lambdaConstruct),
      authorizer,
    });
  }
}

/**
 * Props for constructing StackUpdateAddonProvider.
 */
export interface StackUpdateAddonProviderProps {
  /** Artifact resolver for resolving mailbox-go package. */
  readonly artifactResolver: IArtifactResolver;

  /** Template artifact name (e.g., 'mailbox-standard'). */
  readonly templateName: string;

  /** Template version string (e.g., 'v0.0.53' or '0.0.0-dev'). */
  readonly templateVersion: string;

  /** Distribution tag (release line); defaults to 'stable'. */
  readonly distTag?: string;
}

/**
 * Provider for the StackUpdate addon. Pass this to Mailbox's adminApiAddonProviders
 * to enable human-gated CloudFormation ChangeSet operations in the Admin API.
 */
export class StackUpdateAddonProvider implements IAdminApiAddonProvider {
  constructor(private readonly props: StackUpdateAddonProviderProps) {}

  createAdminApiAddons(scope: Construct, ctx: AdminApiAddonContext): IAdminApiAddon[] {
    return [
      new StackUpdateAddon(scope, 'stack-update-addon', {
        configTable: ctx.configTable,
        auditEventsQueue: ctx.auditEventsQueue,
        artifactResolver: this.props.artifactResolver,
        templateName: this.props.templateName,
        templateVersion: this.props.templateVersion,
        distTag: this.props.distTag,
      }),
    ];
  }
}
