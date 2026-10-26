# Scripts

Command-line tools of this repository. Run each one from the repository root with `yarn <script>`; for
example `yarn build-stack data --out-dir /abs/path/dist`. Every command folder has a README with its
arguments.

| Folder | What it is | When it runs | Called by |
|---|---|---|---|
| [`bake-artifact-versions`](bake-artifact-versions/) | Writes the `artifact-versions.json` that the `mailbox` and `mailbox-cognito` packages ship | Release | The release workflow |
| [`build-stack`](build-stack/) | Writes the standalone CloudFormation templates of the data, edge and cognito-data stacks | Build | The Taskfiles of `packages/mailbox` and `packages/mailbox-cognito` |
| [`template-baseline`](template-baseline/) | Captures the synthesized templates and reports how a later synth differs | Developer | Developers |
| [`api-report`](api-report/) | Captures the public API of a package and reports when it differs | Developer | Developers |
| `stacks` | Helper: creates the standalone stacks that `build-stack` synthesizes | n/a | The commands above |
| `utils` | Helper: small shared functions for the commands | n/a | The commands above |
