/// <reference types="jest" />

/**
 * Pins how the helpers read the Lambdas the artifact updater manages from a synthesized template and decide
 * whether a handler answers the smoke-test probe. Both the mailbox suite and the mailbox-cognito suite rely on
 * them: a helper that reported a handler as answering when it does not would hide a Lambda the updater rolls
 * back on every cycle.
 */

import { Template }                                                                  from 'aws-cdk-lib/assertions';
import * as lambda                                                                   from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack, Tags }                                from 'aws-cdk-lib';
import * as path                                                                     from 'node:path';

import { handlerSourceOf, managedLambdasOf, probeManagedLambda, type ManagedLambda } from '../managed-lambdas';

const ROOT_A = path.join(__dirname, 'fixtures', 'root-a');
const ROOT_B = path.join(__dirname, 'fixtures', 'root-b');

function managedLambda(overrides: Partial<ManagedLambda> = {}): ManagedLambda {
  return {
    logicalId:      'FixtureLambda',
    artifactName:   'answers',
    packageName:    'fixture-package',
    autoUpdateType: 'code',
    handlerExport:  'handler',
    environment:    {},
    ...overrides,
  };
}

function synthesize(addFunctions: (stack: Stack) => void): Template {
  const stack = new Stack(new App(), 'FixtureStack', { synthesizer: new BootstraplessSynthesizer() });
  addFunctions(stack);
  return Template.fromStack(stack);
}

function taggedFunction(stack: Stack, id: string, tags: Record<string, string>, environment: Record<string, string> = {}): void {
  const fn = new lambda.Function(stack, id, {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code:    lambda.Code.fromInline('exports.handler = async () => {};'),
    environment,
  });
  for (const [key, value] of Object.entries(tags)) {
    Tags.of(fn).add(key, value);
  }
}

describe('managedLambdasOf', () => {
  it('reads the artifact, package, update type, handler export and environment of a code or edge Lambda', () => {
    const template = synthesize((stack) => {
      taggedFunction(
        stack,
        'managed',
        {
          'serverless-inbox:auto-update-type': 'edge',
          'serverless-inbox:artifact-name':    'answers',
          'serverless-inbox:artifact-package': 'fixture-package',
        },
        { FIXTURE_FLAG: 'on' },
      );
    });

    expect(managedLambdasOf(template)).toEqual([
      expect.objectContaining({
        artifactName:   'answers',
        packageName:    'fixture-package',
        autoUpdateType: 'edge',
        handlerExport:  'handler',
        environment:    { FIXTURE_FLAG: 'on' },
      }),
    ]);
  });

  it('leaves out a Lambda the updater does not manage', () => {
    const template = synthesize((stack) => {
      taggedFunction(stack, 'unmanaged', {
        'serverless-inbox:auto-update-type': 'none',
        'serverless-inbox:artifact-name':    'answers',
        'serverless-inbox:artifact-package': 'fixture-package',
      });
    });

    expect(managedLambdasOf(template)).toEqual([]);
  });

  it('throws for a managed Lambda that has no artifact-name tag', () => {
    const template = synthesize((stack) => {
      taggedFunction(stack, 'untraceable', { 'serverless-inbox:auto-update-type': 'code' });
    });

    expect(() => managedLambdasOf(template)).toThrow(/has no artifact-name or artifact-package tag/);
  });

  it('throws naming the function when its tags are not a list', () => {
    const template = Template.fromJSON({
      Resources: { Broken: { Type: 'AWS::Lambda::Function', Properties: { Tags: 'not-a-list' } } },
    });

    expect(() => managedLambdasOf(template)).toThrow(/Lambda Broken is not a synthesized function resource/);
  });
});

describe('handlerSourceOf', () => {
  it('finds the bundle entry of an artifact in the root that holds it', async () => {
    expect(await handlerSourceOf('silent', [ROOT_A, ROOT_B])).toBe(path.join(ROOT_A, 'silent', 'index.ts'));
  });

  it('is undefined when no root holds the artifact', async () => {
    expect(await handlerSourceOf('absent', [ROOT_A, ROOT_B])).toBeUndefined();
  });

  it('throws when more than one root holds the artifact', async () => {
    await expect(handlerSourceOf('answers', [ROOT_A, ROOT_B])).rejects.toThrow(/more than one bundle entry/);
  });
});

describe('probeManagedLambda', () => {
  it('reports a handler that answers the probe with a boolean as answered', async () => {
    const outcome = await probeManagedLambda(managedLambda(), path.join(ROOT_A, 'answers', 'index.ts'));

    expect(outcome).toMatchObject({ answered: true, handlerReached: true });
  });

  it('reports a handler that answers without serverlessInboxSmokeTestOk as reached but not answered', async () => {
    const outcome = await probeManagedLambda(managedLambda(), path.join(ROOT_A, 'silent', 'index.ts'));

    expect(outcome).toMatchObject({ answered: false, handlerReached: true });
  });

  it('reports a handler whose serverlessInboxSmokeTestOk is not a boolean as reached but not answered', async () => {
    const outcome = await probeManagedLambda(managedLambda(), path.join(ROOT_A, 'answers-text', 'index.ts'));

    expect(outcome).toMatchObject({ answered: false, handlerReached: true });
  });

  it('reports a module that throws when loaded as not reached', async () => {
    const outcome = await probeManagedLambda(managedLambda(), path.join(ROOT_A, 'throws-on-load', 'index.ts'));

    expect(outcome).toMatchObject({ answered: false, handlerReached: false });
    expect(outcome.detail).toContain('fixture failed to load');
  });

  it('reports a module without the handler export the template names as not reached', async () => {
    const outcome = await probeManagedLambda(managedLambda({ handlerExport: 'other' }), path.join(ROOT_A, 'answers', 'index.ts'));

    expect(outcome).toMatchObject({ answered: false, handlerReached: false });
  });

  it('loads the handler under the environment of the Lambda and restores the environment afterwards', async () => {
    const source = path.join(ROOT_A, 'reads-environment', 'index.ts');

    const withFlag = await probeManagedLambda(managedLambda({ environment: { FIXTURE_FLAG: 'on' } }), source);

    expect(withFlag.detail).toContain('"serverlessInboxSmokeTestOk":true');
    expect(process.env.FIXTURE_FLAG).toBeUndefined();
  });
});
