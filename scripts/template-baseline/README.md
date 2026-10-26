# template-baseline

Captures the synthesized CloudFormation templates under fixed inputs, and later reports how a fresh synth
differs from the capture. Use it around a refactor: capture before, diff after.

It is a developer command; nothing calls it automatically.

## Usage

```
yarn template-baseline capture [--label <name>] [--baseline-root <folder>]
yarn template-baseline diff    [--label <name>] [--baseline-root <folder>]
```

| Option | Meaning |
|---|---|
| `--label` | Name of the baseline folder: letters, digits, dot, underscore and dash. Defaults to `default`. |
| `--baseline-root` | Folder that holds the label folders. Defaults to `.template-baseline` in the repository root. |

Each option is given once.

## Examples

```
yarn template-baseline capture --label before-resource-split
yarn template-baseline diff --label before-resource-split
```

## Output

`capture` writes `<baseline-root>/<label>/<stack>.template.json` for each stack and prints a
`Written: <path>` line for each file.

`diff` prints, per stack, `identical` or `DIFFERENT`, followed by the logical IDs added, removed and
changed, with the property paths that changed. Exit code: `0` when every template is identical, `1` when
any differs, `2` when the comparison itself fails, for example a missing baseline.
