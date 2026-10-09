const { defineConfig } = require('@jwpkg/gitversion');
const { S3ArtifactPlugin } = require('@serverlessinbox/artifact-registry-gitversion');

module.exports = defineConfig({
  plugins: [
    new S3ArtifactPlugin(),
  ],
});
