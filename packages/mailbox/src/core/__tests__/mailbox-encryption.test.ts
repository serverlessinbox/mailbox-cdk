/// <reference types="jest" />

/**
 * Pins the encryption each data resource is created with for each KMS setting of a Mailbox. A
 * resource that silently falls back to weaker encryption than the operator asked for, or that is
 * encrypted with another resource's key, leaves data unprotected or unreadable; a customer-managed
 * resource without a key must fail the synth instead of deploying unencrypted.
 */

import { TableEncryption }                      from 'aws-cdk-lib/aws-dynamodb';
import * as kms                                 from 'aws-cdk-lib/aws-kms';
import { QueueEncryption }                      from 'aws-cdk-lib/aws-sqs';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import type { MailboxKmsConfig }                from '../kms';
import { MailboxEncryption }                    from '../mailbox-encryption';

function newKeys(): { shared: kms.IKey; blobStore: kms.IKey; dynamoTables: kms.IKey; queues: kms.IKey } {
  const stack = new Stack(new App(), 'test-stack', { synthesizer: new BootstraplessSynthesizer() });
  const keyOf = (id: string): kms.IKey => kms.Key.fromKeyArn(stack, id, `arn:aws:kms:us-west-2:111122223333:key/${id}`);
  return { shared: keyOf('shared'), blobStore: keyOf('blob-store'), dynamoTables: keyOf('dynamo-tables'), queues: keyOf('queues') };
}

describe('MailboxEncryption', () => {
  describe('AWS-managed encryption', () => {
    it.each([
      ['no KMS settings', undefined],
      ['mode aws-managed', { mode: 'aws-managed' }],
    ] as const)('passes no key on for %s', (_description, config) => {
      const plan = MailboxEncryption.plan(config);

      expect(plan.dynamoTables).toEqual({ encryption: TableEncryption.AWS_MANAGED });
      expect(plan.queues).toBeUndefined();
      expect(plan.blobStore).toEqual({ encryptionKey: undefined });
    });

    it('takes the excluded tables out of KMS and leaves the queues on the default', () => {
      const plan = MailboxEncryption.plan({ excluded: ['dynamodb'] });

      expect(plan.dynamoTables).toEqual({ encryption: TableEncryption.DEFAULT });
      expect(plan.queues).toBeUndefined();
    });

    it('takes the excluded queues out of KMS and leaves the tables on AWS-managed encryption', () => {
      const plan = MailboxEncryption.plan({ excluded: ['sqs'] });

      expect(plan.queues).toEqual({ encryption: QueueEncryption.UNENCRYPTED });
      expect(plan.dynamoTables).toEqual({ encryption: TableEncryption.AWS_MANAGED });
    });

    it('excludes every excludable resource in mode none and keeps the blob store keyless', () => {
      const plan = MailboxEncryption.plan({ mode: 'none' });

      expect(plan.dynamoTables).toEqual({ encryption: TableEncryption.DEFAULT });
      expect(plan.queues).toEqual({ encryption: QueueEncryption.UNENCRYPTED });
      expect(plan.blobStore).toEqual({ encryptionKey: undefined });
    });
  });

  describe('customer-managed encryption', () => {
    it('encrypts every resource with the shared key', () => {
      const { shared } = newKeys();

      const plan = MailboxEncryption.plan({ mode: 'customer-managed', key: shared });

      expect(plan.dynamoTables).toEqual({ encryption: TableEncryption.CUSTOMER_MANAGED, encryptionKey: shared });
      expect(plan.queues).toEqual({ encryption: QueueEncryption.KMS, encryptionMasterKey: shared });
      expect(plan.blobStore).toEqual({ encryptionKey: shared });
    });

    it('prefers the key of a resource type over the shared key', () => {
      const { shared, blobStore, dynamoTables, queues } = newKeys();

      const plan = MailboxEncryption.plan({ mode: 'customer-managed', key: shared, perResource: { blobStore, dynamoTables, queues } });

      expect(plan.dynamoTables).toEqual({ encryption: TableEncryption.CUSTOMER_MANAGED, encryptionKey: dynamoTables });
      expect(plan.queues).toEqual({ encryption: QueueEncryption.KMS, encryptionMasterKey: queues });
      expect(plan.blobStore).toEqual({ encryptionKey: blobStore });
    });

    it('falls back to the shared key for each resource type that perResource leaves out', () => {
      const { shared, blobStore } = newKeys();

      const plan = MailboxEncryption.plan({ mode: 'customer-managed', key: shared, perResource: { blobStore } });

      expect(plan.dynamoTables).toEqual({ encryption: TableEncryption.CUSTOMER_MANAGED, encryptionKey: shared });
      expect(plan.queues).toEqual({ encryption: QueueEncryption.KMS, encryptionMasterKey: shared });
      expect(plan.blobStore).toEqual({ encryptionKey: blobStore });
    });

    it('needs only the blob store key when the tables and the queues are excluded', () => {
      const { blobStore } = newKeys();

      const plan = MailboxEncryption.plan({ mode: 'customer-managed', excluded: ['dynamodb', 'sqs'], perResource: { blobStore } });

      expect(plan.dynamoTables).toEqual({ encryption: TableEncryption.DEFAULT });
      expect(plan.queues).toEqual({ encryption: QueueEncryption.UNENCRYPTED });
      expect(plan.blobStore).toEqual({ encryptionKey: blobStore });
    });

    it.each([
      ['DynamoDB', { dynamoTables: undefined }, "MailboxProps.kms.mode is 'customer-managed' but no DynamoDB KMS key was provided"],
      ['SQS', { queues: undefined }, "MailboxProps.kms.mode is 'customer-managed' but no SQS KMS key was provided"],
      ['blob store', { blobStore: undefined }, "MailboxProps.kms.mode is 'customer-managed' but no S3 KMS key was provided for the blob store"],
    ] as const)('fails the synth when the %s has no key', (_description, missing, message) => {
      const { blobStore, dynamoTables, queues } = newKeys();
      const config: MailboxKmsConfig            = { mode: 'customer-managed', perResource: { blobStore, dynamoTables, queues, ...missing } };

      expect(() => MailboxEncryption.plan(config)).toThrow(message);
    });
  });
});
