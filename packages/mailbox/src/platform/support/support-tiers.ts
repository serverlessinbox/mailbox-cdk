/** Construct id of a support tier's role. */
export type SupportTierId = 'support-diag' | 'support-config-read';

/** One support access tier: the role it gets, the trust tag that gates it and the actions it may use. */
export interface SupportTier {
  /** Determines the role's logical ID, so changing it replaces the role. */
  readonly constructId:       SupportTierId;
  /** Role name slug used in the role's name. */
  readonly roleNameSlug:      string;
  /** IAM tag key the tier role's trust policy is conditioned on. */
  readonly tagKey:           string;
  readonly inlinePolicyName: string;
  readonly actions:          string[];
  /** Whether the tier may read the edge log group, which carries no tag a condition could match. */
  readonly readsEdgeLogGroup: boolean;
  readonly description:       string;
}

/** Tier 1, support-diag: observability only (CloudWatch Logs and metrics). */
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

/** Tier 2 on top of tier 1, support-config-read: infrastructure configuration reads. */
const SUPPORT_CONFIG_READ_ADDITIONAL_ALLOWED_ACTIONS = [
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

/** The actions that declare no resource type, so a resource tag condition cannot bind to them. */
export const ENUMERATION_AND_ACCOUNT_LEVEL_ACTIONS = [
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

/** The diagnostics tier. */
export const SUPPORT_DIAG_TIER: SupportTier = {
  constructId:       'support-diag',
  roleNameSlug:      'diag',
  tagKey:            'serverless-inbox:support:diag',
  inlinePolicyName:  'support-diag-access',
  actions:           SUPPORT_DIAG_ALLOWED_ACTIONS,
  readsEdgeLogGroup: true,
  description:       'Support access role for diagnostics (CloudWatch, Lambda, Step Functions, DynamoDB, SQS introspection). Trust scoped by hop role serverless-inbox:support:diag tag.',
};

/** The configuration-reading tier: everything the diagnostics tier may do plus configuration reads. */
export const SUPPORT_CONFIG_READ_TIER: SupportTier = {
  constructId:       'support-config-read',
  roleNameSlug:      'config-read',
  tagKey:            'serverless-inbox:support:config-read',
  inlinePolicyName:  'support-config-read-access',
  actions:           [...SUPPORT_DIAG_ALLOWED_ACTIONS, ...SUPPORT_CONFIG_READ_ADDITIONAL_ALLOWED_ACTIONS],
  readsEdgeLogGroup: false,
  description:       'Support access role for config reading (DynamoDB config table, stack parameters). Trust scoped by hop role serverless-inbox:support:config-read tag.',
};

/** The support tiers. Order is significant: roles are created in this order. */
export const SUPPORT_TIERS: SupportTier[] = [SUPPORT_DIAG_TIER, SUPPORT_CONFIG_READ_TIER];
