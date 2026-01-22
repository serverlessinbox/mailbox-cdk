# Copilot instructions (repo-local)

## Package manager
- Use **Yarn** only for this repository.
- Do **not** suggest or run `npm install`, `npm test`, or other npm-based workflows.

## Build / typecheck commands
- Preferred build command:
  - `yarn --cwd /Users/joost/Development/serverlessinbox/mailbox-cdk workspace @sipkg/mailbox build`

## Workspace structure notes
- This is a Yarn workspaces monorepo; prefer `yarn workspace ...` style commands when working on a specific package.

## Architecture / intent (important)
- `@sipkg/mailbox` is the **core**: it defines stable interfaces/types (e.g. `AuthConfig`) and higher-level constructs.
- Provider implementations belong in **plugin packages** (e.g. `@sipkg/mailbox-cognito`). Prefer adding new auth providers as separate packages (e.g. `@sipkg/mailbox-auth0`).
- Provider-specific integrations that *attach to* a provider (e.g. IAM Identity Center federating into Cognito) should be **addon packages** (e.g. `@sipkg/mailbox-cognito-identity-center`) rather than bloating the core plugin.

## AWS operational constraints
- Assume deployments must work in constrained accounts (e.g. SES sandbox, minimal pre-verified identities/recipients). Avoid designs that require SES verification to function unless explicitly gated/optional.
- Prefer CloudFormation-compatible behavior (some constructs/lambdas are designed to be deployable via pure CloudFormation).
- When fixing deployment failures, prefer least-privilege changes but be aware of AWS quirks where IAM/tagging permissions are evaluated against `Resource: "*"`.
