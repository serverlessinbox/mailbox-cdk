# @mailbox/cdk

CDK Construct Library for Mailbox Infrastructure

## Installation

```bash
yarn add @mailbox/cdk
```

## Peer Dependencies

This library requires:
- `aws-cdk-lib` >= 2.224.0
- `constructs` >= 10.0.0

## Usage

### Basic Stack

```typescript
import { MailboxStack } from '@mailbox/cdk';
import { App } from 'aws-cdk-lib';

const app = new App();
new MailboxStack(app, 'MailboxStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
```

### Mailbox UI defaults

By default, the `Mailbox` construct provisions both UIs:
- Admin UI (`admin.<domain>`)
- Webmail UI (`webmail.<domain>`)

You can opt out per UI:

```ts
new Mailbox(this, 'mailbox', {
  domainName: 'example.com',
  authProvider,

  // Optional: add extra origins (e.g., local dev). UI origins are derived automatically.
  // Note: Admin API CORS allows the Admin UI origin; JMAP API CORS allows the Webmail UI origin.
  extraAllowedOrigins: ['http://localhost:3000'],

  // Defaults: true
  createAdminUi: true,
  createWebmailUi: true,
});

### KMS encryption (optional)

By default, core storage uses AWS-managed KMS keys for at-rest encryption:
- Email bucket: SSE-KMS with the AWS-managed S3 key
- Core DynamoDB tables: AWS-managed KMS
- Core SQS queues: SSE-KMS with the AWS-managed SQS key

Note: the SES notifications queue is subscribed to an SNS topic. AWS-managed SQS KMS keys can't be used with SNS subscriptions,
so that specific queue defaults to unencrypted unless you provide a customer-managed CMK.

You can optionally provide a customer-managed KMS key (CMK) for stricter control:

```ts
import * as kms from 'aws-cdk-lib/aws-kms';

const mailboxKey = new kms.Key(this, 'mailbox-kms-key', {
  enableKeyRotation: true,
});

new Mailbox(this, 'mailbox', {
  domainName: 'example.com',
  authProvider,
  kms: {
    mode: 'customer-managed',
    key: mailboxKey,
  },
});
```

You can also disable KMS usage (where applicable) or exclude specific resources:

```ts
// No KMS for S3/SQS; DynamoDB uses AWS-owned encryption.
new Mailbox(this, 'mailbox', {
  domainName: 'example.com',
  authProvider,
  kms: { mode: 'none' },
});

// Use AWS-managed KMS for DynamoDB+SQS, but keep S3 on SSE-S3.
new Mailbox(this, 'mailbox', {
  domainName: 'example.com',
  authProvider,
  kms: { mode: 'aws-managed', except: ['s3'] },
});
```
```

### Lambda Code Providers

#### Local Development

```typescript
import { LocalLambdaCodeProvider } from '@mailbox/cdk';

const provider = new LocalLambdaCodeProvider({
  basePath: './dist/lambdas',
});
```

#### Production (S3)

```typescript
import { UrlLambdaCodeProvider } from '@mailbox/cdk';

const provider = new UrlLambdaCodeProvider({
  s3Bucket: 'my-lambda-bucket',
  s3KeyPrefix: 'lambdas/v1.0.0/',
});
```

## Building

```bash
yarn install
yarn build
```

## Publishing

```bash
yarn build
```
