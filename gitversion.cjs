const { defineConfig } = require('@jwpkg/gitversion');
const { S3ArtifactPlugin } = require('@serverlessinbox/artifact-tools');

// Per-workspace artifact configuration lives in each workspace's artifact-tools.cjs file.
// This root config registers the plugin once; the plugin discovers workspace configs automatically.
module.exports = defineConfig({
  plugins: [
    new S3ArtifactPlugin(),
  ],
});
