/**
 * Walks a synthesized CloudFormation template and produces a normalized, stable-keyed
 * snapshot of every Lambda function's, IAM role's, and resource policy's effective
 * permissions.
 *
 * TEMPORARY: Grant Concept Phase 0 gate (removed in Phase 13). Keys are derived from
 * stable identity — the `serverless-inbox:artifact-name` tag plus the `SERVICE_NAME` env
 * var for Lambdas (both written by `TypeScriptLambda`/`GoLambda`, never the CloudFormation
 * logical ID), the owning function/state-machine for roles, a deterministic physical name
 * where one exists, or an `aws:cdk:path`-derived fallback — so a pure construct-tree move
 * (an intentional part of this refactor) never registers as a permission diff.
 *
 * Duplicated (not shared/imported) in `mailbox-cognito`'s own `__tests__` directory per
 * the Phase 0 spec: one helper copy per package, both deleted in Phase 13.
 */

import * as cdk from 'aws-cdk-lib';

export type NormalizedValue =
  | string
  | number
  | boolean
  | null
  | NormalizedValue[]
  | { readonly [key: string]: NormalizedValue }
  | NormalizedRef;

export interface NormalizedRef {
  readonly ref: string;
  readonly attr?: string;
}

export interface EventSourceEntry {
  readonly sourceKey: string;
  readonly batchSize?: number;
  readonly batchWindow?: number;
  readonly reportBatchItemFailures: boolean;
}

export interface FunctionSnapshotEntry {
  readonly envVarNames: string[];
  readonly eventSources: EventSourceEntry[];
  readonly roleKey: string;
}

export interface RoleSnapshotEntry {
  readonly trustPolicy: NormalizedValue;
  readonly managedPolicyArns: NormalizedValue[];
  readonly permissionsBoundary: NormalizedValue | null;
  readonly statements: NormalizedValue[];
}

export interface ResourcePolicySnapshotEntry {
  readonly type: string;
  readonly statements: NormalizedValue[];
}

export interface PermissionSnapshot {
  readonly functions: Record<string, FunctionSnapshotEntry>;
  readonly roles: Record<string, RoleSnapshotEntry>;
  readonly resourcePolicies: Record<string, ResourcePolicySnapshotEntry>;
}

type CfnResource = { Type: string; Properties?: Record<string, any>; Metadata?: Record<string, any> };
type CfnTemplate = { Resources?: Record<string, CfnResource>; Parameters?: Record<string, any> };

const ARTIFACT_NAME_TAG_KEY = 'serverless-inbox:artifact-name';

const PSEUDO_PARAMS = new Set([
  'AWS::AccountId',
  'AWS::Region',
  'AWS::Partition',
  'AWS::StackName',
  'AWS::StackId',
  'AWS::URLSuffix',
  'AWS::NoValue',
  'AWS::NotificationARNs',
]);

const NAME_PROP_BY_TYPE: Record<string, string> = {
  'AWS::DynamoDB::Table': 'TableName',
  'AWS::S3::Bucket': 'BucketName',
  'AWS::SQS::Queue': 'QueueName',
  'AWS::SNS::Topic': 'TopicName',
  'AWS::StepFunctions::StateMachine': 'StateMachineName',
  'AWS::Logs::LogGroup': 'LogGroupName',
  'AWS::SSM::Parameter': 'Name',
  'AWS::ApiGateway::RestApi': 'Name',
  'AWS::ApiGatewayV2::Api': 'Name',
  'AWS::Cognito::UserPool': 'UserPoolName',
};

const TYPE_PREFIX_BY_TYPE: Record<string, string> = {
  'AWS::DynamoDB::Table': 'table',
  'AWS::S3::Bucket': 'bucket',
  'AWS::SQS::Queue': 'queue',
  'AWS::SNS::Topic': 'topic',
  'AWS::StepFunctions::StateMachine': 'statemachine',
  'AWS::Logs::LogGroup': 'loggroup',
  'AWS::SSM::Parameter': 'ssmparam',
  'AWS::ApiGateway::RestApi': 'api',
  'AWS::ApiGatewayV2::Api': 'api',
  'AWS::Cognito::UserPool': 'userpool',
};

function sortDeep(v: any): any {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

function canonicalJSON(v: any): string {
  return JSON.stringify(sortDeep(v));
}

function sortByCanonicalJSON<T>(items: T[]): T[] {
  return [...items].sort((a, b) => canonicalJSON(a).localeCompare(canonicalJSON(b)));
}

/**
 * `aws:cdk:path` reflects the construct tree, not the (churning) logical ID, so a
 * resource with no other deterministic identity keys off it instead.
 */
function cdkPathKey(logicalId: string, resource: CfnResource): string {
  const path = resource.Metadata?.['aws:cdk:path'];
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(
      `Cannot derive a stable key for ${resource.Type} "${logicalId}": no artifact-name tag/SERVICE_NAME ` +
        `env, no deterministic physical name, and no "aws:cdk:path" metadata to fall back to.`,
    );
  }
  const parts = path.split('/');
  parts.shift();
  while (parts.length > 1 && (parts[parts.length - 1] === 'Resource' || parts[parts.length - 1] === 'Default')) {
    parts.pop();
  }
  return `fallback:${parts.join('/')}`;
}

function tagValue(props: Record<string, any> | undefined, key: string): string | undefined {
  const tags = props?.Tags;
  if (!Array.isArray(tags)) return undefined;
  const found = tags.find((t) => t && typeof t === 'object' && t.Key === key);
  return found && typeof found.Value === 'string' ? found.Value : undefined;
}

function functionKey(logicalId: string, resource: CfnResource): string {
  const props = resource.Properties ?? {};
  const artifactName = tagValue(props, ARTIFACT_NAME_TAG_KEY);
  const serviceName = props.Environment?.Variables?.SERVICE_NAME;
  if (typeof artifactName === 'string' && typeof serviceName === 'string') {
    return `fn:${artifactName}:${serviceName}`;
  }
  return cdkPathKey(logicalId, resource);
}

function otherResourceKey(logicalId: string, resource: CfnResource): string {
  const nameProp = NAME_PROP_BY_TYPE[resource.Type];
  if (nameProp) {
    const value = resource.Properties?.[nameProp];
    if (typeof value === 'string') {
      return `${TYPE_PREFIX_BY_TYPE[resource.Type]}:${value}`;
    }
  }
  return cdkPathKey(logicalId, resource);
}

function refTarget(value: any): string | undefined {
  if (value && typeof value === 'object') {
    if (typeof value.Ref === 'string') return value.Ref;
    if (Array.isArray(value['Fn::GetAtt'])) return value['Fn::GetAtt'][0];
    if (typeof value['Fn::GetAtt'] === 'string') return value['Fn::GetAtt'].split('.')[0];
  }
  return undefined;
}

interface KeyMap {
  readonly byLogicalId: Map<string, string>;
}

function findOwningLogicalId(
  resources: Record<string, CfnResource>,
  ownerType: string,
  pointsAt: (ownerResource: CfnResource) => string | undefined,
  targetLogicalId: string,
): string | undefined {
  const match = Object.entries(resources).find(
    ([, r]) => r.Type === ownerType && pointsAt(r) === targetLogicalId,
  );
  return match?.[0];
}

function roleKeyFor(logicalId: string, resource: CfnResource, resources: Record<string, CfnResource>, byLogicalId: Map<string, string>): string {
  const owningFunctionId = findOwningLogicalId(resources, 'AWS::Lambda::Function', (r) => refTarget(r.Properties?.Role), logicalId);
  if (owningFunctionId) return `role:${byLogicalId.get(owningFunctionId)}`;

  const owningStateMachineId = findOwningLogicalId(
    resources,
    'AWS::StepFunctions::StateMachine',
    (r) => refTarget(r.Properties?.RoleArn),
    logicalId,
  );
  if (owningStateMachineId) return `role:${byLogicalId.get(owningStateMachineId)}`;

  const roleName = resource.Properties?.RoleName;
  if (typeof roleName === 'string') return `role:name:${roleName}`;

  return `role:${cdkPathKey(logicalId, resource)}`;
}

function assertNoKeyCollisions(byLogicalId: Map<string, string>): void {
  const seen = new Map<string, string>();
  for (const [logicalId, key] of byLogicalId.entries()) {
    const existing = seen.get(key);
    if (existing !== undefined && existing !== logicalId) {
      throw new Error(
        `Stable key collision: "${key}" is produced by both "${existing}" and "${logicalId}". ` +
          `Each resource must resolve to a unique key.`,
      );
    }
    seen.set(key, logicalId);
  }
}

function buildKeyMap(template: CfnTemplate): KeyMap {
  const resources = template.Resources ?? {};
  const byLogicalId = new Map<string, string>();

  for (const paramName of Object.keys(template.Parameters ?? {})) {
    byLogicalId.set(paramName, `param:${paramName}`);
  }

  for (const [logicalId, resource] of Object.entries(resources)) {
    if (resource.Type === 'AWS::IAM::Role') continue;
    byLogicalId.set(
      logicalId,
      resource.Type === 'AWS::Lambda::Function' ? functionKey(logicalId, resource) : otherResourceKey(logicalId, resource),
    );
  }

  for (const [logicalId, resource] of Object.entries(resources)) {
    if (resource.Type !== 'AWS::IAM::Role') continue;
    byLogicalId.set(logicalId, roleKeyFor(logicalId, resource, resources, byLogicalId));
  }

  assertNoKeyCollisions(byLogicalId);
  return { byLogicalId };
}

function resolveLogicalId(logicalId: string, keyMap: KeyMap): string {
  if (PSEUDO_PARAMS.has(logicalId)) return logicalId;
  const key = keyMap.byLogicalId.get(logicalId);
  if (key === undefined) {
    throw new Error(`Unresolvable logical-ID reference: "${logicalId}" has no stable key.`);
  }
  return key;
}

const SUB_TOKEN_RE = /\$\{([^}!][^}]*)\}/g;

function normalizeSubString(template: string, keyMap: KeyMap, localVars: Set<string>): string {
  return template.replace(SUB_TOKEN_RE, (whole, token: string) => {
    const trimmed = token.trim();
    if (localVars.has(trimmed)) return whole;
    const [logicalId, ...attrParts] = trimmed.split('.');
    if (PSEUDO_PARAMS.has(logicalId)) return whole;
    const key = resolveLogicalId(logicalId, keyMap);
    return attrParts.length > 0 ? `\${ref:${key}.${attrParts.join('.')}}` : `\${ref:${key}}`;
  });
}

function normalizeValue(value: any, keyMap: KeyMap): NormalizedValue {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => normalizeValue(v, keyMap));
  }

  if (typeof value.Ref === 'string') {
    return { ref: resolveLogicalId(value.Ref, keyMap) };
  }
  if (Array.isArray(value['Fn::GetAtt'])) {
    const [logicalId, attr] = value['Fn::GetAtt'];
    return { ref: resolveLogicalId(logicalId, keyMap), attr };
  }
  if (typeof value['Fn::GetAtt'] === 'string') {
    const [logicalId, ...attr] = value['Fn::GetAtt'].split('.');
    return { ref: resolveLogicalId(logicalId, keyMap), attr: attr.join('.') };
  }
  if (typeof value['Fn::Sub'] === 'string') {
    return { 'Fn::Sub': normalizeSubString(value['Fn::Sub'], keyMap, new Set()) };
  }
  if (Array.isArray(value['Fn::Sub'])) {
    const [template, vars] = value['Fn::Sub'];
    const localVars = new Set(Object.keys(vars ?? {}));
    const normalizedVars: Record<string, NormalizedValue> = {};
    for (const [k, v] of Object.entries(vars ?? {})) normalizedVars[k] = normalizeValue(v, keyMap);
    return { 'Fn::Sub': normalizeSubString(template, keyMap, localVars), vars: normalizedVars };
  }
  if (Array.isArray(value['Fn::Join'])) {
    const [delimiter, parts] = value['Fn::Join'];
    return { 'Fn::Join': [delimiter, (parts as any[]).map((p) => normalizeValue(p, keyMap))] };
  }

  const result: Record<string, NormalizedValue> = {};
  for (const [k, v] of Object.entries(value)) {
    result[k] = normalizeValue(v, keyMap);
  }
  return result;
}

const SORTABLE_LIST_KEYS = ['Action', 'NotAction', 'Resource', 'NotResource'];

function normalizeStatement(stmt: Record<string, any>, keyMap: KeyMap): NormalizedValue {
  const normalized = normalizeValue(stmt, keyMap) as Record<string, NormalizedValue>;
  const out: Record<string, NormalizedValue> = { ...normalized };
  for (const listKey of SORTABLE_LIST_KEYS) {
    const v = out[listKey];
    if (Array.isArray(v)) {
      out[listKey] = sortByCanonicalJSON(v);
    }
  }
  return out;
}

function normalizeStatements(statements: any[] | undefined, keyMap: KeyMap): NormalizedValue[] {
  if (!Array.isArray(statements)) return [];
  return sortByCanonicalJSON(statements.map((s) => normalizeStatement(s, keyMap)));
}

function indexEventSourceMappingsByFunction(resources: Record<string, CfnResource>): Map<string, CfnResource[]> {
  const byFunctionLogicalId = new Map<string, CfnResource[]>();
  for (const resource of Object.values(resources)) {
    if (resource.Type !== 'AWS::Lambda::EventSourceMapping') continue;
    const targetLogicalId = refTarget(resource.Properties?.FunctionName);
    if (targetLogicalId === undefined) {
      throw new Error('AWS::Lambda::EventSourceMapping.FunctionName does not reference a known function.');
    }
    const list = byFunctionLogicalId.get(targetLogicalId) ?? [];
    list.push(resource);
    byFunctionLogicalId.set(targetLogicalId, list);
  }
  return byFunctionLogicalId;
}

function eventSourceEntryFor(esm: CfnResource, logicalId: string, keyMap: KeyMap): EventSourceEntry {
  const esmProps = esm.Properties ?? {};
  const eventSourceArn = esmProps.EventSourceArn;
  const targetLogicalId = refTarget(eventSourceArn);
  let sourceKey: string;
  if (targetLogicalId !== undefined) {
    sourceKey = resolveLogicalId(targetLogicalId, keyMap);
  } else if (typeof eventSourceArn === 'string') {
    sourceKey = `literal:${eventSourceArn}`;
  } else {
    throw new Error(`Unresolvable EventSourceArn on an event source mapping for "${logicalId}".`);
  }
  const responseTypes: string[] = esmProps.FunctionResponseTypes ?? [];
  return {
    sourceKey,
    batchSize: esmProps.BatchSize,
    batchWindow: esmProps.MaximumBatchingWindowInSeconds,
    reportBatchItemFailures: responseTypes.includes('ReportBatchItemFailures'),
  };
}

function extractFunctions(resources: Record<string, CfnResource>, keyMap: KeyMap): Record<string, FunctionSnapshotEntry> {
  const out: Record<string, FunctionSnapshotEntry> = {};
  const esmsByFunctionLogicalId = indexEventSourceMappingsByFunction(resources);

  for (const [logicalId, resource] of Object.entries(resources)) {
    if (resource.Type !== 'AWS::Lambda::Function') continue;
    const key = keyMap.byLogicalId.get(logicalId);
    if (key === undefined) throw new Error(`No stable key computed for function "${logicalId}".`);

    const props = resource.Properties ?? {};
    const envVarNames = Object.keys(props.Environment?.Variables ?? {}).sort();
    const roleLogicalId = refTarget(props.Role);
    const roleKey = roleLogicalId !== undefined ? resolveLogicalId(roleLogicalId, keyMap) : `unmanaged-role:${key}`;
    const eventSources = (esmsByFunctionLogicalId.get(logicalId) ?? []).map((esm) => eventSourceEntryFor(esm, logicalId, keyMap));

    out[key] = { envVarNames, eventSources: sortByCanonicalJSON(eventSources), roleKey };
  }

  return out;
}

function attachedRoleLogicalIdsFromRolesProp(rolesProp: any[] | undefined, resources: Record<string, CfnResource>): string[] {
  const out: string[] = [];
  for (const entry of rolesProp ?? []) {
    const direct = refTarget(entry);
    if (direct !== undefined) {
      out.push(direct);
      continue;
    }
    if (typeof entry === 'string') {
      const match = Object.entries(resources).find(([, r]) => r.Type === 'AWS::IAM::Role' && r.Properties?.RoleName === entry);
      if (match) out.push(match[0]);
    }
  }
  return out;
}

/**
 * A role's statements can arrive from three CloudFormation shapes: a standalone
 * `AWS::IAM::Policy`/`AWS::IAM::ManagedPolicy` pointing at the role via `Roles`, a
 * `ManagedPolicyArns` entry pointing the other way at a `ManagedPolicy` resource, or a
 * `Policies` list inlined directly on the role. All three are merged into one bucket per
 * role so the snapshot reflects the role's total effective permissions regardless of
 * which shape a given phase happens to produce.
 */
function collectStatementsByRoleLogicalId(resources: Record<string, CfnResource>): Map<string, any[]> {
  const byRole = new Map<string, any[]>();
  const push = (roleLogicalId: string, statements: any[] | undefined) => {
    const list = byRole.get(roleLogicalId) ?? [];
    list.push(...(statements ?? []));
    byRole.set(roleLogicalId, list);
  };

  for (const resource of Object.values(resources)) {
    if (resource.Type !== 'AWS::IAM::Policy' && resource.Type !== 'AWS::IAM::ManagedPolicy') continue;
    for (const roleLogicalId of attachedRoleLogicalIdsFromRolesProp(resource.Properties?.Roles, resources)) {
      push(roleLogicalId, resource.Properties?.PolicyDocument?.Statement);
    }
  }

  for (const [roleLogicalId, resource] of Object.entries(resources)) {
    if (resource.Type !== 'AWS::IAM::Role') continue;
    for (const arn of resource.Properties?.ManagedPolicyArns ?? []) {
      const targetLogicalId = refTarget(arn);
      const target = targetLogicalId !== undefined ? resources[targetLogicalId] : undefined;
      if (target?.Type === 'AWS::IAM::ManagedPolicy') {
        push(roleLogicalId, target.Properties?.PolicyDocument?.Statement);
      }
    }
    for (const inline of resource.Properties?.Policies ?? []) {
      push(roleLogicalId, inline.PolicyDocument?.Statement);
    }
  }

  return byRole;
}

function extractRoles(resources: Record<string, CfnResource>, keyMap: KeyMap): Record<string, RoleSnapshotEntry> {
  const statementsByRoleLogicalId = collectStatementsByRoleLogicalId(resources);

  const out: Record<string, RoleSnapshotEntry> = {};
  for (const [logicalId, resource] of Object.entries(resources)) {
    if (resource.Type !== 'AWS::IAM::Role') continue;
    const key = keyMap.byLogicalId.get(logicalId);
    if (key === undefined) throw new Error(`No stable key computed for role "${logicalId}".`);

    const props = resource.Properties ?? {};
    out[key] = {
      trustPolicy: normalizeStatements(props.AssumeRolePolicyDocument?.Statement, keyMap),
      managedPolicyArns: sortByCanonicalJSON((props.ManagedPolicyArns ?? []).map((a: any) => normalizeValue(a, keyMap))),
      permissionsBoundary: props.PermissionsBoundary !== undefined ? normalizeValue(props.PermissionsBoundary, keyMap) : null,
      statements: normalizeStatements(statementsByRoleLogicalId.get(logicalId), keyMap),
    };
  }

  return out;
}

const RESOURCE_POLICY_TYPES: Record<string, { statementsPath: (props: any) => any[] | undefined; targetProp: string }> = {
  'AWS::S3::BucketPolicy': { statementsPath: (p) => p.PolicyDocument?.Statement, targetProp: 'Bucket' },
  'AWS::SQS::QueuePolicy': { statementsPath: (p) => p.PolicyDocument?.Statement, targetProp: 'Queues' },
  'AWS::SNS::TopicPolicy': { statementsPath: (p) => p.PolicyDocument?.Statement, targetProp: 'Topics' },
};

function resolvePolicyTarget(props: any, targetProp: string, keyMap: KeyMap): string {
  const raw = props[targetProp];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const targetLogicalId = refTarget(value);
  if (targetLogicalId === undefined) {
    throw new Error(`Cannot resolve resource-policy target for prop "${targetProp}".`);
  }
  return resolveLogicalId(targetLogicalId, keyMap);
}

function mergeResourcePolicy(merged: Map<string, { type: string; statements: any[] }>, key: string, type: string, statements: any[] | undefined): void {
  const existing = merged.get(key);
  if (existing) {
    existing.statements.push(...(statements ?? []));
  } else {
    merged.set(key, { type, statements: [...(statements ?? [])] });
  }
}

function extractResourcePolicies(resources: Record<string, CfnResource>, keyMap: KeyMap): Record<string, ResourcePolicySnapshotEntry> {
  const merged = new Map<string, { type: string; statements: any[] }>();

  for (const resource of Object.values(resources)) {
    const config = RESOURCE_POLICY_TYPES[resource.Type];
    if (!config) continue;
    const targetKey = resolvePolicyTarget(resource.Properties ?? {}, config.targetProp, keyMap);
    mergeResourcePolicy(merged, `${resource.Type}:${targetKey}`, resource.Type, config.statementsPath(resource.Properties ?? {}));
  }

  for (const resource of Object.values(resources)) {
    if (resource.Type !== 'AWS::Lambda::Permission') continue;
    const props = resource.Properties ?? {};
    const targetLogicalId = refTarget(props.FunctionName);
    const targetKey = targetLogicalId !== undefined ? resolveLogicalId(targetLogicalId, keyMap) : 'unknown-function';
    mergeResourcePolicy(merged, `AWS::Lambda::Permission:${targetKey}`, 'AWS::Lambda::Permission', [
      {
        Effect: 'Allow',
        Action: props.Action,
        Principal: props.Principal,
        SourceArn: props.SourceArn,
        SourceAccount: props.SourceAccount,
      },
    ]);
  }

  for (const [logicalId, resource] of Object.entries(resources)) {
    if (resource.Type !== 'AWS::KMS::Key') continue;
    const targetKey = keyMap.byLogicalId.get(logicalId);
    if (targetKey === undefined) throw new Error(`No stable key computed for KMS key "${logicalId}".`);
    mergeResourcePolicy(merged, `AWS::KMS::Key:${targetKey}`, 'AWS::KMS::Key', resource.Properties?.KeyPolicy?.Statement);
  }

  const out: Record<string, ResourcePolicySnapshotEntry> = {};
  for (const [key, { type, statements }] of merged.entries()) {
    out[key] = { type, statements: normalizeStatements(statements, keyMap) };
  }
  return out;
}

function captureFromTemplate(template: CfnTemplate): PermissionSnapshot {
  const resources = template.Resources ?? {};
  const keyMap = buildKeyMap(template);

  const functions = extractFunctions(resources, keyMap);
  const roles = extractRoles(resources, keyMap);
  const resourcePolicies = extractResourcePolicies(resources, keyMap);

  const functionCount = Object.values(resources).filter((r) => r.Type === 'AWS::Lambda::Function').length;
  const roleCount = Object.values(resources).filter((r) => r.Type === 'AWS::IAM::Role').length;
  if (Object.keys(functions).length !== functionCount) {
    throw new Error(
      `Completeness guard failed: template has ${functionCount} AWS::Lambda::Function resources but snapshot captured ${Object.keys(functions).length}.`,
    );
  }
  if (Object.keys(roles).length !== roleCount) {
    throw new Error(
      `Completeness guard failed: template has ${roleCount} AWS::IAM::Role resources but snapshot captured ${Object.keys(roles).length}.`,
    );
  }

  return { functions, roles, resourcePolicies };
}

/**
 * `Template.fromStack()` strips each resource's `Metadata` (including `aws:cdk:path`),
 * which the fallback key derivation needs — so this reads the raw synthesized template
 * from the cloud assembly instead. The stack's `App` must be constructed with
 * `{ context: { 'aws:cdk:enable-path-metadata': true } }`, or path metadata is never
 * emitted at all and every resource without a deterministic identity throws.
 */
export function capturePermissionSnapshot(stack: cdk.Stack): PermissionSnapshot {
  const assembly = cdk.App.of(stack)!.synth();
  const template = assembly.getStackArtifact(stack.artifactId).template as CfnTemplate;
  return captureFromTemplate(template);
}

/** Used by this helper's own self-tests, which build synthetic CloudFormation JSON directly. */
export function capturePermissionSnapshotFromTemplateJson(templateJson: CfnTemplate): PermissionSnapshot {
  return captureFromTemplate(templateJson);
}

export function compareSnapshots(current: PermissionSnapshot, baseline: PermissionSnapshot): { matches: boolean; diff?: string } {
  const currentStr = JSON.stringify(sortDeep(current), null, 2);
  const baselineStr = JSON.stringify(sortDeep(baseline), null, 2);
  if (currentStr === baselineStr) return { matches: true };

  const currentLines = currentStr.split('\n');
  const baselineLines = baselineStr.split('\n');
  const diffs: string[] = [];
  const maxLen = Math.max(currentLines.length, baselineLines.length);
  for (let i = 0; i < maxLen; i++) {
    const curr = currentLines[i] ?? '';
    const base = baselineLines[i] ?? '';
    if (curr !== base) {
      diffs.push(`Line ${i + 1}:`, `  - ${base}`, `  + ${curr}`);
      if (diffs.length > 300) {
        diffs.push('... (truncated)');
        break;
      }
    }
  }
  return { matches: false, diff: diffs.join('\n') };
}

export function serializeSnapshot(snapshot: PermissionSnapshot): string {
  return JSON.stringify(sortDeep(snapshot), null, 2);
}
