/// <reference types="jest" />

/**
 * WebSocketDisconnectLambda removes connections: its only policy statement that touches the connections table
 * grants Query and DeleteItem on the table itself, with no index.
 */

import { Template }                             from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                 from 'aws-cdk-lib/aws-dynamodb';
import type * as cdk                            from 'aws-cdk-lib';

import { defaultCfnResource }                   from '../../../utils/cfn-resource';
import { DataTable }                            from '../../tables/data-tables';
import { WebSocketTable }                       from '../../tables/websocket-table';
import { WebSocketDisconnectLambda }            from '../websocket-disconnect-lambda';

import { arrangeWrapperStack }                  from './lambda-wrapper-helpers';

interface PolicyResource {
  readonly Type:        string;
  readonly Properties?: { readonly PolicyDocument?: { readonly Statement?: unknown[] } };
}

function statementsOnTable(template: Template, tableId: string): unknown[] {
  const resources = template.toJSON().Resources as Record<string, PolicyResource>;
  return Object.values(resources)
    .filter((resource) => resource.Type === 'AWS::IAM::Policy')
    .flatMap((resource) => resource.Properties?.PolicyDocument?.Statement ?? [])
    .filter((statement) => JSON.stringify(statement).includes(tableId));
}

describe('WebSocketDisconnectLambda connections-table grant', () => {
  let stack: cdk.Stack;
  let template: Template;
  let tableId: string;

  beforeEach(() => {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;

    const configTable      = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const connectionsTable = new WebSocketTable(stack, 'websocket-table');
    tableId                = stack.getLogicalId(defaultCfnResource(connectionsTable));

    new WebSocketDisconnectLambda(stack, 'websocket-disconnect', {
      connectionsTable,
      configTable,
      artifactResolver: arrangement.artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  it('grants exactly one statement on the connections table: Query and DeleteItem on the table, no index', () => {
    expect(statementsOnTable(template, tableId)).toEqual([
      {
        Action:   ['dynamodb:Query', 'dynamodb:DeleteItem'],
        Effect:   'Allow',
        Resource: { 'Fn::GetAtt': [tableId, 'Arn'] },
      },
    ]);
  });
});
