# Publishing tools

These tools publish mailbox artifacts into regional publication buckets without rewriting synthesized templates.

See the S3 naming scheme in packages/mailbox/docs/artifacts.md.

## Bucket naming

Bucket name is derived from base + region:

- `--bucketBase mailbox-artifacts`
- `--region eu-west-1`

Bucket: `mailbox-artifacts-eu-west-1`

## Release vs dev

- `--mode release --version 1.4.0` writes to `mailbox-cdk/v1.4.0/...` (treat as immutable)
- `--mode dev --version 1.4.0 --devTag joost` writes to `mailbox-cdk/dev/joost/...` (overwrite ok)

## Publish edge template (us-east-1)

Runs local CDK synth for the edge stack and uploads the template + a minimal manifest.

```sh
yarn workspace @sipkg/mailbox publish:edge-template \
  --bucketBase mailbox-artifacts \
  --region us-east-1 \
  --mode dev \
  --version 1.0.0 \
  --devTag joost \
  --domainName example.com \
  --prefix mailbox
```

## Publish a Node lambda zip

Bundles a TS/JS entrypoint with esbuild, zips it, and uploads to S3.

```sh
yarn workspace @sipkg/mailbox publish:node-lambda \
  --bucketBase mailbox-artifacts \
  --region eu-west-1 \
  --mode dev \
  --version 1.0.0 \
  --devTag joost \
  --entry src/edge/mailbox-edge-deployer.handler.ts \
  --key regional/lambdas/mailbox-edge-deployer.zip
```

Notes:
- Requires AWS CLI (`aws`) and `zip` on PATH.
- Uses AWS SDK v2 (`aws-sdk`) from the Lambda runtime (excluded from bundle).

## One-shot dev publish

Publishes:
- edge stack template (us-east-1)
- blob authorizer edge lambda zip (us-east-1)
- regional custom resource lambda zip (for each region listed)
- a `manifest.json` in each listed regional bucket

```sh
yarn workspace @sipkg/mailbox publish:dev \
  --bucketBase mailbox-artifacts \
  --mode dev \
  --version 1.0.0 \
  --devTag joost \
  --domainName example.com \
  --prefix mailbox \
  --regions eu-west-1,us-east-1
```
