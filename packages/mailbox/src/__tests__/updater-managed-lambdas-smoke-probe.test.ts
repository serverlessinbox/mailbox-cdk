/// <reference types="jest" />

/**
 * Contract between the artifact updater and the Lambdas it manages. The updater keeps new code only when the
 * Lambda answers its smoke-test probe `{ serverlessInboxSmokeTest: true }` with a JSON object that holds a
 * boolean `serverlessInboxSmokeTestOk`; any other outcome rolls the update back. A managed Lambda whose handler
 * does not answer is therefore never updated, and this suite fails when one exists.
 *
 * The managed Lambdas are read from the synthesized templates: every function tagged with an auto-update-type
 * of `code` or `edge`. Each is mapped to its handler source through its artifact-name tag, and the handler is
 * invoked with the probe under the environment the template gives that function. Handlers written in Go live in
 * another repository and cannot be probed here; they are an explicit list, so a TypeScript Lambda that is added
 * can never end up in it unnoticed.
 */

import {
  handlerSourceOf,
  managedLambdasOf,
  probeManagedLambda,
  type ManagedLambda,
} from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                      from 'aws-cdk-lib/assertions';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import * as path                         from 'node:path';

import { Permission }                    from '../auth/jmap-scopes';
import type { IMailboxAuthProvider }     from '../auth/types';
import { MailboxEdgeStack }              from '../edge/mailbox-edge-stack';
import { Mailbox }                       from '../mailbox';

const GO_PACKAGE = 'mailbox-go';

/** The source folders that hold the TypeScript handlers of the Lambdas of this repository, by bundle entry. */
const TS_LAMBDA_ROOTS = [
  path.join(__dirname, '..', 'runtime'),
  path.join(__dirname, '..', '..', '..', 'mailbox-cdk-shared', 'src', 'runtime'),
  path.join(__dirname, '..', '..', '..', 'mailbox-cognito', 'src', 'ts-lambdas'),
];

/** Managed Lambdas written in Go, probed by the Go smoke-test seam in the repository that holds them. */
const GO_ARTIFACTS = new Set<string>([
  'admin-api',
  'audit-writer',
  'auth-key-store-updater',
  'authorizer',
  'bootstrap',
  'email-processor',
  'email-sender',
  'identity-provisioner',
  'idp-token-exchange',
  'jmap-api',
  'license-refresher',
  'ses-receipt-forwarder',
  'sqs-ses-event-processor',
  'stack-failure-detector',
  'tantivy-indexer',
  'websocket-broadcast',
  'websocket-connect',
  'websocket-disconnect',
  'websocket-message',
]);

function createMockAuthProvider(): IMailboxAuthProvider {
  return {
    issuer: 'https://example.com/issuer',
    tokenEndpoint: 'https://example.com/token',
    authorizationEndpoint: 'https://example.com/authorize',
    authMethod: 'header',
    usePkce: false,
    scopeMap: { 'mail.read': [Permission.MAIL_READ], 'mail.write': [Permission.MAIL_WRITE] },
    policies: { adminApi: { audiences: ['admin-api'] }, jmapApi: { audiences: ['jmap-api'] } },
    provisionAdminApiClient: () => ({ clientId: 'test-admin-ui', requestScopeList: [], groups: [] }),
    provisionJmapApiClient: () => ({ clientId: 'test-jmap-ui', requestScopeList: [], groups: [] }),
    createAdminApiAddons: () => [],
  };
}

function synthesizeMailbox(): Template {
  const app   = new App({
    context: {
      'serverlessinbox:artifacts': {
        bucketBase: 'test-artifacts',
        packages: {
          'mailbox-go': { zone: 'regional', version: '1.0.0' },
          'mailbox-cdk': { zone: 'regional', version: '1.0.0' },
          'mailbox-cdk-shared': { zone: 'regional', version: '1.0.0' },
          'mailbox-cdk-edge': { zone: 'edge', version: '1.0.0' },
          'mailbox-admin-ui': { zone: 'regional', version: '1.0.0' },
          'mailbox-webmail-ui': { zone: 'regional', version: '1.0.0' },
        },
      },
    },
  });
  const stack = new cdk.Stack(app, 'TestManagedLambdas', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  new Mailbox(stack, 'mailbox', { authProvider: createMockAuthProvider() });
  return Template.fromStack(stack);
}

function synthesizeEdge(): Template {
  const stack = new MailboxEdgeStack(new App(), 'TestManagedEdgeLambdas', {
    env: { account: '123456789012', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  return Template.fromStack(stack);
}

describe('Lambdas the artifact updater manages', () => {
  let managed: ManagedLambda[];

  beforeAll(() => {
    managed = [...managedLambdasOf(synthesizeMailbox()), ...managedLambdasOf(synthesizeEdge())];
  });

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('are found in the synthesized templates, of both update types', () => {
    expect(managed.length).toBeGreaterThan(0);
    expect(new Set(managed.map((lambda) => lambda.autoUpdateType))).toEqual(new Set(['code', 'edge']));
  });

  it('are each a TypeScript Lambda with a bundle entry here or a Go Lambda on the explicit list', async () => {
    const unplaced: string[]     = [];
    const goWithSource: string[] = [];

    for (const lambda of managed) {
      const source = await handlerSourceOf(lambda.artifactName, TS_LAMBDA_ROOTS);
      if (source === undefined && !GO_ARTIFACTS.has(lambda.artifactName)) {
        unplaced.push(lambda.artifactName);
      }
      if (source !== undefined && GO_ARTIFACTS.has(lambda.artifactName)) {
        goWithSource.push(lambda.artifactName);
      }
    }

    expect({ unplaced, goWithSource }).toEqual({ unplaced: [], goWithSource: [] });
  });

  it('lists only Go artifacts that the templates hold, and every listed Go artifact is of the Go package', () => {
    const names                  = new Set(managed.map((lambda) => lambda.artifactName));
    const listedOutsideGoPackage = managed
      .filter((lambda) => GO_ARTIFACTS.has(lambda.artifactName) && lambda.packageName !== GO_PACKAGE)
      .map((lambda) => lambda.artifactName);

    expect(listedOutsideGoPackage).toEqual([]);
    expect([...GO_ARTIFACTS].filter((name) => !names.has(name))).toEqual([]);
  });

  it('answer the smoke-test probe with a boolean serverlessInboxSmokeTestOk', async () => {
    const failures: string[] = [];

    for (const lambda of managed.filter((candidate) => !GO_ARTIFACTS.has(candidate.artifactName))) {
      const source = await handlerSourceOf(lambda.artifactName, TS_LAMBDA_ROOTS);
      if (source === undefined) {
        continue;
      }
      const outcome = await probeManagedLambda(lambda, source);
      if (!outcome.answered) {
        failures.push(`${lambda.artifactName} (${lambda.logicalId}): ${outcome.detail}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('include the jmap-blob-download, which answers the probe', async () => {
    const lambda = managed.find((candidate) => candidate.artifactName === 'jmap-blob-download');
    const source = await handlerSourceOf('jmap-blob-download', TS_LAMBDA_ROOTS);
    if (lambda === undefined || source === undefined) {
      throw new Error('jmap-blob-download is not a managed TypeScript Lambda');
    }

    const outcome = await probeManagedLambda(lambda, source);

    expect(outcome).toMatchObject({ answered: true, handlerReached: true });
  });
});
