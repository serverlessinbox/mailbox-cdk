import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Fn, Aws, Stack, Duration } from 'aws-cdk-lib';
import { rootStackResourceTagCondition, StackIdentity } from '@serverlessinbox/mailbox-cdk-shared';

// Tier 1 — support-diag: observability only (CloudWatch Logs + metrics)
const SUPPORT_DIAG_ALLOWED_ACTIONS = [
  'logs:DescribeLogGroups',
  'logs:DescribeLogStreams',
  'logs:GetLogEvents',
  'logs:FilterLogEvents',
  'logs:GetLogGroupFields',
  'logs:StartQuery',
  'logs:GetQueryResults',
  'logs:StopQuery',
  'cloudwatch:GetMetricData',
  'cloudwatch:GetMetricStatistics',
  'cloudwatch:ListMetrics',
];

// Tier 2 delta — support-config: infrastructure config read (additional actions beyond diag)
const SUPPORT_CONFIG_INSPECT_ADDITIONAL_ALLOWED_ACTIONS = [
  'lambda:GetFunctionConfiguration',
  'lambda:ListFunctions',
  'lambda:ListVersionsByFunction',
  'lambda:ListAliases',
  'lambda:GetPolicy',
  'states:DescribeStateMachine',
  'states:ListStateMachines',
  'states:DescribeExecution',
  'states:ListExecutions',
  'states:GetExecutionHistory',
  'dynamodb:DescribeTable',
  'dynamodb:DescribeTimeToLive',
  'dynamodb:ListTables',
  'sqs:GetQueueAttributes',
  'sqs:ListQueues',
  'sqs:ListDeadLetterSourceQueues',
  'events:DescribeRule',
  'events:ListRules',
  'events:ListTargetsByRule',
  'ssm:GetParameter',
  'ssm:GetParameters',
  'ses:GetAccount',
  'ses:GetEmailIdentity',
  'ses:ListEmailIdentities',
  'ses:DescribeActiveReceiptRuleSet',
  'ses:GetConfigurationSetEventDestinations',
];

// Tier 2 effective = diag + delta (computed, not hand-maintained)
const SUPPORT_CONFIG_INSPECT_ALLOWED_ACTIONS = [
  ...SUPPORT_DIAG_ALLOWED_ACTIONS,
  ...SUPPORT_CONFIG_INSPECT_ADDITIONAL_ALLOWED_ACTIONS,
];

// Actions that cannot be scoped by resource tag (enumeration/account-level — declare no resource type).
// These stay on resources: ['*'].
const ENUMERATION_AND_ACCOUNT_LEVEL_ACTIONS = [
  // Tier 1
  'logs:DescribeLogGroups',
  'logs:StopQuery',
  'cloudwatch:GetMetricData',
  'cloudwatch:GetMetricStatistics',
  'cloudwatch:ListMetrics',
  // Tier 2 additional
  'lambda:ListFunctions',
  'lambda:ListVersionsByFunction',
  'lambda:ListAliases',
  'states:ListStateMachines',
  'states:ListExecutions',
  'dynamodb:ListTables',
  'sqs:ListQueues',
  'sqs:ListDeadLetterSourceQueues',
  'events:ListRules',
  'events:ListTargetsByRule',
  'ses:GetAccount',
  'ses:ListEmailIdentities',
];

const SUPPORT_ROLE_MAX_SESSION_DURATION = Duration.seconds(3600);

/** Construct id of a support tier's role; it is also the key the tier's role ARN is exposed under. */
export type SupportTierId = 'support-diag' | 'support-config-read';

/** One support access tier: the role it gets, the trust tag that gates it and the actions it may use. */
interface SupportTier {
  /** Determines the role's logical ID, so changing it replaces the role. */
  readonly constructId: SupportTierId;
  /** Role name slug used in Fn::join construction */
  readonly roleNameSlug: string;
  /** IAM tag key used in trust policy condition */
  readonly tagKey: string;
  readonly inlinePolicyName: string;
  readonly actions: string[];
  /** Environment variable name for the role ARN */
  readonly envVarName: string;
  readonly description: string;
}

/** The support tiers. Order is significant: roles are created, and environment entries built, in this order. */
const SUPPORT_TIERS: SupportTier[] = [
  {
    constructId: 'support-diag',
    roleNameSlug: 'diag',
    tagKey: 'serverless-inbox:support:diag',
    inlinePolicyName: 'support-diag-access',
    actions: SUPPORT_DIAG_ALLOWED_ACTIONS,
    envVarName: 'SUPPORT_DIAG_ROLE_ARN',
    description: 'Support access role for diagnostics (CloudWatch, Lambda, Step Functions, DynamoDB, SQS introspection). Trust scoped by hop role serverless-inbox:support:diag tag.',
  },
  {
    constructId: 'support-config-read',
    roleNameSlug: 'config-read',
    tagKey: 'serverless-inbox:support:config-read',
    inlinePolicyName: 'support-config-read-access',
    actions: SUPPORT_CONFIG_INSPECT_ALLOWED_ACTIONS,
    envVarName: 'SUPPORT_CONFIG_READ_ROLE_ARN',
    description: 'Support access role for config reading (DynamoDB config table, stack parameters). Trust scoped by hop role serverless-inbox:support:config-read tag.',
  },
];

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
export class SupportRolesInfra extends Construct {
  readonly supportHopRoleArn: string;
  readonly tierArns: Record<string, string>;

  constructor(scope: Construct, id: string, props: SupportRolesInfraProps) {
    super(scope, id);

    // Fixed for a stack's lifetime, differs after destroy+redeploy. Only the first 8-character segment
    // (UUID format: 8-4-4-4-12) is used, to stay within the 64-char IAM role-name limit.
    const stackGuidSegment = StackIdentity.guidPrefix;

    // The name carries no parent group id, so its length is fixed and independent of construct position.
    const supportHopRoleName = Fn.join('', ['support-', stackGuidSegment, '-hop']);

    // Role ARNs are formatted from the names rather than read from the roles: the roles reference these
    // ARNs in their own policies, and a GetAtt would make that a dependency cycle.
    this.supportHopRoleArn = this.formatRoleArn(supportHopRoleName);
    this.tierArns = {};
    for (const tier of SUPPORT_TIERS) {
      this.tierArns[tier.constructId] = this.formatRoleArn(this.tierRoleName(stackGuidSegment, tier));
    }

    const hopRole = this.createHopRole(supportHopRoleName, props.vendorAccountIds);
    for (const tier of SUPPORT_TIERS) {
      this.createTierRole(tier, this.tierRoleName(stackGuidSegment, tier), hopRole);
    }
  }

  private tierRoleName(stackGuidSegment: string, tier: SupportTier): string {
    return Fn.join('', ['support-', stackGuidSegment, `-${tier.roleNameSlug}`]);
  }

  private formatRoleArn(roleName: string): string {
    return Stack.of(this).formatArn({
      service: 'iam',
      region: '',
      resource: 'role',
      resourceName: roleName,
    });
  }

  private createHopRole(roleName: string, vendorAccountIds: string[]): iam.Role {
    const hopRole = new iam.Role(this, 'support-hop', {
      roleName,
      assumedBy: new iam.ServicePrincipal('sts.amazonaws.com'),
      maxSessionDuration: SUPPORT_ROLE_MAX_SESSION_DURATION,
      inlinePolicies: {
        'support-hop-assume': new iam.PolicyDocument({
          statements: [this.buildHopRoleAssumeStatement()],
        }),
      },
      description: 'Support access hop role. Static trust to vendor support account. Can assume support-diag and support-config-read roles based on runtime tags.',
    });

    const hopCfnRole = hopRole.node.defaultChild;
    if (!(hopCfnRole instanceof iam.CfnRole)) {
      throw new Error('support-hop: expected defaultChild to be an iam.CfnRole');
    }
    const vendorPrincipals = vendorAccountIds.map((accountId) => `arn:aws:iam::${accountId}:root`);
    hopCfnRole.assumeRolePolicyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            AWS: vendorPrincipals.length === 1 ? vendorPrincipals[0] : vendorPrincipals,
          },
          Action: 'sts:AssumeRole',
        },
      ],
    };

    return hopRole;
  }

  private createTierRole(tier: SupportTier, roleName: string, hopRole: iam.Role): void {
    const supportRole = new iam.Role(this, tier.constructId, {
      roleName,
      assumedBy: new iam.PrincipalWithConditions(new iam.ArnPrincipal(this.supportHopRoleArn), {
        StringLike: {
          // Delimiter is '/' not '|': IAM tag values reject '|' (not in [\p{L}\p{Z}\p{N}_.:/=+\-@]).
          // Nanoid IDs use alphabet A-Za-z0-9_- so '/' never appears in case IDs, making it a safe separator.
          [`aws:PrincipalTag/${tier.tagKey}`]: '*/${sts:ExternalId}/*',
        },
      }),
      maxSessionDuration: SUPPORT_ROLE_MAX_SESSION_DURATION,
      inlinePolicies: {
        [tier.inlinePolicyName]: new iam.PolicyDocument({ statements: this.buildTierStatements(tier) }),
      },
      description: tier.description,
    });

    // IAM validates principals in trust policies at creation time, so the hop role the tier role trusts
    // must exist first. IAM does not validate resource ARNs in identity policies, so the hop role can
    // name the tier role ARNs in its inline policy before the tier roles exist.
    supportRole.node.addDependency(hopRole);
  }

  private buildTierStatements(tier: SupportTier): iam.PolicyStatement[] {
    const tagScopedActions = tier.actions.filter((a) => !ENUMERATION_AND_ACCOUNT_LEVEL_ACTIONS.includes(a));
    const enumerationActions = tier.actions.filter((a) => ENUMERATION_AND_ACCOUNT_LEVEL_ACTIONS.includes(a));

    const statements: iam.PolicyStatement[] = [];

    const tagScopedStatement = this.buildTagScopedStatement(tagScopedActions);
    if (tagScopedStatement) {
      statements.push(tagScopedStatement);
    }

    const enumerationStatement = this.buildEnumerationStatement(enumerationActions);
    if (enumerationStatement) {
      statements.push(enumerationStatement);
    }

    if (tier.constructId === 'support-diag') {
      statements.push(this.buildEdgeLogGroupStatement(Stack.of(this)));
    }

    statements.push(this.buildCloudFormationReadStatement());

    return statements;
  }

  private buildHopRoleAssumeStatement(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: Object.values(this.tierArns),
    });
  }

  /** Resource-naming actions, scoped by the root-stack tag condition. */
  private buildTagScopedStatement(actions: string[]): iam.PolicyStatement | undefined {
    if (actions.length === 0) {
      return undefined;
    }
    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions,
      resources: ['*'],
      conditions: {
        StringEquals: rootStackResourceTagCondition(Aws.STACK_NAME),
      },
    });
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
  private buildEdgeLogGroupStatement(stack: Stack): iam.PolicyStatement {
    const edgeLogGroupArn = Fn.join('', [
      'arn:aws:logs:*:',
      stack.account,
      ':log-group:/serverlessinbox/',
      Aws.STACK_NAME,
      '/jmap-',
      StackIdentity.guidPrefix,
      ':*',
    ]);

    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
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
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudformation:DescribeStacks',
        'cloudformation:ListStackResources',
        'cloudformation:DescribeStackEvents',
        // The console renders its resource tree from the CDK metadata inside the
        // template body, so viewing it requires reading the template itself.
        'cloudformation:GetTemplate',
        // The console renders its resource tree from the CDK metadata inside the
        // template body, so viewing it requires reading the template itself.
        'cloudformation:GetTemplateSummary',
      ],
      resources: [
        Aws.STACK_ID,
        `arn:aws:cloudformation:${Aws.REGION}:${Aws.ACCOUNT_ID}:stack/${Aws.STACK_NAME}-*/*`,
      ],
    });
  }
}

/** The IAM tag key of every support tier, in registry order. */
export function getSupportTierTagKeys(): string[] {
  return SUPPORT_TIERS.map((tier) => tier.tagKey);
}

function tagKeyForTier(constructId: SupportTierId): string {
  const tier = SUPPORT_TIERS.find((t) => t.constructId === constructId);
  if (!tier) {
    throw new Error(`Unknown support tier constructId: ${constructId}`);
  }
  return tier.tagKey;
}

/** The support-diag tier's IAM tag key, sourced from the tier registry — never re-declare this string. */
export const SUPPORT_DIAG_TAG_KEY = tagKeyForTier('support-diag');

/** The support-config-read tier's IAM tag key, sourced from the tier registry — never re-declare this string. */
export const SUPPORT_CONFIG_READ_TAG_KEY = tagKeyForTier('support-config-read');

/**
 * Maps each tier's environment variable name to its role ARN, in registry order.
 *
 * @param tierRoleArns A map of tier constructId to role ARN, typically from SupportRolesInfra.tierArns
 */
export function buildSupportTierEnvironment(tierRoleArns: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const tier of SUPPORT_TIERS) {
    env[tier.envVarName] = tierRoleArns[tier.constructId];
  }
  return env;
}
