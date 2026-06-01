# ServerlessInbox

A serverless, self-hosted JMAP email server for AWS, costing ~$1/month for personal use.

[![Build](https://github.com/serverlessinbox/mailbox-cdk/actions/workflows/build.yml/badge.svg)](https://github.com/serverlessinbox/mailbox-cdk/actions/workflows/build.yml)

## Prerequisites

- AWS account
- Node.js ≥ 20
- [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html)
- Yarn 4 (or npm)

## Quick Start

```sh
npm install @serverlessinbox/mailbox
```

Minimal CDK stack:

```typescript
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Mailbox } from '@serverlessinbox/mailbox';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new Mailbox(this, 'Mailbox', {
      artifactContext: { version: '0.1.0' },
    });
  }
}
```

## Packages

| Package | Description |
|---------|-------------|
| [`@serverlessinbox/mailbox`](packages/mailbox/) | Core JMAP email server construct |
| [`@serverlessinbox/mailbox-cognito`](packages/mailbox-cognito/) | Cognito user pool integration |
| [`@serverlessinbox/mailbox-admin-api`](packages/mailbox-admin-api/) | Admin API construct |

## Documentation

Full deployment guide: [docs.serverlessinbox.com](https://docs.serverlessinbox.com)

## License

Apache 2.0 — see [LICENSE](LICENSE).
