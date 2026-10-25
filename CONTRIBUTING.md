# Contributing

This guide is for a contributor who knows TypeScript but is not a CDK expert. For how the constructs
fit together at runtime, read [docs/architecture.md](docs/architecture.md) first.

## Packages

The workspaces live in `packages/`.

| Package | What it is | Published |
|---------|------------|-----------|
| `@serverlessinbox/mailbox` (`packages/mailbox`) | The `Mailbox` construct: the JMAP email server and everything around it | Yes |
| `@serverlessinbox/mailbox-cognito` (`packages/mailbox-cognito`) | Cognito user pool as the sign-in provider of a `Mailbox`, plus its user-management API | Yes |
| `@serverlessinbox/mailbox-cdk-shared` (`packages/mailbox-cdk-shared`) | Shared artifact resolution, Lambda base classes, tagging and naming helpers | No, `"private": true` |
| `@serverlessinbox/mailbox-addon-sdk` (`packages/mailbox-addon-sdk`) | Handler SDK for Lambdas that serve Admin API services of addons | No, internal; it is bundled into the Lambda code that serves addon routes |
| `@serverlessinbox/mailbox-bundler` (`packages/mailbox-bundler`) | esbuild bundler for the jsii packages and the Lambda zips | No, `"private": true` |
| `@serverlessinbox/eslint-plugin-mailbox` (`packages/eslint-plugin-mailbox`) | Dev-only ESLint plugin that enforces the rules below | No, `"private": true` |

## Where things live in `mailbox`

Everything is under `packages/mailbox/src`.

- `core/<section>/` is the mail server: `apis`, `auth`, `data`, `domains`, `edge`, `email`, `search`
  and `ui`. Each section has a `<section>-section.ts` class that `Mailbox` instantiates.
- `platform/<area>/` holds the features around the mail server: `ops`, `support` and `update`.
- `resources/<kind>/` holds one resource per file: `buckets`, `events`, `lambdas`, `queues`, `roles`,
  `tables`, `topics` and `workflows`. Each class owns its own grants.
- `contracts/` holds the names, payload types and constants that both `core` and `platform` read.
- `runtime/` holds the code that runs inside Lambdas (`artifact-updater`, `data-override-resolver`,
  `jmap-blob-download`, `resource-sweeper`). It is kept apart from the constructs.

## Rules a newcomer trips over

**`core` never imports `platform`.** The `zone-imports` lint rule fails the build when it does. Why:
the mail server must work without any optional feature, so a `platform` feature reaches `core` only
through an addon interface (`IAdminApiAddon` in `core/apis/addons.ts`), never by an import.

**One class per file.** The `max-classes-per-file` lint rule allows one. Why: you find a class by its
file name, and the class's props interface sits in the same file.

**A Lambda gets its environment only in its own wrapper.** Write every variable literally in the
`environment` map of the wrapper's `super()` call. A value that only exists later is set by a
named method of the wrapper, such as `enableWebSocketPush` in `admin-api-lambda.ts`, which calls
`this.addEnvironment`; nothing outside the wrapper calls `addEnvironment` on it. Why: the map is then the complete list of what the function receives, and the Lambda's
`config.ts` reads the same literal names.

**A construct never declares a `CfnParameter` or a `CfnOutput`.** Only a stack class does (for
example `MailboxEdgeStack` and `MailboxDataStack`). A construct exposes a value as a `public readonly`
property and the stack decides what becomes an output. Why: a parameter declared inside a construct
lands in the template of every consumer that uses it.

**Context only overrides production defaults.** The `serverlessinbox:*` keys (see
`packages/mailbox-cdk-shared/src/context/context-keys.ts`) change a default for development and
tests; absent context must give production behaviour, and a present but invalid value throws. Why:
customers configure the library through props, so a feature that only works with context is
unreachable for them.

## Common tasks

### Add a Lambda

1. Add a wrapper `packages/mailbox/src/resources/lambdas/<name>-lambda.ts` that extends `GoLambda` or
   `TypeScriptLambda`. Give it its `lambdaId`, `pipeline`, memory, timeout, the literal `environment`
   map and its grants. `support-api-lambda.ts` in that folder is a complete example.
2. Instantiate the wrapper in the section that owns it, under `core/<section>/` or
   `platform/<area>/`.
3. If only `platform/` uses the wrapper, add its name to `platformOnlyLambdaNames` in
   `packages/eslint-plugin-mailbox/src/zones/mailbox-zones.ts`.
4. Register the code in the artifact registry:
   - A Go Lambda is resolved from `lambdas/<lambdaId>.zip` of the `mailbox-go` artifact package,
     which is published outside this repository.
   - A TypeScript Lambda has its code in `packages/mailbox/src/runtime/<name>/` with an `index.ts`
     entry. Add a `bundle:<name>` task to `packages/mailbox/Taskfile.yml`, call it from the `bundle`
     task there, and add the zip to `packages/mailbox/artifact-registry.json`.

### Add a construct prop

1. Add the prop to the construct's props interface in the construct's own file. Use an enum or a
   literal union for a constrained value, never a bare `string`.
2. Thread the value down from where `Mailbox` is composed. A construct does not read context or
   resolve its own configuration.
3. Update every caller in the same change; the type check lists them.
4. If the prop is reachable from `packages/mailbox/src/index.ts`, it is public API: the jsii build
   must pass, and the pull request should say so.

### Add an addon

An Admin API addon adds routes to the Admin API.

1. Implement `IAdminApiAddon` and set `routeSpec` to an `AdminApiRouteSpec` with a `basePath`, the
   `methods` and the `handler` Lambda. The Admin API mounts `${basePath}/{proxy+}` behind its own
   authorizer. Two addons with the same `basePath` fail the synthesis.
2. Return the addon from an `IAdminApiAddonProvider.createAdminApiAddons(scope, ctx)`. Create every
   construct of the addon under `scope`. `ctx` carries the shared tables, the audit queue, the
   identity provisioner and the artifact resolver.
3. The consuming stack passes the provider in `MailboxProps.adminApiAddonProviders`.
4. Write the addon's Lambda with `@serverlessinbox/mailbox-addon-sdk`.

`platform/update/artifact-updater-addon.ts` and `packages/mailbox-cognito/src/cognito-idp-users-addon.ts`
are working examples.

## Running the checks

Run the root commands in the repository root and the package commands inside the package.

| Check | Command |
|-------|---------|
| Lint | `yarn lint` (runs `eslint packages scripts`) |
| Type check and tests of one package | `yarn workspace @serverlessinbox/mailbox test` (runs `tsc -p tsconfig.test.json && jest`) |
| Everything | `yarn test` |
| jsii build, in `packages/mailbox` or `packages/mailbox-cognito` | `yarn prepare-manifest build` |
| Published declarations name only declared packages, in the same package | `yarn check:declarations` |
| Addon SDK public API against its baseline | `yarn api-report diff` |

- Run the jsii build as `yarn prepare-manifest build`, never as a bare `yarn build`: the first
  translates the `workspace:*` dependencies to real versions before jsii runs, and a bare build
  fails on them.
- `yarn check:declarations` reads the built package, so run it after the build and
  `yarn bundle:jsii`; `prepack` runs them in that order.
- `yarn api-report diff` exits 1 when the SDK's public API differs from
  `packages/mailbox-addon-sdk/api-report.d.txt`. Run `yarn api-report capture` only when the public
  API change is intended, and commit the updated file with it.

## Pull requests and issues

Open issues and questions only in the
[ServerlessInbox repository](https://github.com/serverlessinbox/serverlessinbox). Issues are not
tracked in this repository. Send pull requests with a passing `yarn lint` and `yarn test`, which is
what the pull-request workflow runs.
