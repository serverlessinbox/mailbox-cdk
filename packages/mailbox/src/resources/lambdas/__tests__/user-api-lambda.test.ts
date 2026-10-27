/// <reference types="jest" />

/**
 * UserApiLambda tests: the environment the user-api Lambda is given and the grants it gives itself.
 * The function is the only Lambda in its stack, so both are read from the synthesized template. A
 * grant that drifts from what the handler calls, or an extra environment name, stays green in tsc
 * and synth, so these assertions are the only guard.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                 from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { AuditEventsQueue }                     from '../../queues/audit-events-queue';
import { DataTable }                            from '../../tables/data-tables';
import { UserApiLambda }                        from '../user-api-lambda';

const ITEM_TABLE_ACTIONS: string[]   = ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'];
const CONFIG_TABLE_ACTIONS: string[] = ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query'];
const AUDIT_QUEUE_ACTION             = 'sqs:SendMessage';

describe('UserApiLambda', () => {
  let stack: cdk.Stack;
  let itemTableArnOf: unknown;
  let configTableArnOf: unknown;

  function dataTable(id: string): DataTable {
    return new DataTable(new Table(stack, id, {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey:      { name: 'sk', type: AttributeType.STRING },
    }));
  }

  function synthesize(): Template {
    const configTable      = dataTable('config-table');
    const itemTable        = dataTable('item-table');
    const auditEventsQueue = new AuditEventsQueue(stack, 'audit-events-queue');
    const artifactResolver = new PinnedArtifactResolver({
      packages:         {
        'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        'mailbox-go':  { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      },
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    new UserApiLambda(stack, 'user-api', { configTable, itemTable, auditEventsQueue, artifactResolver });

    itemTableArnOf   = stack.resolve(itemTable.tableArn);
    configTableArnOf = stack.resolve(configTable.tableArn);

    return Template.fromStack(stack);
  }

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('gives the function exactly the environment names its config reads', () => {
    const template = synthesize();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectEquals({
          CONFIG_TABLE_NAME:      Match.anyValue(),
          ITEM_TABLE_NAME:        Match.anyValue(),
          AUDIT_EVENTS_QUEUE_URL: Match.anyValue(),
          SERVICE_NAME:           'user-api',
        }),
      },
    });
  });

  it('grants read and write on the item table with exactly the actions the handler uses', () => {
    const template = synthesize();

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: ITEM_TABLE_ACTIONS, Resource: Match.arrayWith([itemTableArnOf]) })]),
      },
    });
  });

  it('grants read only on the config table', () => {
    const template = synthesize();

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: CONFIG_TABLE_ACTIONS, Resource: Match.arrayWith([configTableArnOf]) })]),
      },
    });
  });

  it('grants send only on the audit-events queue', () => {
    const template = synthesize();

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: AUDIT_QUEUE_ACTION })]),
      },
    });
  });
});
