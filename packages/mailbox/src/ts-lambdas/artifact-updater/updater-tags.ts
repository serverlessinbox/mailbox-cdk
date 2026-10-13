/** The tag keys the updater filters on, reads from and writes to the resources it manages. */
export const UpdaterTagKeys = {
  rootStack: 'serverless-inbox:root-stack',
  autoUpdateType: 'serverless-inbox:auto-update-type',
  artifactPackage: 'serverless-inbox:artifact-package',
  artifactName: 'serverless-inbox:artifact-name',
  artifactVersion: 'serverless-inbox:artifact-version',
  bucketName: 'serverless-inbox:bucket-name',
} as const;
