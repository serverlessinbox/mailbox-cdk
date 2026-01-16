# Copilot instructions (repo-local)

## Package manager
- Use **Yarn** only for this repository.
- Do **not** suggest or run `npm install`, `npm test`, or other npm-based workflows.

## Build / typecheck commands
- Preferred build command:
  - `yarn --cwd /Users/joost/Development/serverlessinbox/mailbox-cdk workspace @sipkg/mailbox build`

## Workspace structure notes
- This is a Yarn workspaces monorepo; prefer `yarn workspace ...` style commands when working on a specific package.
