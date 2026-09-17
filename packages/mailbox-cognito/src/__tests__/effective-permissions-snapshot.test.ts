/**
 * Captures the complete IAM permission surface of the `MailboxUserPool` construct
 * (including the cognito data deployer worker/starter and the IdP-users API addon)
 * against a committed baseline. A regression here means a phase of the grant-concept
 * refactor changed what a Lambda can do, not just where the grant lives.
 *
 * TEMPORARY: Grant Concept Phase 0 gate (removed in Phase 13).
 *
 * Run with UPDATE_PERMISSION_BASELINE=1 to regenerate the fixture:
 *   UPDATE_PERMISSION_BASELINE=1 yarn jest effective-permissions-snapshot
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as fs from 'fs';
import * as path from 'path';
import { MailboxUserPool } from '../auth/mailbox-user-pool';
import { CognitoIdpUsersAdminApiAddon } from '../api/cognito-idp-users-addon';
import { capturePermissionSnapshot, compareSnapshots, PermissionSnapshot } from './permission-snapshot-helpers';
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';

const FIXTURE_DIR = path.join(__dirname, '__fixtures__');
const MAILBOX_COGNITO_FIXTURE = path.join(FIXTURE_DIR, 'mailbox-user-pool-permissions.json');

/**
 * `enableJmapOAuthDiscovery` is the only optional Lambda-creating switch `MailboxUserPool`
 * itself exposes beyond its required cognito data deployer worker/starter. The IdP-users
 * API Lambda (Phase 4a) is a separate admin-api addon (`CognitoIdpUsersAdminApiAddon`),
 * built externally in the host stack rather than inside `MailboxUserPool` — this test
 * constructs it alongside `MailboxUserPool` (its own `pool`) so the snapshot covers it too.
 */
function createTestMailboxUserPoolStack(): cdk.Stack {
  const app = new App({
    context: {
      'aws:cdk:enable-path-metadata': true,
      'serverlessinbox:artifacts': {
        bucketBase: 'test-artifacts',
        packages: {
          'mailbox-cognito': { kind: 'release', version: '0.0.1-test' },
          'mailbox-cdk': { kind: 'release', version: '0.0.1-test' },
          mailbox: { kind: 'release', version: '0.0.1-test' },
          'mailbox-cdk-shared': { kind: 'release', version: '0.0.1-test' },
        },
      },
      'serverlessinbox:artifact_versions': {},
    },
  });

  const stack = new cdk.Stack(app, 'TestMailboxCognitoStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const resolver = PinnedResolver.loadFromArtifactMetadata(stack);
  resolver.registerPackages(['mailbox-cognito', 'mailbox-cdk', 'mailbox', 'mailbox-cdk-shared']);

  const pool = new MailboxUserPool(stack, 'MailboxUserPool', {
    domain: { kind: 'cognito', cognitoDomainPrefix: 'test-mailbox-cognito' },
    artifactResolver: resolver,
    enableJmapOAuthDiscovery: true,
  });

  const auditEventsQueue = new sqs.Queue(stack, 'TestAuditEventsQueue');
  new CognitoIdpUsersAdminApiAddon(stack, 'IdpUsersAddon', {
    artifactResolver: new CdkArtifactEngine(stack, resolver, 'idp-users-artifacts'),
    auditEventsQueue,
    pool,
  });

  return stack;
}

function countResourcesOfType(stack: cdk.Stack, type: string): number {
  const assembly = cdk.App.of(stack)!.synth();
  const resources = assembly.getStackArtifact(stack.artifactId).template.Resources ?? {};
  return Object.values(resources).filter((r: any) => r.Type === type).length;
}

describe('Effective Permissions Snapshot — MailboxUserPool (Cognito)', () => {
  it('matches the committed baseline', () => {
    const stack = createTestMailboxUserPoolStack();
    const snapshot = capturePermissionSnapshot(stack);

    if (process.env.UPDATE_PERMISSION_BASELINE === '1') {
      fs.mkdirSync(FIXTURE_DIR, { recursive: true });
      fs.writeFileSync(MAILBOX_COGNITO_FIXTURE, JSON.stringify(snapshot, null, 2));
      return;
    }

    if (!fs.existsSync(MAILBOX_COGNITO_FIXTURE)) {
      throw new Error(
        `Baseline fixture not found: ${MAILBOX_COGNITO_FIXTURE}\nRun: UPDATE_PERMISSION_BASELINE=1 yarn jest effective-permissions-snapshot`,
      );
    }
    const baseline = JSON.parse(fs.readFileSync(MAILBOX_COGNITO_FIXTURE, 'utf-8')) as PermissionSnapshot;
    const result = compareSnapshots(snapshot, baseline);
    if (!result.matches) {
      throw new Error(
        `Permission snapshot mismatch. Run UPDATE_PERMISSION_BASELINE=1 yarn jest effective-permissions-snapshot ` +
          `to review and commit the change if it is an intentional, called-out permission change.\n\nDiff:\n${result.diff}`,
      );
    }
  });

  it('captures every AWS::Lambda::Function and AWS::IAM::Role resource in the template', () => {
    const stack = createTestMailboxUserPoolStack();
    const snapshot = capturePermissionSnapshot(stack);

    expect(Object.keys(snapshot.functions).length).toBe(countResourcesOfType(stack, 'AWS::Lambda::Function'));
    expect(Object.keys(snapshot.roles).length).toBe(countResourcesOfType(stack, 'AWS::IAM::Role'));
  });
});
