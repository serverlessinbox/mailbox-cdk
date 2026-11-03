/**
 * AuditWriting owns the audit-events queue (with its dead-letter queue) and the writer Lambda. These
 * tests pin what the construct adds: the two queues it creates, the audit log table it hands the
 * writer, and the encryption it passes through to the queues.
 */
import type { QueueEncryptionChoice } from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                   from 'aws-cdk-lib/assertions';
import { AttributeType, Table }       from 'aws-cdk-lib/aws-dynamodb';

import { newDeployerTestStack }       from '../../../__tests__/deployer-test-helpers';
import { DataTable }                  from '../../../resources/tables/data-tables';
import { AuditWriting }               from '../audit-writing';

interface SynthesizedWriting {
  readonly template:       Template;
  readonly tableLogicalId: string;
}

const AWS_MANAGED: QueueEncryptionChoice = { kind: 'aws-managed' };

function synthWriting(queueEncryption: QueueEncryptionChoice): SynthesizedWriting {
  const { stack, artifactResolver } = newDeployerTestStack();
  const auditLogTable               = new DataTable(new Table(stack, 'audit-log-source', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
  }));
  new AuditWriting(stack, 'audit-writing', { auditLogTable, artifactResolver, queueEncryption });
  const template        = Template.fromStack(stack);
  const tableLogicalIds = Object.keys(template.findResources('AWS::DynamoDB::Table'));
  expect(tableLogicalIds).toHaveLength(1);
  return { template, tableLogicalId: tableLogicalIds[0] ?? '' };
}

describe('AuditWriting', () => {
  it('creates the audit-events queue beside its dead-letter queue', () => {
    const { template } = synthWriting(AWS_MANAGED);

    template.resourceCountIs('AWS::SQS::Queue', 2);
  });

  it('hands the audit log table to the writer as the table it writes', () => {
    const { template, tableLogicalId } = synthWriting(AWS_MANAGED);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { AUDIT_LOG_TABLE_NAME: { Ref: tableLogicalId } } },
    });
  });

  it('applies the encryption it is given to the audit-events queue and its dead-letter queue', () => {
    const { template } = synthWriting({ kind: 'unencrypted' });

    template.resourceCountIs('AWS::SQS::Queue', 2);
    template.allResourcesProperties('AWS::SQS::Queue', { SqsManagedSseEnabled: false });
  });
});
