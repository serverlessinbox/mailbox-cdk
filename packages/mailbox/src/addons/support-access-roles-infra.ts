import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Fn, Aws, Stack, Duration } from 'aws-cdk-lib';
import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';

/**
 * Vendor AWS account ID.
 * It appears in the hop role's static trust policy (as :root principal) and is customer-readable in the template.
 */
export const VENDOR_ACCOUNT_ID = '791990038981';

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
  'cloudformation:DescribeStacks',
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

/**
 * Support tier descriptor.
 * Drives tier-specific role creation, policies, trust conditions, and env var naming.
 */
interface SupportTier {
  /** Construct ID for the role — must match existing values exactly for template stability */
  readonly constructId: string;
  /** Role name slug used in Fn::join construction */
  readonly roleNameSlug: string;
  /** IAM tag key used in trust policy condition */
  readonly tagKey: string;
  /** Inline policy name */
  readonly inlinePolicyName: string;
  /** IAM actions for this tier */
  readonly actions: string[];
  /** Environment variable name for the role ARN */
  readonly envVarName: string;
  /** Role description */
  readonly description: string;
}

/**
 * Registry of support tiers.
 * Order is significant: matches current template (diag before config-read).
 */
const SUPPORT_TIERS: SupportTier[] = [
  {
    constructId: 'support-diag',
    roleNameSlug: 'diag',
    tagKey: 'serverless-inbox:support-access:diag',
    inlinePolicyName: 'support-diag-access',
    actions: SUPPORT_DIAG_ALLOWED_ACTIONS,
    envVarName: 'SUPPORT_DIAG_ROLE_ARN',
    description: 'Support access role for diagnostics (CloudWatch, Lambda, Step Functions, DynamoDB, SQS introspection). Trust scoped by hop role serverless-inbox:support-access:diag tag.',
  },
  {
    constructId: 'support-config-read',
    roleNameSlug: 'config-read',
    tagKey: 'serverless-inbox:support-access:config-read',
    inlinePolicyName: 'support-config-read-access',
    actions: SUPPORT_CONFIG_INSPECT_ALLOWED_ACTIONS,
    envVarName: 'SUPPORT_CONFIG_READ_ROLE_ARN',
    description: 'Support access role for config reading (DynamoDB config table, stack parameters). Trust scoped by hop role serverless-inbox:support-access:config-read tag.',
  },
];

/**
 * Props for SupportAccessRolesInfra.
 */
export interface SupportAccessRolesInfraProps {
  /** Vendor AWS account IDs permitted to assume the support hop role. */
  readonly vendorAccountIds?: string[];
}

/**
 * Support Access IAM roles infrastructure.
 *
 * Creates three roles:
 *
 * 1. support-hop: Intermediate role with static trust to vendor support account.
 *    - Trust policy names vendor account (static, in template, customer-readable)
 *    - Single permission: sts:AssumeRole on the two support roles
 *    - Tagged at runtime by support-access-api for case/window toggles
 *    - Cannot be modified by the lambda beyond tag writes
 *
 * 2. support-diag: Observability access (CloudWatch, Lambda, Step Functions, DynamoDB, SQS).
 *    - Trust policy: static, names hop role with ExternalId and CurrentTime conditions (tag variables)
 *    - MaxSessionDuration: 3600 (1 hour, AWS documented minimum for safe session control)
 *    - Tier-specific inline policy permanently attached (static, immutable from lambda)
 *
 * 3. support-config-read: Read-only config access.
 *    - Trust policy: static, names hop role with ExternalId and CurrentTime conditions (tag variables)
 *    - MaxSessionDuration: 3600 (1 hour, AWS documented minimum for safe session control)
 *    - Tier-specific inline policy permanently attached (static, immutable from lambda)
 */
export class SupportAccessRolesInfra extends Construct {
  readonly supportHopRoleArn: string;
  readonly tierArns: Record<string, string>;

  constructor(scope: Construct, id: string, props?: SupportAccessRolesInfraProps) {
    super(scope, id);

    const stack = Stack.of(this);

    // Derive stack GUID for uniqueness — fixed for a stack's lifetime, differs after destroy+redeploy.
    // Use only the first 8-character segment (UUID format: 8-4-4-4-12) to stay within the 64-char IAM role-name limit.
    const fullStackGuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
    const stackGuidSegment = Fn.select(0, Fn.split('-', fullStackGuid));

    // Deterministic hop role name with stack GUID segment for uniqueness.
    // Dropping parentGroupId keeps the name length fixed and independent of construct position.
    const supportHopRoleName = Fn.join('', ['support-hop-', stackGuidSegment]);

    // Pre-built hop role ARN using formatArn — required for trust-writer policy scoping.
    this.supportHopRoleArn = stack.formatArn({
      service: 'iam',
      region: '',
      resource: 'role',
      resourceName: supportHopRoleName,
    });

    // Build tier role ARNs indexed by tier name for consumer access
    this.tierArns = {};
    const tierRoleNames: Record<string, string> = {};

    for (const tier of SUPPORT_TIERS) {
      const roleName = Fn.join('', [`support-${tier.roleNameSlug}-`, stackGuidSegment]);
      tierRoleNames[tier.constructId] = roleName;
      this.tierArns[tier.constructId] = stack.formatArn({
        service: 'iam',
        region: '',
        resource: 'role',
        resourceName: roleName,
      });
    }

    // Determine vendor account IDs: use provided ones or default to prod account
    const vendorAccounts = props?.vendorAccountIds && props.vendorAccountIds.length > 0
      ? props.vendorAccountIds
      : [VENDOR_ACCOUNT_ID];

    // Validate that all account IDs are 12-digit strings
    for (const accountId of vendorAccounts) {
      if (!/^\d{12}$/.test(accountId)) {
        throw new Error(
          `Invalid AWS account ID: ${accountId}. Account IDs must be 12-digit strings.`
        );
      }
    }

    // support-hop role: Intermediate hop for vendor support account trust.
    // Static trust to vendor prod account. Only permission: sts:AssumeRole on the two support roles.
    // Tagged at runtime by support-access-api (serverless-inbox:support-access:diag, serverless-inbox:support-access:config-read keys).
    // Cannot be modified by the lambda beyond tag writes.
    const hopRole = new iam.Role(this, 'support-hop', {
      roleName: supportHopRoleName,
      assumedBy: new iam.ServicePrincipal('sts.amazonaws.com'),
      maxSessionDuration: Duration.seconds(3600),
      inlinePolicies: {
        'support-hop-assume': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sts:AssumeRole'],
              resources: Object.values(this.tierArns),
            }),
          ],
        }),
      },
      description: 'Support access hop role. Static trust to vendor support account. Can assume support-diag and support-config-read roles based on runtime tags.',
    });

    // Override the trust policy with vendor account root principals
    // For a single account, use the simple ARN format.
    // For multiple accounts, use the principal list format which is more explicit.
    const hopCfnRole = hopRole.node.defaultChild as iam.CfnRole;
    const vendorPrincipals = vendorAccounts.map(accountId => `arn:aws:iam::${accountId}:root`);

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

    // Create support roles from tier registry, iterating in order for template stability.
    for (const tier of SUPPORT_TIERS) {
      // Categorize actions: enumeration/account-level stay on resources: ['*'];
      // resource-naming actions are scoped by serverless-inbox:root-stack tag condition.
      const tagScopedActions = tier.actions.filter(a => !ENUMERATION_AND_ACCOUNT_LEVEL_ACTIONS.includes(a));
      const enumerationActions = tier.actions.filter(a => ENUMERATION_AND_ACCOUNT_LEVEL_ACTIONS.includes(a));

      const rootStackTagKey = `aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`;

      // Build the exact edge log group ARN for tier 1 — CloudFront service-creates this group
      // in every replica region, untagged and inaccessible by tag conditions.
      // Use the same intrinsics as pipeline-log-groups.ts to ensure exact name match.
      const edgeLogGroupArn = tier.constructId === 'support-diag'
        ? Fn.join('', [
            'arn:aws:logs:*:',
            stack.account,
            ':log-group:/serverlessinbox/',
            Aws.STACK_NAME,
            '/jmap-',
            Fn.select(0, Fn.split('-', Fn.select(2, Fn.split('/', Aws.STACK_ID)))),
            ':*',
          ])
        : '';

      // Construct tag-scoped statement (resource-naming actions only)
      const statements: iam.PolicyStatement[] = [];

      if (tagScopedActions.length > 0) {
        statements.push(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: tagScopedActions,
            resources: ['*'],
            conditions: {
              StringEquals: {
                [rootStackTagKey]: Aws.STACK_NAME,
              },
            },
          })
        );
      }

      // Enumeration/account-level statement stays on resources: ['*'] (cannot bind tag conditions)
      if (enumerationActions.length > 0) {
        statements.push(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: enumerationActions,
            resources: ['*'],
          })
        );
      }

      // Tier 1 specific: separate statement for edge log group log-read actions.
      // These groups are service-created by CloudFront in each replica region and are untagged,
      // so they cannot be reached by tag conditions. Grant log-read actions on the edge group ARN only.
      if (tier.constructId === 'support-diag' && edgeLogGroupArn) {
        const edgeLogGroupActions = [
          'logs:DescribeLogStreams',
          'logs:GetLogEvents',
          'logs:FilterLogEvents',
          'logs:GetLogGroupFields',
          'logs:StartQuery',
          'logs:GetQueryResults',
        ];
        statements.push(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: edgeLogGroupActions,
            resources: [edgeLogGroupArn],
          })
        );
      }

      // Create inline policy for this tier
      const policyDoc = new iam.PolicyDocument({
        statements,
      });

      // Create the role with tier-specific configuration
      const supportRole = new iam.Role(this, tier.constructId, {
        roleName: tierRoleNames[tier.constructId],
        assumedBy: new iam.PrincipalWithConditions(
          new iam.ArnPrincipal(this.supportHopRoleArn),
          {
            StringLike: {
              // Delimiter is '/' not '|': IAM tag values reject '|' (not in [\p{L}\p{Z}\p{N}_.:/=+\-@]).
              // Nanoid IDs use alphabet A-Za-z0-9_- so '/' never appears in case IDs, making it a safe separator.
              [`aws:PrincipalTag/${tier.tagKey}`]: '*/${sts:ExternalId}/*',
            },
          }
        ),
        maxSessionDuration: Duration.seconds(3600),
        inlinePolicies: {
          [tier.inlinePolicyName]: policyDoc,
        },
        description: tier.description,
      });

      // Make the hop role's creation explicit as a hard dependency.
      // Rationale: IAM validates principals in trust policies at creation time; the support role trusts the hop role,
      // so the hop role must exist first. IAM does NOT validate resource ARNs in identity policies, so the hop role
      // (which names the two support role ARNs in its inline policy) can be created before the support roles. Thus
      // the dependency is strictly one-way: hop role first, then support roles.
      supportRole.node.addDependency(hopRole);
    }
  }
}

/**
 * Get the list of tier tag keys (for consumers that need them).
 * Exposed for IAM grant scoping in lambdas.
 */
export function getSupportTierTagKeys(): string[] {
  return SUPPORT_TIERS.map(tier => tier.tagKey);
}

/**
 * Build environment variables for support role tiers.
 * Maps tier environment variable names to their ARNs from the tierRoleArns map.
 * Order is fixed to match the registry order (diag, then config-read) for CloudFormation stability.
 *
 * @param tierRoleArns A map of tier constructId to role ARN, typically from SupportAccessRolesInfra.tierArns
 * @returns An object with SUPPORT_DIAG_ROLE_ARN and SUPPORT_CONFIG_READ_ROLE_ARN
 */
export function buildSupportTierEnvironment(tierRoleArns: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const tier of SUPPORT_TIERS) {
    env[tier.envVarName] = tierRoleArns[tier.constructId];
  }
  return env;
}
