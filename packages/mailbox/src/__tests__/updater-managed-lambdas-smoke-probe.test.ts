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

import { access } from 'node:fs/promises';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MailboxEdgeStack } from '../edge/mailbox-edge-stack';
import { Mailbox } from '../mailbox';
import type { IMailboxAuthProvider } from '../auth/types';
import { Permission } from '../auth/jmap-scopes';

/** A function of a synthesized template that the artifact updater manages, as the template describes it. */
interface ManagedLambda {
  readonly logicalId: string;
  readonly artifactName: string;
  readonly packageName: string;
  readonly autoUpdateType: string;
  readonly handlerExport: string;
  readonly environment: Record<string, string>;
}

/** The part of a synthesized `AWS::Lambda::Function` this suite reads. */
interface LambdaFunctionResource {
  readonly Type: string;
  readonly Properties?: {
    readonly Handler?: string;
    readonly Tags?: ReadonlyArray<{ readonly Key: string; readonly Value: unknown }>;
    readonly Environment?: { readonly Variables?: Record<string, unknown> };
  };
}

/** An invocation outcome: whether the handler answered the probe, whether it was reached at all, and what happened. */
interface ProbeOutcome {
  readonly answered: boolean;
  readonly handlerReached: boolean;
  readonly detail: string;
}

const AUTO_UPDATE_TYPE_TAG = 'serverless-inbox:auto-update-type';
const ARTIFACT_NAME_TAG = 'serverless-inbox:artifact-name';
const ARTIFACT_PACKAGE_TAG = 'serverless-inbox:artifact-package';
const GO_PACKAGE = 'mailbox-go';
const MANAGED_UPDATE_TYPES = ['code', 'edge'];
const PROBE = { serverlessInboxSmokeTest: true };
const PLACEHOLDER_FOR_TOKEN = 'resolved-at-deploy-time';

/** The source folders that hold the TypeScript handlers of the Lambdas of this repository, by bundle entry. */
const TS_LAMBDA_ROOTS = [
  path.join(__dirname, '..', 'ts-lambdas'),
  path.join(__dirname, '..', '..', '..', 'mailbox-cdk-shared', 'src', 'ts-lambdas'),
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
    provisionAdminUiClient: () => ({ clientId: 'test-admin-ui', requestScopeList: [], groups: [] }),
    provisionJmapUiClient: () => ({ clientId: 'test-jmap-ui', requestScopeList: [], groups: [] }),
    createAdminApiAddons: () => [],
  };
}

function synthesizeMailbox(): Template {
  const app = new App({
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

function managedLambdasOf(template: Template): ManagedLambda[] {
  const resources = template.toJSON().Resources as Record<string, LambdaFunctionResource>;
  const managed: ManagedLambda[] = [];

  for (const [logicalId, resource] of Object.entries(resources)) {
    if (resource.Type !== 'AWS::Lambda::Function') {
      continue;
    }
    const tags = resource.Properties?.Tags ?? [];
    const autoUpdateType = tags.find((tag) => tag.Key === AUTO_UPDATE_TYPE_TAG)?.Value;
    const artifactName = tags.find((tag) => tag.Key === ARTIFACT_NAME_TAG)?.Value;
    if (typeof autoUpdateType !== 'string' || !MANAGED_UPDATE_TYPES.includes(autoUpdateType)) {
      continue;
    }
    const packageName = tags.find((tag) => tag.Key === ARTIFACT_PACKAGE_TAG)?.Value;
    if (typeof artifactName !== 'string' || typeof packageName !== 'string') {
      throw new Error(`Managed Lambda ${logicalId} has no artifact-name or artifact-package tag`);
    }
    managed.push({
      logicalId,
      artifactName,
      packageName,
      autoUpdateType,
      handlerExport: (resource.Properties?.Handler ?? '').split('.').slice(1).join('.'),
      environment: environmentOf(resource.Properties?.Environment?.Variables ?? {}),
    });
  }
  return managed;
}

/** A value CloudFormation resolves at deploy time has no value yet; the placeholder stands in for it. */
function environmentOf(variables: Record<string, unknown>): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(variables)) {
    environment[name] = typeof value === 'string' ? value : PLACEHOLDER_FOR_TOKEN;
  }
  return environment;
}

async function handlerSourceOf(artifactName: string): Promise<string | undefined> {
  const found: string[] = [];
  for (const root of TS_LAMBDA_ROOTS) {
    const entry = path.join(root, artifactName, 'index.ts');
    try {
      await access(entry);
      found.push(entry);
    } catch {
      // This root does not hold the artifact.
    }
  }
  if (found.length > 1) {
    throw new Error(`Artifact ${artifactName} has more than one bundle entry: ${found.join(', ')}`);
  }
  return found[0];
}

function isSmokeTestAnswer(answer: unknown): boolean {
  return (
    typeof answer === 'object' &&
    answer !== null &&
    'serverlessInboxSmokeTestOk' in answer &&
    typeof answer.serverlessInboxSmokeTestOk === 'boolean'
  );
}

async function probe(lambda: ManagedLambda, source: string): Promise<ProbeOutcome> {
  const originalEnvironment = { ...process.env };
  Object.assign(process.env, lambda.environment);

  try {
    return await invokeProbe(lambda, loadHandlerModule(source));
  } finally {
    process.env = originalEnvironment;
  }
}

/** The handler module as a fresh Lambda cold start loads it, so its module-scope configuration is read again. */
function loadHandlerModule(source: string): Record<string, unknown> | Error {
  let loaded: Record<string, unknown> | Error = new Error('module was not loaded');
  jest.isolateModules(() => {
    try {
      loaded = jest.requireActual<Record<string, unknown>>(source);
    } catch (thrown) {
      loaded = thrown instanceof Error ? thrown : new Error(String(thrown));
    }
  });
  return loaded;
}

async function invokeProbe(lambda: ManagedLambda, loaded: Record<string, unknown> | Error): Promise<ProbeOutcome> {
  if (loaded instanceof Error) {
    return { answered: false, handlerReached: false, detail: `loading the module threw ${loaded.message}` };
  }
  const handler = loaded[lambda.handlerExport];
  if (typeof handler !== 'function') {
    return { answered: false, handlerReached: false, detail: `the module exports no function ${lambda.handlerExport}` };
  }

  try {
    const answer: unknown = await handler(PROBE, {});
    return { answered: isSmokeTestAnswer(answer), handlerReached: true, detail: `answered ${JSON.stringify(answer)}` };
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return { answered: false, handlerReached: true, detail: `the handler threw ${message}` };
  }
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
    const unplaced: string[] = [];
    const goWithSource: string[] = [];

    for (const lambda of managed) {
      const source = await handlerSourceOf(lambda.artifactName);
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
    const names = new Set(managed.map((lambda) => lambda.artifactName));
    const listedOutsideGoPackage = managed
      .filter((lambda) => GO_ARTIFACTS.has(lambda.artifactName) && lambda.packageName !== GO_PACKAGE)
      .map((lambda) => lambda.artifactName);

    expect(listedOutsideGoPackage).toEqual([]);
    expect([...GO_ARTIFACTS].filter((name) => !names.has(name))).toEqual([]);
  });

  it('answer the smoke-test probe with a boolean serverlessInboxSmokeTestOk', async () => {
    const failures: string[] = [];

    for (const lambda of managed.filter((candidate) => !GO_ARTIFACTS.has(candidate.artifactName))) {
      const source = await handlerSourceOf(lambda.artifactName);
      if (source === undefined) {
        continue;
      }
      const outcome = await probe(lambda, source);
      if (!outcome.answered) {
        failures.push(`${lambda.artifactName} (${lambda.logicalId}): ${outcome.detail}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('include the jmap-blob-download, which answers the probe', async () => {
    const lambda = managed.find((candidate) => candidate.artifactName === 'jmap-blob-download');
    const source = await handlerSourceOf('jmap-blob-download');
    if (lambda === undefined || source === undefined) {
      throw new Error('jmap-blob-download is not a managed TypeScript Lambda');
    }

    const outcome = await probe(lambda, source);

    expect(outcome).toMatchObject({ answered: true, handlerReached: true });
  });
});
