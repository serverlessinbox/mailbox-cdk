import { PinnedArtifactResolver }                               from '@serverlessinbox/artifact-registry-cdk';
import type { RegistryLocation }                                from '@serverlessinbox/artifact-registry-cdk';
import { Stack }                                                from 'aws-cdk-lib';
import type { Construct }                                       from 'constructs';

import { ARTIFACTS_CONTEXT_KEY, ARTIFACT_VERSIONS_CONTEXT_KEY } from '../context/context-keys';

import type { EmbeddedArtifactVersions }                        from './embedded-artifact-versions';
import type { RegistryRecord }                                  from './registry-record-contract';

/**
 * Builds the artifact resolver of a mailbox package from what the package ships (its registry
 * record and baked artifact versions), overridden by the `serverlessinbox:` CDK context keys.
 * It owns the product's context keys and the deployment region; the resolution itself is
 * `PinnedArtifactResolver`'s.
 */
export class MailboxArtifactResolverFactory {
  /**
   * @param scope the construct whose stack region and CDK context are read
   * @param registryRecord the registry record of the package the calling construct ships in
   * @param defaultPins the baked artifact versions of that package
   * @throws an error naming the context key and value when a context value is present but invalid
   */
  static fromContext(
    scope: Construct,
    registryRecord: RegistryRecord,
    defaultPins: EmbeddedArtifactVersions,
  ): PinnedArtifactResolver {
    const defaultLocation: RegistryLocation = {
      bucketBase: registryRecord.bucketBase,
      project:    registryRecord.project,
      ...(registryRecord.bucketOverrides !== undefined ? { bucketOverrides: registryRecord.bucketOverrides } : {}),
    };
    return PinnedArtifactResolver.fromContext(scope, {
      defaultPins,
      defaultLocation,
      artifactsContextKey:      ARTIFACTS_CONTEXT_KEY,
      objectVersionsContextKey: ARTIFACT_VERSIONS_CONTEXT_KEY,
      deploymentRegion:         Stack.of(scope).region,
    });
  }
}
