# S3 artifact naming structure

The Lambda zips, frontend bundles and CloudFormation templates that the constructs deploy are
published ahead of time into **regional registry buckets**, so a synthesized template references them
directly and needs no `cdk bootstrap`.

Goals:
- No rewriting of synthesized CloudFormation templates.
- Immutable releases addressed by SemVer.
- A low-storage channel workflow that still works well with `cdk watch`.

## Buckets and project prefix

A registry is described by its record (`registry-record.json` in a package): a `bucketBase`, a
`project` and the `regions` it is published to.

- The bucket of a region is `<bucketBase>-<region>`, unless the record overrides the bucket name of
  that region.
- Every object key starts with `<project>/`.

You have one bucket per region you deploy into. Edge artifacts (CloudFront and Lambda@Edge resources)
always live in the `us-east-1` bucket.

## Keys

An artifact key is:

- `<project>/packages/<packageName>/<scope>/<objectName>`

`<packageName>` is a releasable unit, for example:

- `mailbox-cdk` (this repo)
- `mailbox-cdk-edge` (this repo, the edge resources)
- `mailbox-go` (precompiled Go Lambdas)
- `mailbox-admin-ui` (the zipped admin UI)
- `mailbox-webmail-ui` (the zipped webmail UI)

`<scope>` is one of the three forms below.

### Immutable releases (SemVer)

- `<project>/packages/<packageName>/releases/vX.Y.Z/<objectName>`
- `<project>/packages/<packageName>/releases/vX.Y.Z-<pre>/<objectName>` (e.g. `v1.4.0-beta.1`)

These keys are never overwritten.

### Release pointers

A pointer names the version a consumer follows. It is scoped by the version line a consumer pins to
(a track, `vMAJOR` or `vMAJOR.MINOR`) and by a release line (`stable` unless a prerelease label such
as `beta` is used):

- `<project>/packages/<packageName>/releases/<track>/<releaseLine>.json`
- `<project>/packages/<packageName>/releases/<releaseLine>.json` (without a track)

### Mutable channels (overwrite-friendly)

For fast iteration (low storage), publish to a channel path that is expected to be overwritten:

- `<project>/packages/<packageName>/channels/<channel>/<objectName>`

This is useful for a "save, build, publish, `cdk watch` redeploy" loop that leaves no trail of old
objects.

## Package-specific layouts

### `mailbox-cdk` (this repo)

Object names within a `mailbox-cdk` release or channel:

- `data-stack-template.json`
- `lambdas/<name>.zip`

### `mailbox-cdk-edge` (this repo, `us-east-1` only)

- `edge-stack-template.json`
- `lambdas/<name>.zip`

### `mailbox-go` (Go Lambdas)

The Go Lambdas are released as a group under one package version:

- `lambdas/<name>.zip`

### UI packages

Each UI bundle is a single zip:

- `mailbox-admin-ui`: `admin-ui.zip`

## Constraints

- Lambda code must be in an S3 bucket in the same region as the Lambda.
- Edge artifacts always live in the `us-east-1` bucket.
- Regional artifacts live in the bucket of the region being deployed.
