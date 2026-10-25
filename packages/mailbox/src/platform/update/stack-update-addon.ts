import type { IArtifactResolver }                                                              from '@serverlessinbox/artifact-registry-cdk';
import { buildArtifactKey, buildReleasePointerKey, buildArtifactUrl, buildArtifactBucketName } from '@serverlessinbox/artifact-registry';
import { HttpMethod }                                                                          from 'aws-cdk-lib/aws-apigatewayv2';
import * as cdk                                                                                from 'aws-cdk-lib';
import { Aws }                                                                                 from 'aws-cdk-lib';
import { Construct }                                                                           from 'constructs';

import type { AdminApiRouteSpec, IAdminApiAddon }                                              from '../../core/apis/addons';
import { StackUpdateApiLambda }                                                                from '../../resources/lambdas/stack-update-api-lambda';
import type { IAuditEventsQueue }                                                              from '../../resources/queues/audit-events-queue';
import type { IDataTable }                                                                     from '../../resources/tables/data-tables';

import { DEFAULT_DIST_TAG }                                                                    from './default-dist-tag';
import { TemplateVersionParam }                                                                from './template-version-param';

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

/** What the stack-update addon contributes to the Admin UI configuration. */
type StackUpdateUiConfig = { readonly stackUpdate: { readonly available: boolean } };

/**
 * Admin API addon for human-gated CloudFormation ChangeSet operations.
 *
 * Mounts the stack-update-api Lambda on the Admin API with its own execution role
 * that has CloudFormation ChangeSet permissions.
 *
 * Contributes { stackUpdate: { available: true } } to the admin UI config.
 */
export class StackUpdateAddon extends Construct implements IAdminApiAddon {
  public readonly uiConfig: StackUpdateUiConfig;
  public readonly routeSpec: AdminApiRouteSpec;

  constructor(scope: Construct, id: string, props: StackUpdateAddonProps) {
    super(scope, id);

    this.uiConfig = {
      stackUpdate: {
        available: true,
      },
    };

    const artifactLocation = props.artifactResolver.location;

    const pointerKey    = buildReleasePointerKey('template', props.templateName, {
      distTag: props.distTag ?? DEFAULT_DIST_TAG,
      project: artifactLocation.project,
    });
    const pointerBucket = buildArtifactBucketName(artifactLocation, Aws.REGION);

    const templateUrlTemplate = buildArtifactUrl(
      pointerBucket,
      Aws.REGION,
      buildArtifactKey('template', props.templateName, { type: 'release-template', project: artifactLocation.project }),
    );

    // This resource is rendered into the CloudFormation template and survives quick-create deploys.
    const templateVersionParam = new TemplateVersionParam(this, 'template-version', {
      templateVersion: props.templateVersion,
    });

    const lambdaConstruct = new StackUpdateApiLambda(this, 'lambda', {
      rootStackArn:     cdk.Stack.of(this).stackId,
      configTable:      props.configTable,
      artifactResolver: props.artifactResolver,
      templateVersionParam,
      pointerBucket,
      pointerKey,
      templateUrlTemplate,
      auditEventsQueue:    props.auditEventsQueue,
    });

    this.routeSpec = {
      basePath: '/stack-update',
      methods:  [HttpMethod.POST],
      handler:  lambdaConstruct,
    };
  }

}
