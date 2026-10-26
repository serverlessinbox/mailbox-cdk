# build-stack

Synthesizes one standalone stack and writes its CloudFormation template as formatted JSON. The templates
are environment-agnostic.

It runs in the build tasks of `packages/mailbox` (edge and data) and `packages/mailbox-cognito`
(cognito-data).

## Usage

```
yarn build-stack <stack> --out-dir <folder>
```

| Stack | Template file written |
|---|---|
| `data` | `data-stack-template.json` |
| `edge` | `edge-stack-template.json` |
| `cognito-data` | `cognito-data-stack-template.json` |

| Option | Meaning |
|---|---|
| `--out-dir` | Folder the template is written into; created when missing. Pass an absolute path. Required, given once. |

## Example

```
yarn build-stack data --out-dir /abs/path/dist
```

## Output

The template file in the output folder. The command prints `Written: <path>`.
