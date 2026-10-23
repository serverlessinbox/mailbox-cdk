/**
 * MailboxDataStackRef imports the data sub-stack's tables and bucket by ARN. These tests pin what it
 * adds: each ARN lands on its own table, the bucket is exposed both raw and as the grant handle over
 * it, and the import creates nothing in the stack.
 */
import { Template }                                           from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, Stack }               from 'aws-cdk-lib';

import { MailboxDataStackRef, type MailboxDataStackRefProps } from '../mailbox-data-stack-ref';

const PROPS: MailboxDataStackRefProps = {
  configTableArn:       'arn:aws:dynamodb:us-west-2:111122223333:table/config',
  itemTableArn:         'arn:aws:dynamodb:us-west-2:111122223333:table/item',
  changelogTableArn:    'arn:aws:dynamodb:us-west-2:111122223333:table/changelog',
  auditLogTableArn:     'arn:aws:dynamodb:us-west-2:111122223333:table/audit-log',
  mailFeedbackTableArn: 'arn:aws:dynamodb:us-west-2:111122223333:table/mail-feedback',
  blobStoreArn:         'arn:aws:s3:::blob-store',
};

function synthRef(): { stack: Stack; ref: MailboxDataStackRef; template: Template } {
  const stack = new Stack(new App(), 'test-stack', { synthesizer: new BootstraplessSynthesizer() });
  const ref   = new MailboxDataStackRef(stack, 'data-ref', PROPS);
  return { stack, ref, template: Template.fromStack(stack) };
}

describe('MailboxDataStackRef', () => {
  it('imports each table from its own ARN', () => {
    const { stack, ref } = synthRef();

    expect(stack.resolve(ref.configTable.tableArn)).toBe(PROPS.configTableArn);
    expect(stack.resolve(ref.itemTable.tableArn)).toBe(PROPS.itemTableArn);
    expect(stack.resolve(ref.changelogTable.tableArn)).toBe(PROPS.changelogTableArn);
    expect(stack.resolve(ref.auditLogTable.tableArn)).toBe(PROPS.auditLogTableArn);
    expect(stack.resolve(ref.mailFeedbackTable.tableArn)).toBe(PROPS.mailFeedbackTableArn);
  });

  it('exposes the blob store bucket raw and as the grant handle over that same bucket', () => {
    const { stack, ref } = synthRef();

    expect(stack.resolve(ref.blobStoreBucket.bucketArn)).toBe(PROPS.blobStoreArn);
    expect(stack.resolve(ref.blobStore.bucketName)).toBe('blob-store');
  });

  it('creates no table or bucket: the references only import what the data sub-stack owns', () => {
    const { template } = synthRef();

    template.resourceCountIs('AWS::DynamoDB::Table', 0);
    template.resourceCountIs('AWS::S3::Bucket', 0);
  });
});
