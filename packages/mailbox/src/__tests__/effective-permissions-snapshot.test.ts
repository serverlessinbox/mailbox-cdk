/**
 * Captures the complete IAM permission surface of the `Mailbox` construct against a
 * committed baseline. A regression here means a phase of the grant-concept refactor
 * changed what a Lambda can do, not just where the grant lives — the one thing a pure
 * structural move (this plan's stated goal for most phases) must never do.
 *
 * TEMPORARY: Grant Concept Phase 0 gate (removed in Phase 13).
 *
 * Run with UPDATE_PERMISSION_BASELINE=1 to regenerate the fixture:
 *   UPDATE_PERMISSION_BASELINE=1 yarn jest effective-permissions-snapshot
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';
import * as path from 'path';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { Mailbox } from '../mailbox';
import { capturePermissionSnapshot, compareSnapshots, PermissionSnapshot } from './permission-snapshot-helpers';
import { PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
import { IMailboxAuthProvider } from '../auth/types';

const FIXTURE_DIR = path.join(__dirname, '__fixtures__');
const MAILBOX_FIXTURE = path.join(FIXTURE_DIR, 'mailbox-permissions.json');

/**
 * `mailbox` cannot import `mailbox-cognito` (the dependency runs the other way), so the
 * real auth provider is unavailable here — this stands in for it with the same
 * `IMailboxAuthProvider` surface `Mailbox` actually depends on.
 */
class MockAuthProvider extends Construct implements IMailboxAuthProvider {
  readonly userPool: cognito.IUserPool;
  readonly userPoolId: string;
  readonly userPoolArn: string;
  readonly userPoolClientId: string;
  readonly pool: cognito.UserPool;
  readonly issuer: string;
  readonly tokenEndpoint: string;
  readonly authorizationEndpoint: string;
  readonly authMethod: 'header' | 'form';
  readonly usePkce: boolean;
  readonly scopeMap: { [key: string]: any[] };
  readonly policies: any;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.pool = new cognito.UserPool(this, 'pool', { selfSignUpEnabled: false });
    this.userPool = this.pool;
    this.userPoolId = this.pool.userPoolId;
    this.userPoolArn = this.pool.userPoolArn;

    const client = this.pool.addClient('client', { userPoolClientName: 'test-client' });
    this.userPoolClientId = client.userPoolClientId;

    this.issuer = `https://cognito-idp.us-west-2.amazonaws.com/${this.userPoolId}`;
    this.tokenEndpoint = `${this.issuer}/oauth2/token`;
    this.authorizationEndpoint = `${this.issuer}/oauth2/authorize`;
    this.authMethod = 'form';
    this.usePkce = false;
    this.scopeMap = { default: [] };
    this.policies = {
      adminApi: { audiences: ['admin-api'] },
      jmapApi: { audiences: ['jmap-api'] },
    };
  }

  grantAdminAccess(grantable: iam.IGrantable): iam.Grant {
    return this.pool.grant(grantable, 'cognito-idp:AdminGetUser');
  }

  provisionAdminUiClient(): any {
    return { clientId: 'admin-client-id', clientSecret: undefined, requestScopeList: [], groups: [] };
  }

  provisionJmapUiClient(): any {
    return { clientId: 'jmap-client-id', clientSecret: undefined, requestScopeList: [], groups: [] };
  }
}

/**
 * Every optional Lambda-creating feature `Mailbox` exposes (`enableMcp`, `enableAdminUi`,
 * `enableWebmailUi`, `enableReceiving`) is turned on so the snapshot covers as many
 * Lambdas/roles as the main-stack test harness can reach in one synth. Left disabled:
 * none — these four are the full set of optional switches `MailboxProps` declares.
 */
function createTestMailboxStack(): cdk.Stack {
  const app = new App({ context: { 'aws:cdk:enable-path-metadata': true } });
  app.node.setContext('serverlessinbox:artifacts', {
    bucketBase: 'test-artifacts',
    packages: {
      mailbox: { kind: 'release', version: '0.0.1-test' },
      'mailbox-go': { kind: 'release', version: '0.0.1-test' },
      'mailbox-cdk': { kind: 'release', version: '0.0.1-test' },
      'mailbox-cdk-shared': { kind: 'release', version: '0.0.1-test' },
      'mailbox-cdk-edge': { kind: 'release', version: '0.0.1-test' },
      'mailbox-admin-ui': { kind: 'release', version: '0.0.1-test' },
      'mailbox-webmail-ui': { kind: 'release', version: '0.0.1-test' },
    },
  });
  app.node.setContext('serverlessinbox:artifact_versions', {});

  const stack = new cdk.Stack(app, 'TestMailboxStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const resolver = PinnedResolver.loadFromArtifactMetadata(stack);
  resolver.registerPackages([
    'mailbox',
    'mailbox-go',
    'mailbox-cdk',
    'mailbox-cdk-shared',
    'mailbox-cdk-edge',
    'mailbox-admin-ui',
    'mailbox-webmail-ui',
  ]);

  const authProvider = new MockAuthProvider(stack, 'TestAuth');

  new Mailbox(stack, 'Mailbox', {
    authProvider,
    hostedZoneId: 'Z123456789ABC',
    enableMcp: true,
    enableAdminUi: true,
    enableWebmailUi: true,
    enableReceiving: 'on',
    artifactResolver: resolver,
  });

  return stack;
}

function countResourcesOfType(stack: cdk.Stack, type: string): number {
  const assembly = cdk.App.of(stack)!.synth();
  const resources = assembly.getStackArtifact(stack.artifactId).template.Resources ?? {};
  return Object.values(resources).filter((r: any) => r.Type === type).length;
}

describe('Effective Permissions Snapshot — Mailbox', () => {
  it('matches the committed baseline', () => {
    const stack = createTestMailboxStack();
    const snapshot = capturePermissionSnapshot(stack);

    if (process.env.UPDATE_PERMISSION_BASELINE === '1') {
      fs.mkdirSync(FIXTURE_DIR, { recursive: true });
      fs.writeFileSync(MAILBOX_FIXTURE, JSON.stringify(snapshot, null, 2));
      return;
    }

    if (!fs.existsSync(MAILBOX_FIXTURE)) {
      throw new Error(
        `Baseline fixture not found: ${MAILBOX_FIXTURE}\nRun: UPDATE_PERMISSION_BASELINE=1 yarn jest effective-permissions-snapshot`,
      );
    }
    const baseline = JSON.parse(fs.readFileSync(MAILBOX_FIXTURE, 'utf-8')) as PermissionSnapshot;
    const result = compareSnapshots(snapshot, baseline);
    if (!result.matches) {
      throw new Error(
        `Permission snapshot mismatch. Run UPDATE_PERMISSION_BASELINE=1 yarn jest effective-permissions-snapshot ` +
          `to review and commit the change if it is an intentional, called-out permission change.\n\nDiff:\n${result.diff}`,
      );
    }
  });

  it('captures every AWS::Lambda::Function and AWS::IAM::Role resource in the template', () => {
    const stack = createTestMailboxStack();
    const snapshot = capturePermissionSnapshot(stack);

    expect(Object.keys(snapshot.functions).length).toBe(countResourcesOfType(stack, 'AWS::Lambda::Function'));
    expect(Object.keys(snapshot.roles).length).toBe(countResourcesOfType(stack, 'AWS::IAM::Role'));
  });
});
