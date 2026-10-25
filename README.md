# ServerlessInbox CDK constructs

[![Release](https://github.com/serverlessinbox/mailbox-cdk/actions/workflows/release.yml/badge.svg)](https://github.com/serverlessinbox/mailbox-cdk/actions/workflows/release.yml)

AWS CDK constructs for [ServerlessInbox](https://github.com/serverlessinbox/serverlessinbox), a
serverless JMAP email server for AWS, built for teams that already run on AWS and want email to
complete their stack. The constructs provision the whole server in your account: the JMAP, admin and
blob APIs, the admin and webmail frontends, mail receiving and sending on SES, and DNS automation.

> **Beta.** ServerlessInbox is in beta and is provided as is, without warranty (see
> [LICENSE](LICENSE)).
>
> **Issues and questions** go to the [ServerlessInbox repository](https://github.com/serverlessinbox/serverlessinbox),
> the single entry point for the whole product. Issues are not tracked in this repository.

## Install without CDK

To deploy the standard mailbox from a pre-built CloudFormation template, follow
[Deploy via CloudFormation](https://docs.serverlessinbox.com/tutorials/install-mailbox-standard/).
It lists the template parameters and the post-deploy steps, and starts from a Route53 hosted zone for
your domain. The zone may live in a different AWS account from the one you deploy into.

## Install with CDK

You need an AWS account, Node.js 24 and the
[AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html).

```sh
npm install @serverlessinbox/mailbox @serverlessinbox/mailbox-cognito \
  @serverlessinbox/artifact-registry-cdk aws-cdk-lib constructs
```

A minimal stack, with a Cognito user pool as the authentication provider and your Route53 hosted
zone serving the domain:

```typescript
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { HostedZoneLookup, Mailbox } from '@serverlessinbox/mailbox';
import { MailboxUserPool } from '@serverlessinbox/mailbox-cognito';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const zone = new HostedZoneLookup(this, 'HostedZone', {
      hostedZoneId: 'Z0123456789ABCDEFGHIJ',
    });

    const authProvider = new MailboxUserPool(this, 'UserPool', {
      domain: { kind: 'cognito-auto', hostedZone: zone.hostedZone },
    });

    new Mailbox(this, 'Mailbox', { hostedZone: zone.hostedZone, authProvider });
  }
}
```

## How the packages fit together

```mermaid
flowchart LR
  app["Your CDK app"] -->|new HostedZoneLookup, new Mailbox| mailbox["@serverlessinbox/mailbox"]
  app -->|new MailboxUserPool| cognito["@serverlessinbox/mailbox-cognito"]
  cognito -->|authProvider| mailbox
  shared["@serverlessinbox/mailbox-cdk-shared"] -. inlined at publish .-> mailbox
  shared -. inlined at publish .-> cognito
  adminapi["@serverlessinbox/mailbox-admin-api"] -. bundled into Lambda code .-> cognito
```

The app creates a `MailboxUserPool` and passes it to the `Mailbox` as its `authProvider`. The shared
artifact-resolution code is inlined into both published packages, and the Admin API handler SDK is
bundled into the Lambda code that `mailbox-cognito` deploys.

## Packages

| Package | Description |
|---------|-------------|
| [`@serverlessinbox/mailbox`](packages/mailbox/) | The `Mailbox` construct: the JMAP email server and everything around it |
| [`@serverlessinbox/mailbox-cognito`](packages/mailbox-cognito/) | Cognito user pool as the sign-in provider of a `Mailbox`, plus the user-management API for it |
| [`@serverlessinbox/mailbox-cdk-shared`](packages/mailbox-cdk-shared/) | Shared artifact-resolution infrastructure, inlined into the published packages |
| [`@serverlessinbox/mailbox-admin-api`](packages/mailbox-admin-api/) | Handler SDK for Lambdas that serve Admin API services: routing, auth context, validation and audit events |

## Where to look

| Question | Where |
|----------|-------|
| How do I create a mailbox in my own stack? | [`packages/mailbox/src/mailbox.ts`](packages/mailbox/src/mailbox.ts) and its props in [`packages/mailbox/src/mailbox-props.ts`](packages/mailbox/src/mailbox-props.ts) |
| How do I sign users in? | [`packages/mailbox-cognito/src/user-pool/`](packages/mailbox-cognito/src/user-pool/) |
| Which Lambdas, tables, queues and state machines exist? | [`packages/mailbox/src/resources/`](packages/mailbox/src/resources/), one file per resource |
| Where is a feature such as email, auth or the APIs assembled? | [`packages/mailbox/src/core/`](packages/mailbox/src/core/) |
| How does the mailbox update itself? | [`packages/mailbox/src/platform/`](packages/mailbox/src/platform/) |
| Where is the code that runs inside the TypeScript Lambdas? | `src/runtime/` of [`mailbox`](packages/mailbox/src/runtime/), `src/runtime/` and `src/ts-lambdas/` of [`mailbox-cognito`](packages/mailbox-cognito/src/ts-lambdas/) |
| How are deployable artifacts laid out in S3? | [`packages/mailbox/docs/artifacts.md`](packages/mailbox/docs/artifacts.md) |
| What changed between releases? | [`CHANGELOG.md`](CHANGELOG.md) |

## Documentation

Guides, tutorials and reference: [docs.serverlessinbox.com](https://docs.serverlessinbox.com)

## License

Apache 2.0, see [LICENSE](LICENSE).
