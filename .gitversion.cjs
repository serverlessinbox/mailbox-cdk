const { defineConfig } = require('@jwpkg/gitversion');

// S3 artifact uploads (edge template, regional zips, manifest.json) are
// handled by explicit workflow steps in .github/workflows/release.yml.
// This config only handles npm publish of CDK packages.
module.exports = defineConfig({
  // No plugins needed here — standard npm/yarn publish
});
