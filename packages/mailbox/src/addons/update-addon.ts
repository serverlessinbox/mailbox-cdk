import * as cdk from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { CdkArtifactEngine, PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
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
