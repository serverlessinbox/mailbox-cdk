const { defineConfig } = require('@jwpkg/gitversion');
const { S3ArtifactPlugin } = require('@serverlessinbox/artifact-tools');

// S3 artifact uploads (edge template, regional zips, manifest.json) are
// handled by explicit workflow steps in .github/workflows/release.yml.
// This config only handles npm publish of CDK packages.
module.exports = defineConfig({
  plugins: [
    new S3ArtifactPlugin(),
  ],
});
