import type { IArtifactResolver }                                                                      from '@serverlessinbox/artifact-registry-cdk';
import { GateOnConditionAspect }                                                                       from '@serverlessinbox/mailbox-cdk-shared';
import { resolveVendorAccountIds }                                                                     from '@serverlessinbox/mailbox-cdk-shared';
import { HttpLambdaAuthorizer }                                                                        from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration }                                                                       from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpApi, HttpMethod }                                                                         from 'aws-cdk-lib/aws-apigatewayv2';
import * as targets                                                                                    from 'aws-cdk-lib/aws-events-targets';
import * as events                                                                                     from 'aws-cdk-lib/aws-events';
import type { IFunction }                                                                              from 'aws-cdk-lib/aws-lambda';
import * as cdk                                                                                        from 'aws-cdk-lib';
import { Fn }                                                                                          from 'aws-cdk-lib';
import { Construct }                                                                                   from 'constructs';

import { IAdminApiAddon }                                                                              from '../../core/apis/addons';
import type { IDataTable }                                                                             from '../../resources/tables/data-tables';
import type { IAuditEventsQueue }                                                                      from '../../resources/queues/audit-events-queue';
import { SupportApiLambda }                                                                            from '../../resources/lambdas/support-api-lambda';
import { SupportRoleAssumptionCollectorLambda }                                                        from '../../resources/lambdas/support-role-assumption-collector-lambda';

import { SupportRolesInfra, getSupportTierTagKeys, SUPPORT_DIAG_TAG_KEY, SUPPORT_CONFIG_READ_TAG_KEY } from './support-roles-infra';

/**
 * Whether the support feature is provisioned.
 *
 * Pass a literal value to decide at synth time. Pass a CloudFormation parameter token to decide at
 * deploy time: the support resources are then always in the template, behind a condition on the
 * parameter, and a deployer can switch the feature on or off without re-synthesizing.
 */
export enum SupportMode {
  /** Provisions the support roles, the support case API and the hourly role-assumption collector. */
  ENABLED = 'enabled',
  /**
   * Provisions nothing: no roles, no Lambdas and no routes. This holds only for the literal
   * value; an unresolved parameter token is always treated as possibly enabled.
   */
  DISABLED = 'disabled',
}

/** Inputs of `SupportAddon`, as threaded in by `SupportAddonProvider`. */
export interface SupportAddonProps {
  readonly mode: SupportMode;
  readonly artifactResolver: IArtifactResolver;
  /** Config table that also holds the support grant records. */
  readonly configTable: IDataTable;
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
 * - Support IAM roles (support-diag, support-config-read) with empty/deny default trust
 * - Tier managed policies (permanently attached to their corresponding roles)
 * - A permissions boundary (immutable from lambda, blocks scope creep)
 * - A Go Lambda for case RPCs and IAM trust policy binding
 * - An hourly collector Lambda for role-assumption archiving and expiry enforcement
 * - Config table read/write for grant records, SQS send for audit events
 *
 * Every resource is gated by a CfnCondition on the mode, so a feature that is disabled at deploy
 * time leaves no live resources. A literal DISABLED mode synthesizes no resources at all.
 */
export class SupportAddon extends Construct implements IAdminApiAddon {
  public uiConfig?: Record<string, unknown>;

  private readonly apiHandler?: IFunction;

  constructor(scope: Construct, id: string, props: SupportAddonProps) {
    super(scope, id);

    // A literal DISABLED is the only value that fully disables support access at synth time —
    // an unresolved CFN-parameter token falls through to the gated path.
    const fullyDisabled = props.mode === SupportMode.DISABLED && !cdk.Token.isUnresolved(props.mode);

    this.uiConfig = {
      support: {
        available: !fullyDisabled,
      },
    };

    if (!fullyDisabled) {
      const condition = new cdk.CfnCondition(this, 'IsEnabled', {
        expression: Fn.conditionEquals(props.mode, SupportMode.ENABLED),
      });

      // Resources are created unconditionally here; the GateOnConditionAspect registered below
      // applies the condition to each, so a false condition yields no live resources.

      // Resolved once here, as the composition root of the support feature, and threaded down as props.
      const vendorAccountIds   = resolveVendorAccountIds(this);
      const supportTierTagKeys = getSupportTierTagKeys();

      // Support roles: the hop role plus the tier roles, with static trust scoped by hop role tags.
      const rolesInfra = new SupportRolesInfra(this, 'roles-infra', {
        vendorAccountIds,
      });

      // Support API Lambda: case RPCs and tag-based access control via the support-hop role.
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

      // Role-assumption collector Lambda.
      const collectorLambda = new SupportRoleAssumptionCollectorLambda(this, 'collector', {
        supportHopRoleArn: rolesInfra.supportHopRoleArn,
        tierRoleArns: rolesInfra.tierArns,
        configTable: props.configTable,
        artifactResolver: props.artifactResolver,
        supportDiagTagKey: SUPPORT_DIAG_TAG_KEY,
        supportConfigReadTagKey: SUPPORT_CONFIG_READ_TAG_KEY,
        supportTierTagKeys,
      });

      // EventBridge rule: hourly schedule for the collector.
      const rule = new events.Rule(this, 'hourly-collector-rule', {
        schedule: events.Schedule.cron({ minute: '0' }), // Hourly at minute 0
        description: 'Hourly trigger for support role assumption collector and expiry enforcement',
      });

      rule.addTarget(new targets.LambdaFunction(collectorLambda));

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
