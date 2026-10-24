// Zones of packages/mailbox/src. A file's zone comes from its path below src/ (zone-classifier.ts).
// The matrix gives the verdict for an importing file's zone and the zone of the import target.

const platformOnlyLambdaNames = [
  'artifact-updater-lambda',
  'license-refresher-lambda',
  'resource-sweeper-starter-lambda',
  'resource-sweeper-worker-lambda',
  'stack-failure-detector-lambda',
  'stack-update-api-lambda',
  'support-api-lambda',
  'support-role-assumption-collector-lambda',
];

const platformOnlyEventNames = ['artifact-update-schedule', 'license-refresh-schedule', 'stack-failed-event', 'support-collection-schedule'];

// Lambda wrappers and the sweeper workflow that only the platform zone may use.
export const platformOnlyPaths: readonly string[] = [...platformOnlyLambdaNames.map((name) => `resources/lambdas/${name}`), 'resources/workflows/sweeper-workflow'];

export const platformOnlyEventPaths: readonly string[] = platformOnlyEventNames.map((name) => `resources/events/${name}`);

// The three contract files outside core/ that platform files and platform-list files may import.
export const contractResourcePaths: readonly string[] = [
  'resources/tables/data-tables',
  'resources/queues/audit-events-queue',
  'resources/lambdas/identity-provisioner-lambda',
];

export const importerZones = ['core', 'platform', 'platform-list', 'resources', 'contracts', 'other'] as const;

export type ImporterZone = (typeof importerZones)[number];

export const targetZones = [
  'core-addons',
  'core-auth-types',
  'core',
  'platform',
  'platform-list',
  'platform-list-event',
  'contract-resource',
  'resources',
  'contracts',
  'utils-runtime',
  'other',
  'foreign',
] as const;

export type TargetZone = (typeof targetZones)[number];

export const verdicts = ['allow', 'typeOnly', 'forbid'] as const;

export type Verdict = (typeof verdicts)[number];

export type ZoneCell = readonly [ImporterZone, TargetZone, Verdict];

// typeOnly: allowed only as import type. forbid: never. Platform-list rows apply to relative imports only.
export const zoneMatrix: readonly ZoneCell[] = [
  ['core', 'core-addons', 'allow'],
  ['core', 'core-auth-types', 'allow'],
  ['core', 'core', 'allow'],
  ['core', 'platform', 'forbid'],
  ['core', 'platform-list', 'forbid'],
  ['core', 'platform-list-event', 'forbid'],
  ['core', 'contract-resource', 'allow'],
  ['core', 'resources', 'allow'],
  ['core', 'contracts', 'allow'],
  ['core', 'utils-runtime', 'allow'],
  ['core', 'other', 'allow'],
  ['core', 'foreign', 'allow'],
  ['platform', 'core-addons', 'allow'],
  ['platform', 'core-auth-types', 'forbid'],
  ['platform', 'core', 'forbid'],
  ['platform', 'platform', 'allow'],
  ['platform', 'platform-list', 'allow'],
  ['platform', 'platform-list-event', 'allow'],
  ['platform', 'contract-resource', 'allow'],
  ['platform', 'resources', 'forbid'],
  ['platform', 'contracts', 'allow'],
  ['platform', 'utils-runtime', 'allow'],
  ['platform', 'other', 'allow'],
  ['platform', 'foreign', 'allow'],
  ['platform-list', 'core-addons', 'allow'],
  ['platform-list', 'core-auth-types', 'forbid'],
  ['platform-list', 'core', 'forbid'],
  ['platform-list', 'platform', 'allow'],
  ['platform-list', 'platform-list', 'forbid'],
  ['platform-list', 'platform-list-event', 'allow'],
  ['platform-list', 'contract-resource', 'allow'],
  ['platform-list', 'resources', 'forbid'],
  ['platform-list', 'contracts', 'allow'],
  ['platform-list', 'utils-runtime', 'allow'],
  ['platform-list', 'other', 'forbid'],
  ['platform-list', 'foreign', 'forbid'],
  ['resources', 'core-addons', 'typeOnly'],
  ['resources', 'core-auth-types', 'allow'],
  ['resources', 'core', 'typeOnly'],
  ['resources', 'platform', 'typeOnly'],
  ['resources', 'platform-list', 'forbid'],
  ['resources', 'platform-list-event', 'forbid'],
  ['resources', 'contract-resource', 'allow'],
  ['resources', 'resources', 'allow'],
  ['resources', 'contracts', 'allow'],
  ['resources', 'utils-runtime', 'allow'],
  ['resources', 'other', 'allow'],
  ['resources', 'foreign', 'allow'],
  ['contracts', 'core-addons', 'forbid'],
  ['contracts', 'core-auth-types', 'forbid'],
  ['contracts', 'core', 'forbid'],
  ['contracts', 'platform', 'forbid'],
  ['contracts', 'platform-list', 'allow'],
  ['contracts', 'platform-list-event', 'allow'],
  ['contracts', 'contract-resource', 'allow'],
  ['contracts', 'resources', 'allow'],
  ['contracts', 'contracts', 'allow'],
  ['contracts', 'utils-runtime', 'allow'],
  ['contracts', 'other', 'allow'],
  ['contracts', 'foreign', 'allow'],
  ['other', 'core-addons', 'allow'],
  ['other', 'core-auth-types', 'allow'],
  ['other', 'core', 'allow'],
  ['other', 'platform', 'allow'],
  ['other', 'platform-list', 'allow'],
  ['other', 'platform-list-event', 'allow'],
  ['other', 'contract-resource', 'allow'],
  ['other', 'resources', 'allow'],
  ['other', 'contracts', 'allow'],
  ['other', 'utils-runtime', 'allow'],
  ['other', 'other', 'allow'],
  ['other', 'foreign', 'allow'],
];
