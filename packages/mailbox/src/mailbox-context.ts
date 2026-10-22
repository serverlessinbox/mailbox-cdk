import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import {
  MailboxArtifactResolverFactory,
  ServerlessInboxTagKeys,
  applyServerlessInboxBaseTags,
  resolveDeployerType,
  resolveVendorAccountIds,
} from '@serverlessinbox/mailbox-cdk-shared';
import type { ServerlessInboxDeployerType, VendorLink } from '@serverlessinbox/mailbox-cdk-shared';
import { Aws }                                          from 'aws-cdk-lib';
import type { Construct }                               from 'constructs';

import { MailboxEncryption }                            from './core/mailbox-encryption';
import type { MailboxEncryptionPlan }                   from './core/mailbox-encryption';
import { loadMailboxArtifactVersions }                  from './mailbox-artifact-versions';
import type { MailboxProps }                            from './mailbox-props';
import { loadMailboxRegistryRecord }                    from './mailbox-registry-record';

/** The `MailboxProps` fields the foundation is resolved from. */
type MailboxContextProps = Pick<MailboxProps, 'artifactResolver' | 'kms'>;

/**
 * The foundation values a `Mailbox` resolves once, before any section is built, and threads down
 * as props: the artifact resolver and its version, the deployer type, the vendor values and the
 * encryption plan. Resolving also tags everything under the `Mailbox` with the base tags.
 */
export class MailboxContext {
  private constructor(
    public readonly artifactResolver: IArtifactResolver,
    public readonly stackVersion: string,
    public readonly deployerType: ServerlessInboxDeployerType,
    public readonly vendorLink: VendorLink,
    public readonly encryptionPlan: MailboxEncryptionPlan,
  ) {}

  /** Resolves the foundation under `scope` and applies the base tags to it. */
  public static resolve(scope: Construct, props: MailboxContextProps): MailboxContext {
    const deployerType           = resolveDeployerType(scope);
    const vendorLink: VendorLink = {
      vendorAccountIds:    resolveVendorAccountIds(scope),
      stackIdentityTagKey: ServerlessInboxTagKeys.rootStack,
    };

    // The supplied resolver wins; otherwise one is pinned from the package's baked versions,
    // overridden by CDK context.
    const artifactResolver: IArtifactResolver = props.artifactResolver
      ?? MailboxArtifactResolverFactory.fromContext(scope, loadMailboxRegistryRecord(), loadMailboxArtifactVersions());
    const stackVersion                        = artifactResolver.getVersion('mailbox-cdk');

    // The Mailbox is the root stack of its own deployment.
    applyServerlessInboxBaseTags(scope, { rootStack: Aws.STACK_NAME });

    return new MailboxContext(
      artifactResolver,
      stackVersion,
      deployerType,
      vendorLink,
      MailboxEncryption.plan(props.kms),
    );
  }
}
