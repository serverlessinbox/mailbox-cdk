# @serverlessinbox/mailbox-bundler

Internal build tool for the `mailbox-cdk` packages. It bundles the TypeScript Lambda handlers that
the CDK constructs deploy as zip files, and it bundles a jsii construct package into its `lib/`
folder. It runs as the `mailbox-bundler` command, which each package calls from its Taskfile or its
`bundle:jsii` script.

## Requirements

- esbuild, a peer dependency, installed alongside this package.
- `package` needs `yarn` on the PATH and a `tsconfig.build.json` in the package folder.

## Commands

### `lambda-zip`

Bundles one TypeScript or JavaScript Lambda entry file into a CommonJS `index.js`, and writes that
single file into a zip.

| Flag | Required | Default | Meaning |
|---|---|---|---|
| `--entry <file>` | yes | none | Lambda entry file, relative to the current directory or absolute. |
| `--out <zip>` | yes | none | Zip to write. Missing folders are created, and an existing zip is replaced. |
| `--target <target>` | no | `node24` | esbuild target the bundle is compiled for. |
| `--minify` / `--no-minify` | no | on | Minify the bundle. |
| `--external <patterns>` | no | `@aws-sdk/*` | Comma-separated package patterns left out of the bundle. |

Example:

```sh
mailbox-bundler lambda-zip --entry src/handler.ts --out dist/lambdas/handler.zip
```

### `package`

Bundles a jsii construct package: `src/**/*.ts` into `lib/`, with jsii packages and the package's
own relative imports left external. Then it emits the `.d.ts` files with `tsc --emitDeclarationOnly`;
a non-zero exit fails the build.
Paths listed in the package's jsii `excludeTypescript` are skipped, and so are test folders (`__tests__`).

| Argument | Meaning |
|---|---|
| `package-folder` | Folder of the jsii package, relative to the current directory or absolute. |

Example:

```sh
mailbox-bundler package .
```
