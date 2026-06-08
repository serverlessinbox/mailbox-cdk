# S3 artifact naming structure

This project publishes deployable assets into **regional publication buckets**.

Goals:
- No rewriting of synthesized CloudFormation templates.
- Immutable releases addressed by SemVer.
- A low-storage channel workflow that still works well with `cdk watch`.

## Buckets

Bucket name is derived from a base name + AWS region:

- Bucket base: `mailbox-artifacts`
- Region: `eu-west-1`

Bucket:

- `mailbox-artifacts-eu-west-1`

You will have one bucket per region you deploy into (including `us-east-1` for edge resources).

## Top-level prefix: packages

All published artifacts live under a single root:

- `packages/<packageName>/...`

Where `<packageName>` is a releaseable unit (often mapping to a repo/component), for example:

- `mailbox-cdk` (this repo)
- `mailbox-go` (precompiled Go lambdas)
- `mailbox-admin-ui` (single zipped admin UI)
- `mailbox-webmail-ui` (single zipped webmail UI)

This keeps the layout consistent.

## Versions and channels

### Immutable releases (SemVer)

All immutable builds (including prereleases) are stored under:

- `packages/<packageName>/vX.Y.Z/...`
- `packages/<packageName>/vX.Y.Z-<pre>/...` (e.g. `v1.4.0-alpha.2`, `v1.4.0-beta.1`)

These keys should never be overwritten.

### Mutable channels (overwrite-friendly)

For fast iteration (low storage), publish to a channel path that is expected to be overwritten:
For fast iteration (low storage), publish to a channel path that is expected to be overwritten:

- `packages/<packageName>/channels/<channel>/...`

Example:

- `packages/mailbox-cdk/channels/main/...`

This is useful when you want “save → build → publish → `cdk watch` redeploy” without leaving many old objects around.

## Package-specific layouts

### `mailbox-cdk` (this repo)

Within a `mailbox-cdk` version or channel prefix we keep the following structure:

- `manifest.json`
- `edge/edge-stack-template.json` (us-east-1 only)
- `edge/lambdas/<name>.zip` (us-east-1 only)
- `regional/lambdas/<name>.zip` (per deploy region)

The `manifest.json` is the release entrypoint. It pins other package versions (e.g. `mailbox-go`) and lists the S3 locations of published artifacts.

### `mailbox-go` (Go lambdas)

If Go lambdas are released as a group (one version for all), publish them under one package version:

- `packages/mailbox-go/vA.B.C/lambdas/<name>.zip`

### UI packages

UI bundles are single zips per UI package:

- `packages/mailbox-admin-ui/vM.N.P/admin-ui.zip`
- `packages/mailbox-webmail-ui/vQ.R.S/webmail-ui.zip`

## Examples

### Edge template URL (CloudFormation TemplateURL)

Release `mailbox-cdk v1.4.0` (in bucket `mailbox-artifacts-us-east-1`):

- Key: `packages/mailbox-cdk/v1.4.0/edge/edge-stack-template.json`

HTTPS URL form:

- `https://mailbox-artifacts-us-east-1.s3.us-east-1.amazonaws.com/packages/mailbox-cdk/v1.4.0/edge/edge-stack-template.json`

### Channel publish location

Channel `main`:

- `packages/mailbox-cdk/channels/main/edge/edge-stack-template.json`
- `packages/mailbox-cdk/channels/main/edge/lambdas/blob-authorizer.zip`
- `packages/mailbox-cdk/channels/main/regional/lambdas/mailbox-edge-deployer.zip`

## Notes on CloudFormation/Lambda constraints

- Lambda code must be in an S3 bucket in the same region as the Lambda.
- Edge artifacts always live in the `us-east-1` publication bucket.
- Regional artifacts live in the publication bucket for the region being deployed.
