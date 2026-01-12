export const publishConfig = {
  // Artifact bucket base name; final bucket is `${bucketBase}-${region}`.
  // Keep this centralized here (not passed via CLI) so publish commands stay simple.
  bucketBase: 'mailbox-artifacts',

  // Dev publishing: intentionally overwrite-friendly and single-region.
  dev: {
    region: 'eu-west-1',
  },

  // Release publishing: publish to all deploy regions.
  // (Edge resources use us-east-1, but Go lambdas are regional.)
  release: {
    regions: ['eu-west-1'],
  },
} as const;
