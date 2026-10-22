import { Tags }            from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';

/**
 * Auto-update type: how a lambda is kept current with new versions.
 * Defined locally (shared-inlined, never imported from mailbox) to avoid circular dependencies.
 */
export type AutoUpdateType = 'code' | 'ui' | 'edge' | 'none';

/**
 * Tag keys for serverless-inbox artifact tracking.
 * Defined as literal strings to avoid importing from mailbox (circular dependency prevention).
 */
const TAG_PREFIX    = 'serverless-inbox:' as const;
const ARTIFACT_TAGS = {
  artifactName: `${TAG_PREFIX}artifact-name`,
  artifactPackage: `${TAG_PREFIX}artifact-package`,
  artifactVersion: `${TAG_PREFIX}artifact-version`,
  autoUpdateType: `${TAG_PREFIX}auto-update-type`,
} as const;

/**
 * Apply artifact tags to a Lambda function or other construct for auto-update tracking.
 *
 * This is the single source of truth for artifact tagging across TypeScriptLambda,
 * GoLambda, and other lambda constructs that don't use the wrappers.
 *
 * @param scope The construct to tag
 * @param packageName The artifact package name (e.g., 'mailbox-cdk', 'mailbox-cdk-edge')
 * @param artifactName The lambda identifier / artifact name (e.g., 'stack-deployer', 'jmap-blob-download')
 * @param version The artifact version string
 * @param updateType The auto-update mechanism type (default: 'code' for direct UpdateFunctionCode)
 */
export function applyArtifactTags(
  scope: IConstruct,
  packageName: string,
  artifactName: string,
  version: string,
  updateType: AutoUpdateType = 'code',
): void {
  Tags.of(scope).add(ARTIFACT_TAGS.artifactName, artifactName);
  Tags.of(scope).add(ARTIFACT_TAGS.artifactPackage, packageName);
  Tags.of(scope).add(ARTIFACT_TAGS.artifactVersion, version, { includeResourceTypes: ['AWS::Lambda::Function'] });
  Tags.of(scope).add(ARTIFACT_TAGS.autoUpdateType, updateType);
}
