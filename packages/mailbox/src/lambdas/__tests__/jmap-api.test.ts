/// <reference types="jest" />

/**
 * ApiHandlerLambda (jmap-api) auth-key-store grant tests (grant-concept unit A).
 *
 * Verifies ApiHandlerLambda.grantRead grants exactly DynamoDbActions.read on the auth-key-store
 * table (and nothing broader, e.g. no Scan/PartiQL), and that the table-name env var is present.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { PinnedResolver, CdkArtifactEngine, DynamoDbActions, VENDOR_ACCOUNT_ID } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ApiHandlerLambda } from '../jmap-api';
import { AuthKeyStoreTable } from '../../features/auth-key-store/auth-key-store-table';
import { AuditEventsQueue } from '../../features/audit-writing/audit-events-queue';
import { EmailSendingQueue } from '../../email/sending/email-sending-queue';
import { DataTable } from '../../data/data-tables';
import { DataBlobStore } from '../../data/data-blob-store';

describe('ApiHandlerLambda auth-key-store grant', () => {
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
    const pinnedResolver = new PinnedResolver(stack, packages, { bucketBase: 'test-artifacts', project: 'serverlessinbox' }, {});
    pinnedResolver.registerPackages(['mailbox-go']);
    const artifactResolver: ICdkArtifactEngine = new CdkArtifactEngine(stack, pinnedResolver);

    const configTable = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const itemTable = new DataTable(new Table(stack, 'item-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const changelogTable = new DataTable(new Table(stack, 'changelog-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    authKeyStoreTable = new AuthKeyStoreTable(stack, 'auth-key-store');
    const blobStore = new DataBlobStore(new Bucket(stack, 'blob-store'));
    const emailSubmissionQueue = new EmailSendingQueue(stack, 'email-submission-queue');
    const auditEventsQueue = new AuditEventsQueue(stack, 'audit-events-queue');
    const identityProvisionerFunction = LambdaFunction.fromFunctionArn(
      stack,
      'identity-provisioner-ref',
      'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
    );

    new ApiHandlerLambda(stack, 'jmap-api', {
      configTable,
      itemTable,
      changelogTable,
      authKeyStoreTable,
      blobStore,
      emailSubmissionQueue,
      auditEventsQueue,
      cdnHost: 'cdn.example.com',
      apiBaseUrl: 'https://jmap.example.com',
      artifactResolver,
      identityProvisioner: identityProvisionerFunction,
      oauthHandlerConfig: {
        issuer: 'https://issuer.example.com',
        tokenEndpoint: 'https://issuer.example.com/token',
        authorizationEndpoint: 'https://issuer.example.com/authorize',
        clientId: 'test-client',
        scopeMap: {},
      },
      vendorAccountIds: [VENDOR_ACCOUNT_ID],
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

  it('grants exactly DynamoDbActions.read, Allow, on the table + index resources', () => {
    const expectedResource = stack.resolve([
      authKeyStoreTable.tableArn,
      `${authKeyStoreTable.tableArn}/index/*`,
    ]);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectEquals({
            Action: Match.arrayEquals([...DynamoDbActions.read]),
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
