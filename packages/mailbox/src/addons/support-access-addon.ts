import * as cdk from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import { Fn } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import { CdkArtifactEngine, GateOnConditionAspect } from '@serverlessinbox/mailbox-cdk-shared';

import { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider } from '../api/addons';
import type { IArtifactResolver } from '../artifacts/i-artifact-resolver';
import { SupportAccessApiLambda } from '../lambdas/support-access-api';
import { SupportAccessRolesInfra } from './support-access-roles-infra';

/**
 * Support Access feature mode.
 */
export enum SupportAccessMode {
  /** Support access feature is enabled. */
  ENABLED = 'enabled',
  /** Support access feature is disabled. */
  DISABLED = 'disabled',
}

/**
 * Props for constructing a SupportAccessAddon directly (internal use).
 * Not exported; users should use SupportAccessAddonProvider instead.
 */
export interface SupportAccessAddonProps {
  /** Support Access feature mode. */
  readonly mode: SupportAccessMode;
  /** Artifact resolver for Lambda code resolution. */
  readonly artifactResolver: IArtifactResolver;
  /** Config table for support access grant records (D16). */
  readonly configTable: ITable;
  /** SQS queue for audit events. */
  readonly auditEventsQueue: IQueue;
}

/**
 * Admin API addon for support access case management and IAM trust/permissions writes.
 *
 * Mounts the support-access-api Lambda on the Admin API with its own execution role
 * that has IAM trust/permissions write permissions on the support roles, config table access
 * config table read/write for grant records, and CloudTrail read
 * access for health checks.
 *
 * Constructs the entire support-access feature:
 * - Two IAM roles (support-diag, support-config-read) with empty/deny default trust
 * - Single Go Lambda for case RPCs and IAM trust/permissions write
 * - Scoped access to the existing config table (D16)
 *
 * All resources are gated by a CfnCondition so that when the feature is disabled,
 * zero resources synthesize into the template.
 *
 * Implements IAdminApiAddon.
 */
export class SupportAccessAddon extends Construct implements IAdminApiAddon {
  public uiConfig?: Record<string, unknown>;

  private readonly _lambdaConstruct?: SupportAccessApiLambda;
  private readonly _rolesInfra?: SupportAccessRolesInfra;

  constructor(scope: Construct, id: string, props: SupportAccessAddonProps) {
    super(scope, id);

    this.uiConfig = {
      supportAccess: {
        available: true,
      },
    };

    // A literal DISABLED is the only value that fully disables support access at synth time —
    // an unresolved CFN-parameter token falls through to the gated path.
    const fullyDisabled = props.mode === SupportAccessMode.DISABLED && !cdk.Token.isUnresolved(props.mode);

    if (!fullyDisabled) {
      // Build condition: SupportAccess == ENABLED
      // If mode is statically DISABLED (and not a token), this condition is never reached.
      // If mode is a CFN-parameter token or literal ENABLED, the condition gates the subtree.
      const condition = new cdk.CfnCondition(this, 'IsEnabled', {
        expression: Fn.conditionEquals(props.mode, SupportAccessMode.ENABLED),
      });

      // Create all support-access resources unconditionally in the template.
      // The GateOnConditionAspect will apply the condition to every resource,
      // so they produce zero live resources when the condition evaluates to false at deploy.

      // Support roles: empty/deny default trust, MaxSessionDuration: 3600
      this._rolesInfra = new SupportAccessRolesInfra(this, 'roles-infra');

      // Wrap the artifact resolver in a CDK artifact engine
      const artifactEngine = new CdkArtifactEngine(this, props.artifactResolver);

      // Support access API Lambda (Go-based, code-signed)
      // Combines case RPCs and IAM trust/permissions write in a single lambda
      // Uses the existing config table for grant records (D16)
      this._lambdaConstruct = new SupportAccessApiLambda(this, 'lambda', {
        supportDiagRoleArn: this._rolesInfra.supportDiagRoleArn,
        supportConfigReadRoleArn: this._rolesInfra.supportConfigReadRoleArn,
        configTable: props.configTable,
        auditEventsQueue: props.auditEventsQueue,
        artifactResolver: artifactEngine,
      });

      // Apply the condition to the entire subtree via the aspect
      cdk.Aspects.of(this).add(new GateOnConditionAspect(condition));
    }
  }

  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void {
    // Only mount routes if the lambda was created (feature not disabled at synth time)
    if (!this._lambdaConstruct) {
      return;
    }
    api.addRoutes({
      path: '/support-access/{proxy+}',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('support-access', this._lambdaConstruct),
      authorizer,
    });
  }
}

/**
 * Props for constructing SupportAccessAddonProvider.
 */
export interface SupportAccessAddonProviderProps {
  /** Support Access feature mode. */
  readonly mode: SupportAccessMode;
  /** Artifact resolver for resolving mailbox-go package. */
  readonly artifactResolver: IArtifactResolver;
}

/**
 * Provider for the SupportAccess addon. Pass this to Mailbox's adminApiAddonProviders
 * to enable support access case management and cross-account trust mechanics in the Admin API.
 */
export class SupportAccessAddonProvider implements IAdminApiAddonProvider {
  constructor(private readonly props: SupportAccessAddonProviderProps) {}

  createAdminApiAddons(scope: Construct, ctx: AdminApiAddonContext): IAdminApiAddon[] {
    return [
      new SupportAccessAddon(scope, 'support-access-addon', {
        mode: this.props.mode,
        artifactResolver: this.props.artifactResolver,
        configTable: ctx.configTable,
        auditEventsQueue: ctx.auditEventsQueue,
      }),
    ];
  }
}
