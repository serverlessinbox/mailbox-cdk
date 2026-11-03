/// <reference types="jest" />

/**
 * PatTable: the key schema and the two keys-only secondary indexes of the token table, the settings the table takes
 * from its props, and the `ttl` attribute its rows expire through.
 */

import { Match, Template }                                      from 'aws-cdk-lib/assertions';
import * as kms                                                 from 'aws-cdk-lib/aws-kms';

import { PatTable }                                             from '../pat-table';

import { DATA_TABLE_PROPS, createDataTableStack, propsWithKey } from './data-table-helpers';

describe('PatTable', () => {
  it('is keyed by string pk and sk and has the keys-only indexes gsi1 and gsi2', () => {
    const stack = createDataTableStack();
    new PatTable(stack, DATA_TABLE_PROPS);

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema:              [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
      GlobalSecondaryIndexes: [
        Match.objectLike({ IndexName: 'gsi1', Projection: { ProjectionType: 'KEYS_ONLY' } }),
        Match.objectLike({ IndexName: 'gsi2', Projection: { ProjectionType: 'KEYS_ONLY' } }),
      ],
      AttributeDefinitions:   Match.arrayWith([{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }]),
    });
  });

  it('takes its name base, customer-managed key and point-in-time recovery from its props', () => {
    const stack = createDataTableStack();
    const key   = new kms.Key(stack, 'key');
    new PatTable(stack, propsWithKey(key));

    const keyArn: unknown = stack.resolve(key.keyArn);
    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName:                        { 'Fn::Join': ['', [{ Ref: 'AWS::AccountId' }, '-custom-pat-table']] },
      SSESpecification:                 { SSEEnabled: true, SSEType: 'KMS', KMSMasterKeyId: keyArn },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
    });
  });

  it('expires rows through the ttl attribute', () => {
    const stack = createDataTableStack();
    new PatTable(stack, DATA_TABLE_PROPS);

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });
});
