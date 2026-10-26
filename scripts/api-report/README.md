# api-report

Records the public API of a package and reports when it changes. The report is the set of declarations the
package build emits for its entry point and every file the entry point reaches, without comments.

It is a developer command; nothing calls it automatically.

## Usage

```
yarn api-report capture [--package <folder>]
yarn api-report diff    [--package <folder>]
```

| Option | Meaning |
|---|---|
| `--package` | Folder of the package to report on. Defaults to `packages/mailbox-addon-sdk`. Given once. |

## Examples

```
yarn api-report capture
yarn api-report diff --package packages/some-package
```

## Output

`capture` writes `api-report.d.txt` in the package and prints `Written: <path>`. Run it when a public API
change is approved, and commit the file with the change.

`diff` compares the current declarations with `api-report.d.txt`. Exit code: `0` when they match, `1` when
the public API differs.
