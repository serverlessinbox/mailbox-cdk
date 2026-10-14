/** The names of the environment variables the template sets on the artifact-updater Lambda. It imports nothing, so it loads without CDK. */

export const ArtifactUpdaterEnvNames = {
  artifactBucketBase: 'ARTIFACT_BUCKET_BASE',
  distTag: 'DIST_TAG',
  granularity: 'GRANULARITY',
  project: 'PROJECT',
  rootStackTagValue: 'ROOT_STACK_TAG_VALUE',
} as const;

export type ArtifactUpdaterEnvName = (typeof ArtifactUpdaterEnvNames)[keyof typeof ArtifactUpdaterEnvNames];
