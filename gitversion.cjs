const { defineConfig } = require('@jwpkg/gitversion');
const { S3ArtifactPlugin } = require('@serverlessinbox/artifact-registry');

// Per-workspace artifact configuration lives in each workspace's artifact-registry.cjs file.
// This root config registers the plugin once; the plugin discovers workspace configs automatically.
module.exports = defineConfig({
  plugins: [
    new S3ArtifactPlugin(),
  ],
});
