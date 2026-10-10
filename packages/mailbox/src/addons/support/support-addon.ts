import * as cdk from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import { Fn } from 'aws-cdk-lib';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { IAuditEventsQueue } from '../../features/audit-writing/audit-events-queue';
import type { IDataTable } from '../../data/data-tables';
import { GateOnConditionAspect } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

import { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider } from '../../api/addons';
import { SupportApiLambda } from '../../lambdas/support-api';
import { SupportRoleAssumptionCollectorLambda } from '../../lambdas/support-role-assumption-collector';
import { SupportRolesInfra, getSupportTierTagKeys, SUPPORT_DIAG_TAG_KEY, SUPPORT_CONFIG_READ_TAG_KEY } from './support-roles-infra';
import { resolveVendorAccountIds } from '@serverlessinbox/mailbox-cdk-shared';

/**
 * Support feature mode.
 */
export enum SupportMode {
  /** Support feature is enabled. */
  ENABLED = 'enabled',
  /** Support feature is disabled. */
  DISABLED = 'disabled',
}

/**
 * Props for constructing a SupportAddon directly (internal use).
 * Not exported; users should use SupportAddonProvider instead.
 */
export interface SupportAddonProps {
  /** Support feature mode. */
  readonly mode: SupportMode;
  /** Artifact resolver for Lambda code resolution. */
  readonly artifactResolver: IArtifactResolver;
  /** Config table for support grant records (D16). */
  readonly configTable: IDataTable;
  /** SQS queue for audit events. */
  readonly auditEventsQueue: IAuditEventsQueue;
}

/**
 * Admin API addon for support case management and IAM trust policy binding.
 *
 * Mounts the support-api Lambda on the Admin API with its own execution role
 * that has IAM UpdateAssumeRolePolicy + GetRole (trust binding per-case with ExternalId and expiry).
 * Lambda cannot widen permissions: tier action lists and permissions boundary are CDK-managed,
 * permanently attached, and immutable from the lambda. Trust is the only gate; attachment is static.
 *
 * Constructs the entire support feature:
 * - Two support IAM roles (support-diag, support-config-read) with empty/deny default trust
 * - Two tier managed policies (permanently attached to their corresponding roles)
 * - One permissions boundary (immutable from lambda, blocks scope creep)
 * - Single Go Lambda for case RPCs and IAM trust policy binding
 * - Config table read/write for grant records (D16), SQS send for audit events
 *
 * All resources are gated by a CfnCondition so that when the feature is disabled,
 * zero resources synthesize into the template.
 *
 * Implements IAdminApiAddon.
 */
export class SupportAddon extends Construct implements IAdminApiAddon {
  public uiConfig?: Record<string, unknown>;

  private readonly apiHandler?: IFunction;

  constructor(scope: Construct, id: string, props: SupportAddonProps) {
    super(scope, id);

    this.uiConfig = {
      support: {
        available: true,
      },
    };

    // A literal DISABLED is the only value that fully disables support access at synth time —
    // an unresolved CFN-parameter token falls through to the gated path.
    const fullyDisabled = props.mode === SupportMode.DISABLED && !cdk.Token.isUnresolved(props.mode);

    if (!fullyDisabled) {
      // Build condition: Support == ENABLED
      // If mode is statically DISABLED (and not a token), this condition is never reached.
      // If mode is a CFN-parameter token or literal ENABLED, the condition gates the subtree.
      const condition = new cdk.CfnCondition(this, 'IsEnabled', {
        expression: Fn.conditionEquals(props.mode, SupportMode.ENABLED),
      });

      // Create all support resources unconditionally in the template.
      // The GateOnConditionAspect will apply the condition to every resource,
      // so they produce zero live resources when the condition evaluates to false at deploy.

      // Vendor account IDs are resolved once here (this addon's own top-level construct is the
      // composition root for the support feature) and threaded down as already-resolved props —
      // no Lambda class below this point resolves it itself.
      const vendorAccountIds = resolveVendorAccountIds(this);
      const supportTierTagKeys = getSupportTierTagKeys();

      // Support roles: hop + two support roles with static trust scoped by hop role tags
      const rolesInfra = new SupportRolesInfra(this, 'roles-infra', {
        vendorAccountIds,
      });

      // Support API Lambda (Go-based, code-signed)
      // Handles case RPCs and tag-based access control via support-hop role.
      // Uses the existing config table for grant records (D16).
      // Tier inline policies are permanently attached in CDK (rolesInfra) and immutable from the lambda.
      // Can only tag/untag the support-hop role (serverless-inbox:support:diag, serverless-inbox:support:config-read keys).
      this.apiHandler = new SupportApiLambda(this, 'lambda', {
        supportHopRoleArn: rolesInfra.supportHopRoleArn,
        tierRoleArns: rolesInfra.tierArns,
        configTable: props.configTable,
        auditEventsQueue: props.auditEventsQueue,
        artifactResolver: props.artifactResolver,
        vendorAccountIds,
        supportDiagTagKey: SUPPORT_DIAG_TAG_KEY,
        supportConfigReadTagKey: SUPPORT_CONFIG_READ_TAG_KEY,
        supportTierTagKeys,
      });

      // Role Assumption Collector Lambda (Go-based, scheduled hourly)
      // Archives CloudTrail assume-role events into DynamoDB before the 90-day window closes.
      // Also untaggs expired support cases from support-hop to enforce scheduled expiry.
      // No async invoke grant and never disabled (queries the grant partition first and returns early when nothing to archive).
      const collectorLambda = new SupportRoleAssumptionCollectorLambda(this, 'collector', {
        supportHopRoleArn: rolesInfra.supportHopRoleArn,
        tierRoleArns: rolesInfra.tierArns,
        configTable: props.configTable,
        artifactResolver: props.artifactResolver,
        supportDiagTagKey: SUPPORT_DIAG_TAG_KEY,
        supportConfigReadTagKey: SUPPORT_CONFIG_READ_TAG_KEY,
        supportTierTagKeys,
      });

      // EventBridge rule: hourly schedule for the collector (permanently enabled)
      // Rule stays on and lambda guards itself by checking the grant partition first.
      // Hourly granularity matches the role's maxSessionDuration (3600s) to bound expiry overrun.
      const rule = new events.Rule(this, 'hourly-collector-rule', {
        schedule: events.Schedule.cron({ minute: '0' }), // Hourly at minute 0
        description: 'Hourly trigger for support role assumption collector and expiry enforcement',
      });

      rule.addTarget(new targets.LambdaFunction(collectorLambda));

      // Apply the condition to the entire subtree via the aspect
      cdk.Aspects.of(this).add(new GateOnConditionAspect(condition));
    }
  }

  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void {
    // Only mount routes if the lambda was created (feature not disabled at synth time)
    if (!this.apiHandler) {
      return;
    }
    api.addRoutes({
      path: '/support/{proxy+}',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('support', this.apiHandler),
      authorizer,
    });
  }
}

/**
 * Props for constructing SupportAddonProvider.
 */
export interface SupportAddonProviderProps {
  /** Support feature mode. */
  readonly mode: SupportMode;
}

/**
 * Provider for the Support addon. Pass this to Mailbox's adminApiAddonProviders
 * to enable support case management and cross-account trust mechanics in the Admin API.
 */
export class SupportAddonProvider implements IAdminApiAddonProvider {
  constructor(private readonly props: SupportAddonProviderProps) {}

  createAdminApiAddons(scope: Construct, ctx: AdminApiAddonContext): IAdminApiAddon[] {
    return [
      new SupportAddon(scope, 'support-addon', {
        mode: this.props.mode,
        artifactResolver: ctx.artifactResolver,
        configTable: ctx.configTable,
        auditEventsQueue: ctx.auditEventsQueue,
      }),
    ];
  }
}
