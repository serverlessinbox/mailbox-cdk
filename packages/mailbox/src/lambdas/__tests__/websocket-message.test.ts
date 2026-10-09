/// <reference types="jest" />

/**
 * WebSocketMessageLambda connections-table + push-API wiring tests (grant-concept unit B).
 *
 * Verifies WebSocketMessageLambda grants exactly DynamoDbActions.readWrite on the connections
 * table (no Scan/PartiQL/Deny), sets WEBSOCKET_API_ENDPOINT from the injected IWebSocketPushApi's
 * managementEndpoint, and calls grantManageConnections with itself as the grantee. The push API
 * is faked here: the real ARN/statement shape it produces is pinned by WebSocketPush's own tests.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import type { IGrantable } from 'aws-cdk-lib/aws-iam';
import { PinnedResolver, CdkArtifactEngine, DynamoDbActions } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { WebSocketMessageLambda } from '../websocket-message';
import { WebSocketTable } from '../../api/websocket/websocket-table';
import type { IWebSocketPushApi } from '../../api/websocket/websocket';
import { DataTable } from '../../data/data-tables';

class FakeWebSocketPushApi implements IWebSocketPushApi {
  public readonly managementEndpoint = 'https://fake.execute-api.us-west-2.amazonaws.com/prod';
  public readonly grantCalls: IGrantable[] = [];

  public grantManageConnections(grantee: IGrantable): void {
    this.grantCalls.push(grantee);
  }
}

describe('WebSocketMessageLambda connections-table and push-API wiring', () => {
  let stack: cdk.Stack;
  let template: Template;
  let fakePushApi: FakeWebSocketPushApi;
  let messageLambda: WebSocketMessageLambda;

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
    const connectionsTable = new WebSocketTable(stack, 'websocket-table');
    fakePushApi = new FakeWebSocketPushApi();

    messageLambda = new WebSocketMessageLambda(stack, 'websocket-message', {
      connectionsTable,
      configTable,
      itemTable,
      maxSubscriptions: 10,
      webSocketPushApi: fakePushApi,
      artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  function connectionsTableStatements(): Array<{ Action: unknown; Effect: unknown; Resource: unknown }> {
    const policies = template.findResources('AWS::IAM::Policy');
    const allStatements = Object.values(policies).flatMap(
      (policy) => policy.Properties?.PolicyDocument?.Statement ?? [],
    );

    const tableId = 'websockettablewebsocketEF927F93';
    const expectedResourceJson = JSON.stringify([
      { 'Fn::GetAtt': [tableId, 'Arn'] },
      { 'Fn::Join': ['', [{ 'Fn::GetAtt': [tableId, 'Arn'] }, '/index/*']] },
    ]);
    return allStatements.filter(
      (statement: { Resource?: unknown }) => JSON.stringify(statement.Resource) === expectedResourceJson,
    );
  }

  it('grants exactly DynamoDbActions.readWrite, Allow, on the connections table + index resources', () => {
    const tableId = 'websockettablewebsocketEF927F93';
    const expectedResource = [
      { 'Fn::GetAtt': [tableId, 'Arn'] },
      { 'Fn::Join': ['', [{ 'Fn::GetAtt': [tableId, 'Arn'] }, '/index/*']] },
    ];

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

  it('grants no Scan/PartiQL and no Deny on the connections table', () => {
    const statements = connectionsTableStatements();
    const actionsFlat = statements.flatMap((statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]));

    expect(actionsFlat).not.toContain('dynamodb:Scan');
    expect(actionsFlat.some((action) => typeof action === 'string' && action.startsWith('dynamodb:PartiQL'))).toBe(false);
    expect(statements.some((statement) => statement.Effect === 'Deny')).toBe(false);
  });

  it('calls grantManageConnections on the push API with itself as the grantee', () => {
    expect(fakePushApi.grantCalls).toEqual([messageLambda]);
  });

  it('sets WEBSOCKET_API_ENDPOINT from the push API managementEndpoint', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          WEBSOCKET_API_ENDPOINT: fakePushApi.managementEndpoint,
        }),
      },
    });
  });
});
