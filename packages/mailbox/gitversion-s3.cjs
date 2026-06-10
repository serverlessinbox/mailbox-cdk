/** @type {import('@serverlessinbox/artifact-tools').S3WorkspaceConfig} */
module.exports = {
  bucketName: 'mailbox-artifacts-eu-west-1',
  basePath: 'packages/mailbox-cdk',
  artifacts: [
    {
      source: 'src/ts-lambdas/stack-deployer/index.ts',
      bundleType: 'js-zip',
      objectName: 'lambdas/stack-deployer.zip',
    },
    {
      source: 'src/ts-lambdas/ui-deployer/index.ts',
      bundleType: 'js-zip',
      objectName: 'lambdas/ui-deployer.zip',
    },
    {
      source: 'dist/data-stack-template.json',
      objectName: 'data-stack-template.json',
    },
    {
      source: 'src/ts-lambdas/blob-authorizer/index.ts',
      bundleType: 'js-zip',
      objectName: 'lambdas/blob-authorizer.zip',
      bucketName: 'mailbox-artifacts-us-east-1',
      basePath: 'packages/mailbox-cdk-edge',
      region: 'us-east-1',
    },
    {
      source: 'dist/edge-stack-template.json',
      objectName: 'edge-stack-template.json',
      bucketName: 'mailbox-artifacts-us-east-1',
      basePath: 'packages/mailbox-cdk-edge',
      region: 'us-east-1',
    },
  ],
};
