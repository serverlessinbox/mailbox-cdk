/// <reference types="jest" />

/**
 * Contract between the artifact updater and the Lambdas `MailboxUserPool` adds to a stack. The updater keeps
 * new code only when the Lambda answers its smoke-test probe `{ serverlessInboxSmokeTest: true }` with a JSON
 * object that holds a boolean `serverlessInboxSmokeTestOk`; any other outcome rolls the update back. A managed
 * Lambda whose handler does not answer is therefore never updated, and this suite fails when one exists.
 *
 * The managed Lambdas are read from a synthesized template that holds a `MailboxUserPool` with dynamic client
 * registration enabled, a bootstrap user and the admin API addons, so that every Lambda of this package is
 * present. The `Mailbox` suite of the mailbox package cannot cover them: it synthesizes with a fake auth provider.
 */

import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import {
  handlerSourceOf,
  managedLambdasOf,
  probeManagedLambda,
  type ManagedLambda,
} from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { MailboxArtifactResolverFactory }     from '@serverlessinbox/mailbox-cdk-shared';
import type { AdminApiAddonContext }          from '@serverlessinbox/mailbox';
import { Template }                           from 'aws-cdk-lib/assertions';
import * as cdk                               from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }      from 'aws-cdk-lib';
import * as path                              from 'node:path';

import { loadMailboxCognitoArtifactVersions } from '../mailbox-cognito-artifact-versions';
import { loadMailboxCognitoRegistryRecord }   from '../mailbox-cognito-registry-record';
import { DynamicClientRegistrationMode }      from '../user-pool/dynamic-client-registration-mode';
import { MailboxUserPool }                    from '../user-pool/mailbox-user-pool';

const TS_LAMBDA_ROOTS = [path.join(__dirname, '..', 'ts-lambdas'), path.join(__dirname, '..', 'runtime')];

const COGNITO_LAMBDAS = ['cognito-bootstrap-user', 'cognito-idp-users-api', 'jmap-oauth-dcr'];

/** The artifact `cognito-bootstrap-user` is bundled from the folder `bootstrap-user`; the others are bundled from the folder of their own name. */
function sourceFolderOf(artifactName: string): string {
  return artifactName === 'cognito-bootstrap-user' ? 'bootstrap-user' : artifactName;
}

const dataTableStub = {
  tableName:      'stub-table',
  tableArn:       'arn:aws:dynamodb:us-west-2:123456789012:table/stub-table',
  grantRead:      () => undefined,
  grantReadWrite: () => undefined,
};

function adminApiAddonContextOf(artifactResolver: IArtifactResolver): AdminApiAddonContext {
  return {
    artifactResolver,
    auditEventsQueue:    {
      queueUrl:  'https://sqs.us-west-2.amazonaws.com/123456789012/audit-events',
      queueArn:  'arn:aws:sqs:us-west-2:123456789012:audit-events',
      grantSend: () => undefined,
    },
    configTable:         dataTableStub,
    auditLogTable:       dataTableStub,
    identityProvisioner: {
      functionArn:  'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
      functionName: 'identity-provisioner',
      grantInvoke:  () => undefined,
    },
  };
}

function synthesizeUserPool(): Template {
  const app      = new App({
    context: {
      'serverlessinbox:artifacts':         {
        bucketBase: 'test-artifacts',
        packages:   {
          'mailbox-cognito':    { zone: 'regional', version: '1.0.0' },
          'mailbox-cdk':        { zone: 'regional', version: '1.0.0' },
          'mailbox':            { zone: 'regional', version: '1.0.0' },
          'mailbox-cdk-shared': { zone: 'regional', version: '1.0.0' },
        },
      },
      'serverlessinbox:artifact_versions': {},
    },
  });
  const stack    = new cdk.Stack(app, 'TestManagedCognitoLambdas', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const resolver = MailboxArtifactResolverFactory.fromContext(
    stack,
    loadMailboxCognitoRegistryRecord(),
    loadMailboxCognitoArtifactVersions(),
  );

  const pool = new MailboxUserPool(stack, 'user-pool', {
    domain:                    { kind: 'cognito', cognitoDomainPrefix: 'test-managed' },
    artifactResolver:          resolver,
    enableJmapOAuthDiscovery:  true,
    dynamicClientRegistration: DynamicClientRegistrationMode.ENABLED,
  });
  pool.addBootstrapUser({ groups: ['admin'] });
  const addonContext = adminApiAddonContextOf(resolver);
  pool.createAdminApiAddons(stack, addonContext);
  pool.createJmapApiAddons(stack, {
    apiBaseUrl:          'https://api.example.com',
    identityProvisioner: addonContext.identityProvisioner,
  });

  return Template.fromStack(stack);
}

describe('Lambdas of MailboxUserPool the artifact updater manages', () => {
  let managed: ManagedLambda[];

  beforeAll(() => {
    managed = managedLambdasOf(synthesizeUserPool());
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

  it('include the bootstrap user, idp users and dynamic client registration Lambdas', () => {
    const artifactNames = managed.map((lambda) => lambda.artifactName);

    expect(COGNITO_LAMBDAS.filter((name) => !artifactNames.includes(name))).toEqual([]);
  });

  it('answer the smoke-test probe with a boolean serverlessInboxSmokeTestOk', async () => {
    const failures: string[] = [];

    for (const lambda of managed.filter((candidate) => COGNITO_LAMBDAS.includes(candidate.artifactName))) {
      const source = await handlerSourceOf(sourceFolderOf(lambda.artifactName), TS_LAMBDA_ROOTS);
      if (source === undefined) {
        failures.push(`${lambda.artifactName} (${lambda.logicalId}): no bundle entry`);
        continue;
      }
      const outcome = await probeManagedLambda(lambda, source);
      if (!outcome.answered) {
        failures.push(`${lambda.artifactName} (${lambda.logicalId}): ${outcome.detail}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
