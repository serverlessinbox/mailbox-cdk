/// <reference types="jest" />

/**
 * AuthKeyStoreUpdaterLambda auth-key-store grant tests (grant-concept unit A).
 *
 * Verifies AuthKeyStoreUpdaterLambda.grantReadWrite grants exactly DynamoDbActions.readWrite on
 * the auth-key-store table (and nothing broader, e.g. no Scan/PartiQL), and that the table-name
 * env var is present.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { PinnedResolver, CdkArtifactEngine, DynamoDbActions } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { AuthKeyStoreUpdaterLambda } from '../auth-key-store-updater';
import { AuthKeyStoreTable } from '../../features/auth-key-store/auth-key-store-table';

describe('AuthKeyStoreUpdaterLambda auth-key-store grant', () => {
  let stack: cdk.Stack;
  let template: Template;
  let authKeyStoreTable: AuthKeyStoreTable;

  beforeEach(() => {
    const app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-go': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactVersionsEntry> = {
      'mailbox-go': { version: '1.0.0', zone: 'regional' },
    };
    const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
    pinnedResolver.registerPackages(['mailbox-go']);
    const artifactResolver: ICdkArtifactEngine = new CdkArtifactEngine(stack, pinnedResolver);

    authKeyStoreTable = new AuthKeyStoreTable(stack, 'auth-key-store');

    new AuthKeyStoreUpdaterLambda(stack, 'auth-key-store-updater', {
      issuers: ['https://issuer.example.com'],
      authKeyStoreTable,
      artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  function authKeyStoreStatements(): Array<{ Action: unknown; Effect: unknown; Resource: unknown }> {
    const expectedResource = stack.resolve([
      authKeyStoreTable.tableArn,
      `${authKeyStoreTable.tableArn}/index/*`,
    ]);

    const policies = template.findResources('AWS::IAM::Policy');
    const allStatements = Object.values(policies).flatMap(
      (policy) => policy.Properties?.PolicyDocument?.Statement ?? [],
    );

    const expectedResourceJson = JSON.stringify(expectedResource);
    return allStatements.filter(
      (statement: { Resource?: unknown }) => JSON.stringify(statement.Resource) === expectedResourceJson,
    );
  }

  it('grants exactly DynamoDbActions.readWrite, Allow, on the table + index resources', () => {
    const expectedResource = stack.resolve([
      authKeyStoreTable.tableArn,
      `${authKeyStoreTable.tableArn}/index/*`,
    ]);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectEquals({
            Action: Match.arrayEquals([...DynamoDbActions.readWrite]),
            Effect: 'Allow',
            Resource: expectedResource,
          }),
        ]),
      },
    });
  });

  it('grants no Scan/PartiQL and no Deny on the auth-key-store table', () => {
    const statements = authKeyStoreStatements();
    const actionsFlat = statements.flatMap((statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]));

    expect(actionsFlat).not.toContain('dynamodb:Scan');
    expect(actionsFlat.some((action) => typeof action === 'string' && action.startsWith('dynamodb:PartiQL'))).toBe(false);
    expect(statements.some((statement) => statement.Effect === 'Deny')).toBe(false);
  });

  it('sets AUTH_KEY_STORE_TABLE_NAME on the function environment', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          AUTH_KEY_STORE_TABLE_NAME: Match.anyValue(),
        }),
      },
    });
  });
});
