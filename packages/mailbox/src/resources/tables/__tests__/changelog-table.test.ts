/// <reference types="jest" />

/**
 * ChangelogTable: a numeric sort key (the state version) and the TTL attribute `x`, and the settings the
 * table takes from its props. Entries written under another attribute name would never expire, and a
 * string sort key would break version ordering.
 */

import { Match, Template }                                         from 'aws-cdk-lib/assertions';
import * as kms                                                    from 'aws-cdk-lib/aws-kms';

import { ChangelogTable }                                          from '../changelog-table';

import { DATA_TABLE_PROPS, createDataTableStack, propsWithKey }    from './data-table-helpers';

describe('ChangelogTable', () => {
  it('is keyed by string pk and numeric sk, expires entries on x and has no secondary index', () => {
    const stack = createDataTableStack();
    new ChangelogTable(stack, DATA_TABLE_PROPS);

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema:               [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
      AttributeDefinitions:    [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'N' }],
      TimeToLiveSpecification: { AttributeName: 'x', Enabled: true },
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', { GlobalSecondaryIndexes: Match.absent() });
  });

  it('takes its name base, customer-managed key and point-in-time recovery from its props', () => {
    const stack = createDataTableStack();
    const key   = new kms.Key(stack, 'key');
    new ChangelogTable(stack, propsWithKey(key));

    const keyArn: unknown = stack.resolve(key.keyArn);
    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName:                        { 'Fn::Join': ['', [{ Ref: 'AWS::AccountId' }, '-custom-changelog-table']] },
      SSESpecification:                 { SSEEnabled: true, SSEType: 'KMS', KMSMasterKeyId: keyArn },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
    });
  });
});
