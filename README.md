# ServerlessInbox

A serverless, self-hosted JMAP email server for AWS, costing ~$1/month for personal use.

[![Release](https://github.com/serverlessinbox/mailbox-cdk/actions/workflows/release.yml/badge.svg)](https://github.com/serverlessinbox/mailbox-cdk/actions/workflows/release.yml)

## Prerequisites

- AWS account
- Node.js >= 20
- [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html)
- Yarn 4 (or npm)

## Quick start

```sh
npm install @serverlessinbox/mailbox
```

Minimal CDK stack example:

```ts
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Mailbox } from '@serverlessinbox/mailbox';

export class MyMailStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new Mailbox(this, 'Mailbox', {
      artifactContext: { version: '1.0.0' },
    });
  }
}
```

## Packages

| Package | Description |
|---|---|
| `@serverlessinbox/mailbox` | Core JMAP mail server CDK construct |
| `@serverlessinbox/mailbox-cognito` | Cognito user pool for email authentication |
| `@serverlessinbox/mailbox-admin-api` | Admin REST API CDK construct |

## Deployment guide

[https://docs.serverlessinbox.com](https://docs.serverlessinbox.com)

## License

Apache 2.0 — see [LICENSE](LICENSE).
