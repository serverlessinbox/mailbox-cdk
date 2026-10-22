import { rootStackResourceTagConditions, StackIdentity } from '@serverlessinbox/mailbox-cdk-shared';
import type { RootStack }                                from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                                          from 'aws-cdk-lib/aws-iam';
import { Fn, Aws, Stack, Duration }                      from 'aws-cdk-lib';
import { Construct }                                     from 'constructs';

import type { ISupportRoles }                            from '../../contracts/support-roles';

import {
  ENUMERATION_AND_ACCOUNT_LEVEL_ACTIONS,
  SUPPORT_CONFIG_READ_TIER,
  SUPPORT_DIAG_TIER,
  SUPPORT_TIERS,
} from './support-tiers';
import type { SupportTier } from './support-tiers';

const SUPPORT_ROLE_MAX_SESSION_DURATION = Duration.seconds(3600);

/** Inputs of the support IAM roles. */
export interface SupportRolesInfraProps {
  /** Vendor AWS account IDs permitted to assume the support hop role, already resolved by the caller. */
  readonly vendorAccountIds: string[];
}

/**
 * The IAM roles that give the vendor support account read-only access to this deployment: one hop role
 * and one role per support tier (`SUPPORT_TIERS`).
 *
 * - The hop role trusts the root of each vendor account. Its only permission is `sts:AssumeRole` on the
 *   tier roles.
 * - Each tier role trusts only the hop role, and only for sessions whose tier tag carries the case
 *   external ID. Its inline policy is attached permanently, with a one-hour maximum session.
 */
export class SupportRolesInfra extends Construct implements ISupportRoles {
  public readonly hopRoleArn:        string;
  public readonly diagRoleArn:       string;
  public readonly configReadRoleArn: string;
  public readonly diagTagKey         = SUPPORT_DIAG_TIER.tagKey;
  public readonly configReadTagKey   = SUPPORT_CONFIG_READ_TIER.tagKey;

  constructor(scope: Construct, id: string, props: SupportRolesInfraProps) {
    super(scope, id);

    // Fixed for a stack's lifetime, differs after destroy+redeploy. Only the first 8-character segment
    // (UUID format: 8-4-4-4-12) is used, to stay within the 64-char IAM role-name limit.
    const stackGuidSegment = StackIdentity.guidPrefix;

    // The name carries no parent group id, so its length is fixed and independent of construct position.
    const hopRoleName = Fn.join('', ['support-', stackGuidSegment, '-hop']);

    // Role ARNs are formatted from the names rather than read from the roles: the roles reference these
    // ARNs in their own policies, and a GetAtt would make that a dependency cycle.
    this.hopRoleArn        = this.formatRoleArn(hopRoleName);
    this.diagRoleArn       = this.formatRoleArn(this.tierRoleName(stackGuidSegment, SUPPORT_DIAG_TIER));
    this.configReadRoleArn = this.formatRoleArn(this.tierRoleName(stackGuidSegment, SUPPORT_CONFIG_READ_TIER));

    const hopRole = this.createHopRole(hopRoleName, props.vendorAccountIds);
    for (const tier of SUPPORT_TIERS) {
      this.createTierRole(tier, this.tierRoleName(stackGuidSegment, tier), hopRole);
    }
  }

  public grantTagWrites(grantee: iam.IGrantable): void {
    // aws:TagKeys is multivalued and needs the ForAllValues set operator: with plain StringEquals the
    // condition never matches and every tag write is silently denied. ForAllValues keeps every key of
    // the request inside the tier tag keys.
    iam.Grant.addToPrincipal({
      grantee,
      actions:      ['iam:TagRole', 'iam:UntagRole'],
      resourceArns: [this.hopRoleArn],
      conditions:   {
        'ForAllValues:StringEquals': {
          'aws:TagKeys': SUPPORT_TIERS.map((tier) => tier.tagKey),
        },
      },
    });
  }

  public grantTagRead(grantee: iam.IGrantable): void {
    // ListRoleTags carries no request tag keys, so an aws:TagKeys condition would never apply to it.
    iam.Grant.addToPrincipal({
      grantee,
      actions:      ['iam:ListRoleTags'],
      resourceArns: [this.hopRoleArn],
    });
  }

  public grantAssumptionLookup(grantee: iam.IGrantable): void {
    // CloudTrail actions declare no resource types, so resources: ['*'] is the only scope.
    iam.Grant.addToPrincipal({
      grantee,
      actions:      ['cloudtrail:LookupEvents'],
      resourceArns: ['*'],
    });
  }

  private tierRoleName(stackGuidSegment: string, tier: SupportTier): string {
    return Fn.join('', ['support-', stackGuidSegment, `-${tier.roleNameSlug}`]);
  }

  private formatRoleArn(roleName: string): string {
    return Stack.of(this).formatArn({
      service:      'iam',
      region:       '',
      account:      Aws.ACCOUNT_ID,
      resource:     'role',
      resourceName: roleName,
    });
  }

  private createHopRole(roleName: string, vendorAccountIds: string[]): iam.Role {
    return new iam.Role(this, 'support-hop', {
      roleName,
      assumedBy:          new iam.CompositePrincipal(...vendorAccountIds.map((accountId) => new iam.AccountPrincipal(accountId))),
      maxSessionDuration: SUPPORT_ROLE_MAX_SESSION_DURATION,
      inlinePolicies:     {
        'support-hop-assume': new iam.PolicyDocument({
          statements: [this.buildHopRoleAssumeStatement()],
        }),
      },
      description:        'Support access hop role. Static trust to vendor support account. Can assume support-diag and support-config-read roles based on runtime tags.',
    });
  }

  private createTierRole(tier: SupportTier, roleName: string, hopRole: iam.Role): void {
    const supportRole = new iam.Role(this, tier.constructId, {
      roleName,
      assumedBy:          new iam.PrincipalWithConditions(new iam.ArnPrincipal(this.hopRoleArn), {
        StringLike: {
          // Delimiter is '/' not '|': IAM tag values reject '|' (not in [\p{L}\p{Z}\p{N}_.:/=+\-@]).
          // Nanoid IDs use alphabet A-Za-z0-9_- so '/' never appears in case IDs, making it a safe separator.
          [`aws:PrincipalTag/${tier.tagKey}`]: '*/${sts:ExternalId}/*',
        },
      }),
      maxSessionDuration: SUPPORT_ROLE_MAX_SESSION_DURATION,
      inlinePolicies:     {
        [tier.inlinePolicyName]: new iam.PolicyDocument({ statements: this.buildTierStatements(tier) }),
      },
      description:        tier.description,
    });

    // IAM validates principals in trust policies at creation time, so the hop role the tier role trusts
    // must exist first. IAM does not validate resource ARNs in identity policies, so the hop role can
    // name the tier role ARNs in its inline policy before the tier roles exist.
    supportRole.node.addDependency(hopRole);
  }

  private buildTierStatements(tier: SupportTier): iam.PolicyStatement[] {
    const tagScopedActions   = tier.actions.filter((action) => !ENUMERATION_AND_ACCOUNT_LEVEL_ACTIONS.includes(action));
    const enumerationActions = tier.actions.filter((action) => ENUMERATION_AND_ACCOUNT_LEVEL_ACTIONS.includes(action));

    const statements: iam.PolicyStatement[] = [];

    statements.push(...this.buildTagScopedStatements(tagScopedActions));

    const enumerationStatement = this.buildEnumerationStatement(enumerationActions);
    if (enumerationStatement) {
      statements.push(enumerationStatement);
    }

    if (tier.readsEdgeLogGroup) {
      statements.push(this.buildEdgeLogGroupStatement());
    }

    statements.push(this.buildCloudFormationReadStatement());

    return statements;
  }

  private buildHopRoleAssumeStatement(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      effect:    iam.Effect.ALLOW,
      actions:   ['sts:AssumeRole'],
      resources: [this.diagRoleArn, this.configReadRoleArn],
    });
  }

  /** Resource-naming actions, scoped by the root-stack tag conditions: one statement per condition. */
  private buildTagScopedStatements(actions: string[]): iam.PolicyStatement[] {
    if (actions.length === 0) {
      return [];
    }
    const rootStack: RootStack = { name: Aws.STACK_NAME, id: StackIdentity.guid };
    return rootStackResourceTagConditions(rootStack).map(
      (conditions) =>
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions,
          resources: ['*'],
          conditions,
        }),
    );
  }

  /** Enumeration and account-level actions declare no resource type, so a tag condition cannot bind to them. */
  private buildEnumerationStatement(actions: string[]): iam.PolicyStatement | undefined {
    if (actions.length === 0) {
      return undefined;
    }
    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions,
      resources: ['*'],
    });
  }

  /**
   * CloudFront creates the edge log group itself in every replica region, untagged, so a tag condition
   * cannot reach it. The ARN is built from the same intrinsics as the pipeline log group names so the
   * name matches exactly.
   */
  private buildEdgeLogGroupStatement(): iam.PolicyStatement {
    const edgeLogGroupArn = Fn.join('', [
      'arn:',
      Aws.PARTITION,
      ':logs:*:',
      Aws.ACCOUNT_ID,
      ':log-group:/serverlessinbox/',
      Aws.STACK_NAME,
      '/jmap-',
      StackIdentity.guidPrefix,
      ':*',
    ]);

    return new iam.PolicyStatement({
      effect:    iam.Effect.ALLOW,
      actions:   [
        'logs:DescribeLogStreams',
        'logs:GetLogEvents',
        'logs:FilterLogEvents',
        'logs:GetLogGroupFields',
        'logs:StartQuery',
        'logs:GetQueryResults',
      ],
      resources: [edgeLogGroupArn],
    });
  }

  /**
   * Scoped to this stack and its nested stacks by ARN. A tag condition cannot work here: a stack does
   * not carry its own tags, so `aws:ResourceTag` never matches the stack resource itself.
   */
  private buildCloudFormationReadStatement(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      effect:    iam.Effect.ALLOW,
      actions:   [
        'cloudformation:DescribeStacks',
        'cloudformation:ListStackResources',
        'cloudformation:DescribeStackEvents',
        // The console renders its resource tree from the CDK metadata inside the template body, so
        // viewing it requires reading the template itself (both template actions).
        'cloudformation:GetTemplate',
        'cloudformation:GetTemplateSummary',
      ],
      resources: [
        Aws.STACK_ID,
        `arn:${Aws.PARTITION}:cloudformation:${Aws.REGION}:${Aws.ACCOUNT_ID}:stack/${Aws.STACK_NAME}-*/*`,
      ],
    });
  }
}
