import type { IArtifactResolver }                                                              from '@serverlessinbox/artifact-registry-cdk';
import { buildArtifactKey, buildReleasePointerKey, buildArtifactUrl, buildArtifactBucketName } from '@serverlessinbox/artifact-registry';
import { HttpLambdaAuthorizer }                                                                from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration }                                                               from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpApi, HttpMethod }                                                                 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cdk                                                                                from 'aws-cdk-lib';
import { Construct }                                                                           from 'constructs';

import { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider }                        from '../../api/addons';
import type { IDataTable }                                                                     from '../../resources/tables/data-tables';
import type { IAuditEventsQueue }                                                              from '../../resources/queues/audit-events-queue';
import { StackUpdateApiLambda }                                                                from '../../resources/lambdas/stack-update-api-lambda';

import { TemplateVersionParam, type ITemplateVersionParam }                                    from './template-version-param';

/** Inputs of `StackUpdateAddon`, as threaded in by `StackUpdateAddonProvider`. */
export interface StackUpdateAddonProps {
  readonly configTable: IDataTable;

  readonly auditEventsQueue: IAuditEventsQueue;

  readonly artifactResolver: IArtifactResolver;

  /** Template artifact name (e.g., 'mailbox-standard'). */
  readonly templateName: string;

  /** Template version string, stored in the template-version SSM parameter. */
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
    const stack        = cdk.Stack.of(this);
    const region       = stack.region;

    const artifactLocation = props.artifactResolver.location;

    const pointerKey    = buildReleasePointerKey('template', props.templateName, {
      distTag: props.distTag ?? 'stable',
      project: artifactLocation.project,
    });
    const pointerBucket = buildArtifactBucketName(artifactLocation, region);

    const templateUrlTemplate = buildArtifactUrl(
      pointerBucket,
      region,
      buildArtifactKey('template', props.templateName, { type: 'release-template', project: artifactLocation.project }),
    );

    // This resource is rendered into the CloudFormation template and survives quick-create deploys.
    const templateVersionParamConstruct = new TemplateVersionParam(this, 'template-version', {
      templateVersion: props.templateVersion,
    });
    this.templateVersionParamAccess     = templateVersionParamConstruct;
    const templateVersionParam          = templateVersionParamConstruct.parameter;

    this.lambdaConstruct = new StackUpdateApiLambda(this, 'lambda', {
      rootStackArn,
      configTable: props.configTable,
      artifactBucketBase: artifactLocation.bucketBase,
      artifactResolver: props.artifactResolver,
      templateVersionParamName: templateVersionParam.parameterName,
      pointerBucket,
      pointerKey,
      templateUrlTemplate,
      auditEventsQueue: props.auditEventsQueue,
    });

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
 * Settings of the {@link StackUpdateAddonProvider}: which template the stack is updated from and
 * which version it was deployed at.
 */
export interface StackUpdateAddonProviderProps {
  /**
   * The artifact resolver the stack-update Lambda's code is resolved through. Its registry
   * location (bucket base and project) also determines where the release pointer and the template
   * URL are read from. Pass the resolver your Mailbox uses, so the Lambda ships at the same
   * artifact version as the rest of the Mailbox.
   */
  readonly artifactResolver: IArtifactResolver;

  /**
   * Name of the template artifact the stack is updated from, for example `'mailbox-standard'`.
   * It selects the release pointer and the template URL the update flow reads.
   */
  readonly templateName: string;

  /**
   * The template version this stack was deployed from. It is stored as given in an SSM parameter
   * that the stack-update Lambda reads, so it must match the version actually deployed.
   */
  readonly templateVersion: string;

  /**
   * The release line (dist-tag) whose release pointer is read to find the template to update to.
   *
   * @default 'stable'
   */
  readonly distTag?: string;
}

/**
 * Enables human-gated CloudFormation ChangeSet operations in the Admin API: it mounts the
 * stack-update Lambda on `POST /stack-update/{proxy+}` behind the Admin API's authorizer and tells
 * the Admin UI that stack updates are available (`stackUpdate.available` in its config).
 *
 * Pass an instance in `MailboxProps.adminApiAddonProviders`. Nothing is enabled unless it is
 * listed there.
 */
export class StackUpdateAddonProvider implements IAdminApiAddonProvider {
  constructor(private readonly props: StackUpdateAddonProviderProps) {}

  /**
   * Creates the stack-update addon under `scope`, using the shared config table and audit queue
   * from `ctx` and the artifact resolver from this provider's props.
   *
   * @param scope The construct to create the addon under.
   * @param ctx The shared tables and queue the addon builds on.
   */
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
