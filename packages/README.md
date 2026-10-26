# Packages

The packages of this repository. Each has its own README.

| Package | What it is | Published | README |
|---|---|---|---|
| `@serverlessinbox/mailbox` | CDK construct library that deploys a complete serverless JMAP email server | Yes | [mailbox](mailbox/README.md) |
| `@serverlessinbox/mailbox-cognito` | Amazon Cognito as the authentication provider of a `mailbox` email server | Yes | [mailbox-cognito](mailbox-cognito/README.md) |
| `@serverlessinbox/mailbox-cdk-shared` | Building blocks shared by `mailbox` and `mailbox-cognito`; makes no compatibility promise | Yes | [mailbox-cdk-shared](mailbox-cdk-shared/README.md) |
| `@serverlessinbox/mailbox-addon-sdk` | Handler SDK for the Lambdas that serve the Admin API services of addons | No | [mailbox-addon-sdk](mailbox-addon-sdk/README.md) |
| `@serverlessinbox/mailbox-bundler` | Build tool that bundles Lambda handlers and jsii construct packages | No | [mailbox-bundler](mailbox-bundler/README.md) |
| `@serverlessinbox/eslint-plugin-mailbox` | ESLint plugin that enforces the structure of this repository | No | [eslint-plugin-mailbox](eslint-plugin-mailbox/README.md) |
