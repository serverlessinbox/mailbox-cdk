/// <reference types="jest" />

/**
 * IdentityProvisionerLambda wrapper tests.
 *
 * Pins the environment names the provisioner reads by name, the admin UI URL that is set only when an
 * admin UI is deployed, the execute-api:Invoke scope the license API needs, and that its role receives
 * write access to the tables, queue and blob store it is given. The resources' own grant sets are
 * asserted in their own files.
 */

import { actionsOf }                                 from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                  from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                      from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                                    from 'aws-cdk-lib/aws-s3';

import { DataBlobStore }                             from '../../buckets/data-blob-store';
import { AuditEventsQueue }                          from '../../queues/audit-events-queue';
import { EmailSendingQueue }                         from '../../queues/email-sending-queue';
import { DataTable }                                 from '../../tables/data-tables';
import { IdentityProvisionerLambda }                 from '../identity-provisioner-lambda';

import { arrangeWrapperStack, onlyLambdaOf }         from './lambda-wrapper-helpers';
import type { SynthesizedLambda }                    from './lambda-wrapper-helpers';

function synthesize(adminUIURL?: string): SynthesizedLambda {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const dataTable                   = (id: string): DataTable => new DataTable(new Table(stack, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } }));

  new IdentityProvisionerLambda(stack, 'identity-provisioner', {
    configTable:      dataTable('config-table'),
    itemTable:        dataTable('item-table'),
    changelogTable:   dataTable('changelog-table'),
    auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
    artifactResolver,
    blobStore:            new DataBlobStore(new Bucket(stack, 'blob-store')),
    emailSubmissionQueue: new EmailSendingQueue(stack, 'email-submission-queue'),
    sesConfigSetName:     'test-config-set',
    systemSenderAddress:  'noreply@example.com',
    vendorAccountIds:     ['123456789012'],
    ...(adminUIURL ? { adminUIURL } : {}),
  });

  return onlyLambdaOf(Template.fromStack(stack));
}

describe('IdentityProvisionerLambda', () => {
  it('sets the table, queue, blob store and SES names the provisioner reads', () => {
    expect(Object.keys(synthesize().environment)).toEqual(expect.arrayContaining([
      'CONFIG_TABLE_NAME',
      'ITEM_TABLE_NAME',
      'CHANGELOG_TABLE_NAME',
      'AUDIT_EVENTS_QUEUE_URL',
      'BLOB_STORAGE_NAME',
      'EMAIL_SUBMISSION_QUEUE_URL',
      'SES_CONFIG_SET_NAME',
      'SYSTEM_SENDER_ADDRESS',
    ]));
  });

  it('sets ADMIN_UI_URL when an admin UI URL is given', () => {
    expect(synthesize('https://admin.example.com').environment).toMatchObject({ ADMIN_UI_URL: 'https://admin.example.com' });
  });

  it('omits ADMIN_UI_URL when no admin UI is deployed', () => {
    expect(synthesize().environment).not.toHaveProperty('ADMIN_UI_URL');
  });

  it('lets the license API be invoked only on the grant and revoke routes of each vendor account', () => {
    const invoke = synthesize().statements.filter((statement) => actionsOf(statement).includes('execute-api:Invoke'));

    expect(invoke).toHaveLength(1);
    expect(invoke[0].Resource).toEqual([
      { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':execute-api:*:123456789012:*/*/POST/grant-resource']] },
      { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':execute-api:*:123456789012:*/*/POST/revoke-resource']] },
    ]);
  });

  it('gives its role write access to the tables, the audit and submission queues and the blob store it is given', () => {
    const actions = synthesize().statements.flatMap(actionsOf);

    expect(actions).toEqual(expect.arrayContaining(['dynamodb:PutItem', 'sqs:SendMessage', 's3:PutObject']));
  });
});
