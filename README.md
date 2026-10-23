# ServerlessInbox

A serverless, self-hosted JMAP email server for AWS, costing ~$1/month for personal use.

[![Release](https://github.com/serverlessinbox/mailbox-cdk/actions/workflows/release.yml/badge.svg)](https://github.com/serverlessinbox/mailbox-cdk/actions/workflows/release.yml)

## Launch Stack

[![Launch Stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)](https://eu-west-1.console.aws.amazon.com/cloudformation/home?region=eu-west-1#/stacks/create/review?templateURL=https://mailbox-artifacts-eu-west-1.s3.eu-west-1.amazonaws.com/templates/mailbox-standard/releases/latest/template.json)

**Prerequisites:**
- A Route53 hosted zone for your domain (the zone may be in a different AWS account from where you deploy)
- ~10 minutes for stack completion

For the full deployment guide including post-deploy steps, see [Deploy via CloudFormation](https://serverlessinbox.com/docs/guides/deploy-cloudformation/).

## Prerequisites

- AWS account
- Node.js ≥ 20
- [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html)
- Yarn 4 (or npm)

## Quick Start

```sh
npm install @serverlessinbox/mailbox @serverlessinbox/mailbox-cognito
```

Minimal CDK stack, with a Cognito user pool as the authentication provider:

```typescript
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Mailbox } from '@serverlessinbox/mailbox';
import { MailboxUserPool } from '@serverlessinbox/mailbox-cognito';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const authProvider = new MailboxUserPool(this, 'UserPool', {
      domain: { kind: 'cognito', cognitoDomainPrefix: 'my-mailbox' },
    });

    new Mailbox(this, 'Mailbox', { authProvider });
  }
}
```

## Architecture

```mermaid
flowchart LR
  app["Your CDK app"] -->|new Mailbox| mailbox["@serverlessinbox/mailbox"]
  app -->|new MailboxUserPool| cognito["@serverlessinbox/mailbox-cognito"]
  cognito -->|authProvider| mailbox
  shared["@serverlessinbox/mailbox-cdk-shared"] -. inlined at publish .-> mailbox
  shared -. inlined at publish .-> cognito
```

The app creates a `MailboxUserPool` and passes it to the `Mailbox` as its `authProvider`. The shared
artifact-resolution code is inlined into both published packages.

## Packages

| Package | Description |
|---------|-------------|
| [`@serverlessinbox/mailbox`](packages/mailbox/) | Core JMAP email server construct |
| [`@serverlessinbox/mailbox-cognito`](packages/mailbox-cognito/) | Cognito user pool integration |
| [`@serverlessinbox/mailbox-cdk-shared`](packages/mailbox-cdk-shared/) | Shared artifact-resolution infrastructure, inlined into the published packages |
| [`@serverlessinbox/mailbox-admin-api`](packages/mailbox-admin-api/) | Admin API construct |

## Documentation

Full deployment guide: [docs.serverlessinbox.com](https://docs.serverlessinbox.com)

## License

Apache 2.0 — see [LICENSE](LICENSE).
