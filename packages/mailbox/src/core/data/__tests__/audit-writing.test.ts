/**
 * AuditWriting owns the audit-events queue (with its dead-letter queue) and the writer Lambda. These
 * tests pin what the construct adds: the two queues it creates, the audit log table it hands the
 * writer, and the queue defaults it passes through from its props.
 */
import type { BaseQueueProps }  from '@serverlessinbox/mailbox-cdk-shared';
import { Template }             from 'aws-cdk-lib/assertions';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { QueueEncryption }      from 'aws-cdk-lib/aws-sqs';

import { newDeployerTestStack } from '../../../__tests__/deployer-test-helpers';
import { DataTable }            from '../../../resources/tables/data-tables';
import { AuditWriting }         from '../audit-writing';

interface SynthesizedWriting {
  readonly template:       Template;
  readonly tableLogicalId: string;
}

function synthWriting(queueProps?: Partial<BaseQueueProps>): SynthesizedWriting {
  const { stack, artifactResolver } = newDeployerTestStack();
  const auditLogTable               = new DataTable(new Table(stack, 'audit-log-source', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
  }));
  new AuditWriting(stack, 'audit-writing', { auditLogTable, artifactResolver, queueProps });
  const template        = Template.fromStack(stack);
  const tableLogicalIds = Object.keys(template.findResources('AWS::DynamoDB::Table'));
  expect(tableLogicalIds).toHaveLength(1);
  return { template, tableLogicalId: tableLogicalIds[0] ?? '' };
}

describe('AuditWriting', () => {
  it('creates the audit-events queue beside its dead-letter queue', () => {
    const { template } = synthWriting();

    template.resourceCountIs('AWS::SQS::Queue', 2);
  });

  it('hands the audit log table to the writer as the table it writes', () => {
    const { template, tableLogicalId } = synthWriting();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { AUDIT_LOG_TABLE_NAME: { Ref: tableLogicalId } } },
    });
  });

  it('applies the queue props it is given to the audit-events queue and its dead-letter queue', () => {
    const { template } = synthWriting({ encryption: QueueEncryption.UNENCRYPTED });

    template.resourceCountIs('AWS::SQS::Queue', 2);
    template.allResourcesProperties('AWS::SQS::Queue', { SqsManagedSseEnabled: false });
  });
});
