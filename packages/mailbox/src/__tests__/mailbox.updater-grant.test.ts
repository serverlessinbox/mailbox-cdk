/// <reference types="jest" />

/**
 * Mailbox: granting the artifact resolver write access to the UI bucket.
 *
 * The auto-updater writes new UI content into a bucket it does not create, so Mailbox grants the
 * resolver's own principal on that bucket's ARN rather than the updater guessing a bucket name from
 * a pattern. These cases pin that the grant lands on the updater's own role, scoped to the bucket
 * the template creates and never by tag (a tag condition denies S3 object writes), and that a
 * resolver without a principal is skipped: granting it unconditionally dereferences a principal it
 * does not have and crashes synthesis.
 */

import { actionsOf, statementsForRole }             from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { PolicyStatementJson }                 from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { MailboxArtifactResolverFactory }           from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                 from 'aws-cdk-lib/assertions';
import * as cdk                                     from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }            from 'aws-cdk-lib';

import { AutoUpdater }                              from '../platform/update/auto-updater';
import { Permission }                               from '../core/auth/jmap-scopes';
import type { IMailboxAuthProvider }                from '../core/auth/types';
import { loadMailboxArtifactVersions }              from '../mailbox-artifact-versions';
import { loadMailboxRegistryRecord }                from '../mailbox-registry-record';
import { Mailbox }                                  from '../mailbox';

import { CloudFormationResource, isResourceOfType } from './iam-test-helpers';

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
    provisionAdminApiClient: () => ({ clientId: 'test-admin-ui', requestScopeList: [], groups: [] }),
    provisionJmapApiClient: () => ({ clientId: 'test-jmap-ui', requestScopeList: [], groups: [] }),
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
    if (!isResourceOfType(resource, 'AWS::S3::Bucket')) {continue;}
    const bucketName = resource.Properties?.BucketName;
    if (typeof bucketName === 'object' && bucketName !== null && 'Fn::Join' in bucketName) {
      const [, args] = (bucketName as { 'Fn::Join': [string, unknown[]] })['Fn::Join'];
      const lastArg  = args[args.length - 1];
      if (typeof lastArg === 'string' && lastArg.endsWith(suffix)) {return logicalId;}
    }
  }
  throw new Error(`No S3 bucket found with name suffix "${suffix}"`);
}

/** Finds the IAM role backing the AutoUpdater's own Lambda (its environment sets DIST_TAG; no other function's does). */
function findUpdaterRoleLogicalId(template: Record<string, unknown>): string {
  const resources = (template.Resources ?? {}) as Record<string, CloudFormationResource>;
  for (const resource of Object.values(resources)) {
    if (!isResourceOfType(resource, 'AWS::Lambda::Function')) {continue;}
    const environment = resource.Properties?.Environment as { Variables?: Record<string, unknown> } | undefined;
    if (!environment?.Variables?.DIST_TAG) {continue;}
    const role = resource.Properties?.Role as { 'Fn::GetAtt'?: [string, string] } | undefined;
    if (role?.['Fn::GetAtt']) {return role['Fn::GetAtt'][0];}
  }
  throw new Error('No Lambda function with a DIST_TAG environment variable (the artifact updater) found');
}

describe('Mailbox with a grantable artifact resolver (AutoUpdater)', () => {
  let adminBucketId: string;
  let updaterStatements: PolicyStatementJson[];

  beforeAll(() => {
    const stack       = buildStack('TestAutoUpdaterGrantable');
    const autoUpdater = new AutoUpdater(stack, 'auto-updater');
    new Mailbox(stack, 'mailbox', {
      authProvider: createMockAuthProvider(),
      artifactResolver: autoUpdater,
    });

    const synthesized = Template.fromStack(stack);
    const template    = synthesized.toJSON() as Record<string, unknown>;
    adminBucketId     = findBucketLogicalIdBySuffix(template, 'ui-admin-ui');
    updaterStatements = statementsForRole(synthesized, findUpdaterRoleLogicalId(template));
  });

  const writesTo = (prefix: string): PolicyStatementJson[] =>
    updaterStatements.filter((statement) => {
      const actions   = actionsOf(statement);
      const resources = JSON.stringify(statement.Resource);
      return actions.includes('s3:PutObject') && actions.includes('s3:DeleteObject') && resources.includes(adminBucketId) && resources.includes(prefix);
    });

  const listsOnly = (prefix: string): PolicyStatementJson[] =>
    updaterStatements.filter((statement) => {
      const prefixes = JSON.stringify(statement.Condition?.StringLike?.['s3:prefix'] ?? []);
      return actionsOf(statement).includes('s3:ListBucket') && JSON.stringify(statement.Resource).includes(adminBucketId) && prefixes.includes(prefix);
    });

  it.each(['content/*', 'config/*'])("grants the updater's role write and delete on the admin UI bucket under %s", (prefix) => {
    expect(writesTo(prefix)).toHaveLength(1);
  });

  it('does not scope the object writes by tag', () => {
    expect(writesTo('content/*')[0].Condition).toBeUndefined();
    expect(writesTo('config/*')[0].Condition).toBeUndefined();
  });

  it.each(['content/*', 'config/*'])("grants the updater's role listing of the admin UI bucket limited to %s", (prefix) => {
    expect(listsOnly(prefix)).toHaveLength(1);
  });
});

describe('Mailbox with a resolver that has no principal (the default pinned resolver)', () => {
  it('synthesizes without error', () => {
    const stack          = buildStack('TestAutoUpdaterPinned');
    const pinnedResolver = MailboxArtifactResolverFactory.fromContext(stack, loadMailboxRegistryRecord(), loadMailboxArtifactVersions());

    expect(() => {
      new Mailbox(stack, 'mailbox', {
        authProvider: createMockAuthProvider(),
        artifactResolver: pinnedResolver,
      });
    }).not.toThrow();
  });
});
