/// <reference types="jest" />

/**
 * MailboxUi.grantContentDeploy / AutoUpdater.grantPrincipal.
 *
 * The UI bucket grants the auto-updater's own principal write access to itself, rather than the
 * updater guessing the bucket's name from a synth-time pattern. This suite pins that the grant
 * actually lands on the updater's own IAM role, scoped to the real bucket the template creates —
 * not a hand-built ARN pattern that could silently diverge from it — and that a non-grantable
 * resolver (PinnedArtifactResolver, the default) leaves the stack with no such statement and synths clean.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Mailbox } from '../../../mailbox';
import { AutoUpdater } from '../auto-updater';
import { MailboxArtifactResolverFactory } from '@serverlessinbox/mailbox-cdk-shared';
import { loadMailboxRegistryRecord } from '../../../mailbox-registry-record';
import { loadMailboxArtifactVersions } from '../../../mailbox-artifact-versions';
import type { IMailboxAuthProvider } from '../../../auth/types';
import { Permission } from '../../../auth/jmap-scopes';
import { CloudFormationResource, CloudFormationPolicyStatement, getPolicyStatements, isResourceOfType } from '../../../__tests__/iam-test-helpers';

const ARTIFACT_CONTEXT = {
  bucketBase: 'test-artifacts',
  packages: {
    'mailbox-go': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk-shared': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk-edge': { zone: 'edge', version: '1.0.0' },
    'mailbox-admin-ui': { zone: 'regional', version: '1.0.0' },
    'mailbox-webmail-ui': { zone: 'regional', version: '1.0.0' },
  },
};

function createMockAuthProvider(): IMailboxAuthProvider {
  return {
    issuer: 'https://example.com/issuer',
    tokenEndpoint: 'https://example.com/token',
    authorizationEndpoint: 'https://example.com/authorize',
    authMethod: 'header',
    usePkce: false,
    scopeMap: {
      'mail.read': [Permission.MAIL_READ],
      'mail.write': [Permission.MAIL_WRITE],
    },
    policies: {
      adminApi: { audiences: ['admin-api'] },
      jmapApi: { audiences: ['jmap-api'] },
    },
    provisionAdminUiClient: () => ({ clientId: 'test-admin-ui', requestScopeList: [], groups: [] }),
    provisionJmapUiClient: () => ({ clientId: 'test-jmap-ui', requestScopeList: [], groups: [] }),
    createAdminApiAddons: () => [],
  };
}

function buildStack(stackId: string): cdk.Stack {
  const app = new App({ context: { 'serverlessinbox:artifacts': ARTIFACT_CONTEXT } });
  return new cdk.Stack(app, stackId, {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

/**
 * Finds the S3 bucket whose deterministic name ends in the given construct-id suffix (e.g.
 * `ui-admin-ui`). CDK folds the trailing literal segments of nested `Fn::Join`s together, so the
 * bucket-name-specific suffix arrives merged with the preceding literal ("-") rather than as its
 * own array element — hence a suffix match, not an exact-element match.
 */
function findBucketLogicalIdBySuffix(template: Record<string, unknown>, suffix: string): string {
  const resources = (template.Resources ?? {}) as Record<string, CloudFormationResource>;
  for (const [logicalId, resource] of Object.entries(resources)) {
    if (!isResourceOfType(resource, 'AWS::S3::Bucket')) continue;
    const bucketName = resource.Properties?.BucketName;
    if (typeof bucketName === 'object' && bucketName !== null && 'Fn::Join' in bucketName) {
      const [, args] = (bucketName as { 'Fn::Join': [string, unknown[]] })['Fn::Join'];
      const lastArg = args[args.length - 1];
      if (typeof lastArg === 'string' && lastArg.endsWith(suffix)) return logicalId;
    }
  }
  throw new Error(`No S3 bucket found with name suffix "${suffix}"`);
}

/** Finds the IAM role backing the AutoUpdater's own Lambda (its handler sets DIST_TAG; no other function does). */
function findUpdaterRoleLogicalId(template: Record<string, unknown>): string {
  const resources = (template.Resources ?? {}) as Record<string, CloudFormationResource>;
  for (const resource of Object.values(resources)) {
    if (!isResourceOfType(resource, 'AWS::Lambda::Function')) continue;
    const env = resource.Properties?.Environment as { Variables?: Record<string, unknown> } | undefined;
    if (!env?.Variables?.DIST_TAG) continue;
    const role = resource.Properties?.Role as { 'Fn::GetAtt'?: [string, string] } | undefined;
    if (role?.['Fn::GetAtt']) return role['Fn::GetAtt'][0];
  }
  throw new Error('No Lambda function with a DIST_TAG environment variable (the artifact updater) found');
}

/** All policy statements attached (via an AWS::IAM::Policy's Roles list) to the given role. */
function findPolicyStatementsForRole(template: Record<string, unknown>, roleLogicalId: string): CloudFormationPolicyStatement[] {
  const resources = (template.Resources ?? {}) as Record<string, CloudFormationResource>;
  const statements: CloudFormationPolicyStatement[] = [];
  for (const resource of Object.values(resources)) {
    if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;
    const roles = (resource.Properties?.Roles ?? []) as { Ref?: string }[];
    if (!roles.some((r) => r.Ref === roleLogicalId)) continue;
    statements.push(...getPolicyStatements(resource.Properties?.PolicyDocument));
  }
  return statements;
}

function statementActions(stmt: CloudFormationPolicyStatement): string[] {
  return Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
}

describe('MailboxUi.grantContentDeploy wired to a grantable resolver (AutoUpdater)', () => {
  it("grants the updater's own role write/list access scoped to content/* and config/* prefixes", () => {
    const stack = buildStack('TestAutoUpdaterGrantable');
    const autoUpdater = new AutoUpdater(stack, 'auto-updater');
    new Mailbox(stack, 'mailbox', {
      authProvider: createMockAuthProvider(),
      artifactResolver: autoUpdater,
    });

    const template = Template.fromStack(stack).toJSON() as Record<string, unknown>;
    const adminBucketId = findBucketLogicalIdBySuffix(template, 'ui-admin-ui');
    const updaterRoleId = findUpdaterRoleLogicalId(template);
    const updaterStatements = findPolicyStatementsForRole(template, updaterRoleId);

    // Find write statements (s3:PutObject and s3:DeleteObject)
    const writeStmts = updaterStatements.filter((s) => {
      const actions = statementActions(s);
      return actions.includes('s3:PutObject') && actions.includes('s3:DeleteObject');
    });
    expect(writeStmts.length).toBeGreaterThanOrEqual(1);

    // Verify that write statements include both content/* and config/* resources
    const allWriteResources = writeStmts.map((s) => (Array.isArray(s.Resource) ? s.Resource : [s.Resource])).flat();

    // Check if a resource contains a specific prefix (handling both string and Fn::Join formats)
    const hasPrefix = (resource: unknown, prefix: string): boolean => {
      if (typeof resource === 'string') {
        return resource.includes(adminBucketId) && resource.includes(prefix);
      }
      if (typeof resource === 'object' && resource !== null && 'Fn::Join' in resource) {
        const joinParts = (resource as Record<string, unknown>)['Fn::Join'] as unknown[];
        return JSON.stringify(joinParts).includes(prefix);
      }
      return false;
    };

    const hasContentWrite = allWriteResources.some((r) => hasPrefix(r, 'content/*'));
    const hasConfigWrite = allWriteResources.some((r) => hasPrefix(r, 'config/*'));
    expect(hasContentWrite).toBe(true);
    expect(hasConfigWrite).toBe(true);

    // Find list statements (s3:ListBucket)
    const listStmts = updaterStatements.filter((s) => statementActions(s).includes('s3:ListBucket'));
    expect(listStmts.length).toBeGreaterThanOrEqual(1);

    // Verify that list statements reference the bucket ARN (either as direct reference or in Fn::Join)
    listStmts.forEach((stmt) => {
      const resourceStmt = JSON.stringify(stmt.Resource);
      expect(resourceStmt.includes(adminBucketId) || resourceStmt.includes('Arn')).toBe(true);
    });

    // Verify that list statements include s3:prefix conditions for both content/* and config/*
    const allPrefixConditions: string[] = [];
    listStmts.forEach((stmt) => {
      if (stmt.Condition && typeof stmt.Condition === 'object') {
        const stringLike = (stmt.Condition as Record<string, unknown>)['StringLike'];
        if (stringLike && typeof stringLike === 'object') {
          const prefixes = (stringLike as Record<string, unknown>)['s3:prefix'];
          if (typeof prefixes === 'string') {
            allPrefixConditions.push(prefixes);
          } else if (Array.isArray(prefixes)) {
            allPrefixConditions.push(...prefixes.filter((p): p is string => typeof p === 'string'));
          }
        }
      }
    });

    const hasContentPrefix = allPrefixConditions.some((p) => p.includes('content/*'));
    const hasConfigPrefix = allPrefixConditions.some((p) => p.includes('config/*'));
    expect(hasContentPrefix).toBe(true);
    expect(hasConfigPrefix).toBe(true);
  });
});

describe('MailboxUi.grantContentDeploy with a non-grantable resolver (PinnedArtifactResolver, the default)', () => {
  it('synthesizes without error, and no Lambda role is granted the auto-updater UI content-deploy shape', () => {
    const stack = buildStack('TestAutoUpdaterPinned');
    const pinnedResolver = MailboxArtifactResolverFactory.fromContext(stack, loadMailboxRegistryRecord(), loadMailboxArtifactVersions());

    // The regression this guards: if the runtime `'grantPrincipal' in resolver` capability check in
    // Mailbox were dropped (or inverted) and `ui.grantContentDeploy(resolver)` were called
    // unconditionally, `Grant.addToPrincipal` would dereference `resolver.grantPrincipal` on a
    // resolver that doesn't have one — a synth-time crash, not a silent no-op. A resolver with no
    // principal must be skippable with no error.
    expect(() => {
      new Mailbox(stack, 'mailbox', {
        authProvider: createMockAuthProvider(),
        artifactResolver: pinnedResolver,
      });
    }).not.toThrow();

    const template = Template.fromStack(stack).toJSON() as Record<string, unknown>;
    const resources = (template.Resources ?? {}) as Record<string, CloudFormationResource>;

    // No AutoUpdater is constructed under a pinned resolver, so nothing granted from AutoUpdater's
    // handler exists at all — confirmed by there being no Lambda function with the DIST_TAG
    // environment variable ArtifactUpdaterLambda alone sets.
    const hasUpdaterFunction = Object.values(resources).some((resource) => {
      if (!isResourceOfType(resource, 'AWS::Lambda::Function')) return false;
      const env = resource.Properties?.Environment as { Variables?: Record<string, unknown> } | undefined;
      return Boolean(env?.Variables?.DIST_TAG);
    });
    expect(hasUpdaterFunction).toBe(false);
  });
});
