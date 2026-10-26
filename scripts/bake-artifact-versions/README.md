# bake-artifact-versions

Writes the `artifact-versions.json` of the `mailbox` and `mailbox-cognito` packages. Each file pins the
externally released packages, taken from a `resolve-artifacts` output, plus the packages this repository
releases itself at the version the version bump wrote into their `package.json`.

It runs in the release workflow, after the version bump and `yarn resolve-artifacts`, before the packages
are packed.

## Usage

```
yarn bake-artifact-versions --mailbox-pins <file> [--root <folder>]
```

| Option | Meaning |
|---|---|
| `--mailbox-pins` | Path to the `resolve-artifacts` output that holds the externally released packages the `mailbox` package needs. Relative to the current directory, or absolute. Required. |
| `--root` | Repository root that holds the `packages` folder. Defaults to the current directory. |

Each option is given once.

## Example

```
yarn resolve-artifacts --output /tmp/mailbox-external-pins.json && yarn bake-artifact-versions --mailbox-pins /tmp/mailbox-external-pins.json
```

## Output

One `artifact-versions.json` per package. The command prints a `Written: <path>` line for each file.
