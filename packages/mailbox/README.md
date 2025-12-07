# @mailbox/cdk

CDK Construct Library for Mailbox Infrastructure

## Installation

```bash
npm install @mailbox/cdk
# or
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
npm publish
```
