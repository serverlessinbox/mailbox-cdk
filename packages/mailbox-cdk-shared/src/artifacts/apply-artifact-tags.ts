import { Tags }                   from 'aws-cdk-lib';
import type { IConstruct }        from 'constructs';

import { ServerlessInboxTagKeys } from '../runtime/handler-kit/tag-keys';

/** Auto-update type: how a lambda is kept current with new versions. */
export type AutoUpdateType = 'code' | 'ui' | 'edge' | 'none';

/**
 * Applies the artifact tracking tags to a construct and everything under it. The artifact version
 * is put on the Lambda functions only.
 *
 * @param scope The construct to tag
 * @param packageName The artifact package name
 * @param artifactName The lambda identifier / artifact name
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
  Tags.of(scope).add(ServerlessInboxTagKeys.artifactName, artifactName);
  Tags.of(scope).add(ServerlessInboxTagKeys.artifactPackage, packageName);
  Tags.of(scope).add(ServerlessInboxTagKeys.artifactVersion, version, { includeResourceTypes: ['AWS::Lambda::Function'] });
  Tags.of(scope).add(ServerlessInboxTagKeys.autoUpdateType, updateType);
}
