import type { IArtifactResolver }                                                                      from '@serverlessinbox/artifact-registry-cdk';
import { GateOnConditionAspect }                                                                       from '@serverlessinbox/mailbox-cdk-shared';
import { resolveVendorAccountIds }                                                                     from '@serverlessinbox/mailbox-cdk-shared';
import { HttpMethod }                                                                                  from 'aws-cdk-lib/aws-apigatewayv2';
import * as cdk                                                                                        from 'aws-cdk-lib';
import { Fn }                                                                                          from 'aws-cdk-lib';
import { Construct }                                                                                   from 'constructs';

import type { AdminApiRouteSpec, IAdminApiAddon }                                                      from '../../core/apis/addons';
import { SupportApiLambda }                                                                            from '../../resources/lambdas/support-api-lambda';
import { SupportRoleAssumptionCollectorLambda }                                                        from '../../resources/lambdas/support-role-assumption-collector-lambda';
import type { IAuditEventsQueue }                                                                      from '../../resources/queues/audit-events-queue';
import type { IDataTable }                                                                             from '../../resources/tables/data-tables';

import { SupportRolesInfra }                                                                           from './support-roles-infra';

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
  readonly mode:             SupportMode;
  readonly artifactResolver: IArtifactResolver;
  /** Config table that also holds the support grant records. */
  readonly configTable:      IDataTable;
  readonly auditEventsQueue: IAuditEventsQueue;
}

/** Whether the Admin UI offers the support feature. */
type SupportAvailability = { readonly available: boolean };

/** What the support addon contributes to the Admin UI configuration. */
type SupportUiConfig = { readonly support: SupportAvailability };

/**
 * Admin API addon for support case management.
 *
 * Constructs the entire support feature:
 * - The support IAM roles: a hop role and one role per support tier
 * - The support-api Lambda for case RPCs, mounted on the Admin API
 * - The hourly collector Lambda for role-assumption archiving and expiry enforcement
 *
 * Every resource is gated by a CfnCondition on the mode, so a feature that is disabled at deploy
 * time leaves no live resources. A literal DISABLED mode synthesizes no resources at all.
 */
export class SupportAddon extends Construct implements IAdminApiAddon {
  public readonly uiConfig: SupportUiConfig;

  /** Absent when support is disabled at synth time, because the handler Lambda is then not created. */
  public readonly routeSpec?: AdminApiRouteSpec;

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
      const condition = new cdk.CfnCondition(this, 'is-enabled', {
        expression: Fn.conditionEquals(props.mode, SupportMode.ENABLED),
      });

      // Resources are created unconditionally here; the GateOnConditionAspect registered below
      // applies the condition to each, so a false condition yields no live resources.

      // Resolved once here, as the composition root of the support feature, and threaded down as props.
      const vendorAccountIds = resolveVendorAccountIds(this);

      // Support roles: the hop role plus the tier roles, with static trust scoped by hop role tags.
      const supportRoles = new SupportRolesInfra(this, 'roles-infra', {
        vendorAccountIds,
      });

      // Support API Lambda: case RPCs and tag-based access control via the support-hop role.
      const apiHandler = new SupportApiLambda(this, 'lambda', {
        supportRoles,
        configTable:      props.configTable,
        auditEventsQueue: props.auditEventsQueue,
        artifactResolver: props.artifactResolver,
        vendorAccountIds,
      });

      this.routeSpec = {
        basePath: '/support',
        methods:  [HttpMethod.POST],
        handler:  apiHandler,
      };

      // Role-assumption collector Lambda.
      new SupportRoleAssumptionCollectorLambda(this, 'collector', {
        supportRoles,
        configTable:      props.configTable,
        artifactResolver: props.artifactResolver,
      });

      cdk.Aspects.of(this).add(new GateOnConditionAspect(condition));
    }
  }

}
