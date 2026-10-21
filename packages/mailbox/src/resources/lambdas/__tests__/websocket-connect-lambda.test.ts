/// <reference types="jest" />

/**
 * WebSocketConnectLambda connections-table grant tests (grant-concept unit B).
 *
 * Verifies WebSocketConnectLambda grants exactly DynamoDbActions.readWrite on the connections table
 * (and nothing broader, e.g. no Scan/PartiQL/Deny), via the real WebSocketTable construct.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf, statementsForResource }     from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { PolicyStatementJson }             from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { DynamoDbActions }                      from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { WebSocketTable }                       from '../../tables/websocket-table';
import { DataTable }                            from '../../tables/data-tables';
import { WebSocketConnectLambda }               from '../websocket-connect-lambda';

describe('WebSocketConnectLambda connections-table grant', () => {
  let stack: cdk.Stack;
  let template: Template;
  let connectionsTable: WebSocketTable;

  beforeEach(() => {
    const app = new App();

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactPin> = {
      'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    const artifactResolver: IArtifactResolver   = new PinnedArtifactResolver({
      packages,
      location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    const configTable = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    connectionsTable  = new WebSocketTable(stack, 'websocket-table');

    new WebSocketConnectLambda(stack, 'websocket-connect', {
      connectionsTable,
      configTable,
      artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  function connectionsTableStatements(): PolicyStatementJson[] {
    const tableId = 'websockettablewebsocketEF927F93';
    return statementsForResource(template, [
      { 'Fn::GetAtt': [tableId, 'Arn'] },
      { 'Fn::Join': ['', [{ 'Fn::GetAtt': [tableId, 'Arn'] }, '/index/*']] },
    ]);
  }

  it('grants exactly DynamoDbActions.readWrite, Allow, on the connections table + index resources', () => {
    const tableId          = 'websockettablewebsocketEF927F93';
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
    const statements  = connectionsTableStatements();
    const actionsFlat = statements.flatMap(actionsOf);

    expect(actionsFlat).not.toContain('dynamodb:Scan');
    expect(actionsFlat.some((action) => typeof action === 'string' && action.startsWith('dynamodb:PartiQL'))).toBe(false);
    expect(statements.some((statement) => statement.Effect === 'Deny')).toBe(false);
  });
});
