/// <reference types="jest" />

/**
 * AuditLogTable: the key schema and the three secondary indexes of the audit log, and the settings the
 * table takes from its props. Item keys are written under these names, so a change here makes stored
 * entries unreachable.
 */

import { Match, Template }                                         from 'aws-cdk-lib/assertions';
import * as kms                                                    from 'aws-cdk-lib/aws-kms';

import { AuditLogTable }                                           from '../auditlog-table';

import { DATA_TABLE_PROPS, createDataTableStack, propsWithKey }    from './data-table-helpers';

describe('AuditLogTable', () => {
  it('is keyed by string pk and sk and has the indexes gsi1 to gsi3', () => {
    const stack = createDataTableStack();
    new AuditLogTable(stack, DATA_TABLE_PROPS);

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema:              [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
      GlobalSecondaryIndexes: [
        Match.objectLike({ IndexName: 'gsi1' }),
        Match.objectLike({ IndexName: 'gsi2' }),
        Match.objectLike({ IndexName: 'gsi3' }),
      ],
      AttributeDefinitions:   Match.arrayWith([{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }]),
    });
  });

  it('takes its name base, customer-managed key and point-in-time recovery from its props', () => {
    const stack = createDataTableStack();
    const key   = new kms.Key(stack, 'key');
    new AuditLogTable(stack, propsWithKey(key));

    const keyArn: unknown = stack.resolve(key.keyArn);
    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName:                        { 'Fn::Join': ['', [{ Ref: 'AWS::AccountId' }, '-custom-auditlog-table']] },
      SSESpecification:                 { SSEEnabled: true, SSEType: 'KMS', KMSMasterKeyId: keyArn },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
    });
  });
});
