import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import {
  MailboxArtifactResolverFactory,
  ServerlessInboxTagKeys,
  applyServerlessInboxBaseTags,
  resolveDeployerType,
  resolveVendorAccountIds,
} from '@serverlessinbox/mailbox-cdk-shared';
import type { ServerlessInboxDeployerType } from '@serverlessinbox/mailbox-cdk-shared';
import { Aws }                              from 'aws-cdk-lib';
import type { Construct }                   from 'constructs';

import { loadMailboxArtifactVersions }      from './mailbox-artifact-versions';
import type { MailboxProps }                from './mailbox-props';
import { loadMailboxRegistryRecord }        from './mailbox-registry-record';
import { resolveMailboxEncryptionPlan }     from './core/mailbox-encryption';
import type { MailboxEncryptionPlan }       from './core/mailbox-encryption';

/** The `MailboxProps` fields the foundation is resolved from. */
type MailboxContextProps = Pick<MailboxProps, 'artifactResolver' | 'kms'>;

/**
 * The foundation values a `Mailbox` resolves once, before any section is built, and threads down
 * as props: the artifact resolver and its version, the deployer type, the vendor values and the
 * encryption plan. Resolving also tags everything under the `Mailbox` with the base tags.
 *
 * Creates constructs (KMS alias imports) directly under the scope it receives, so their ids and
 * paths are those of the `Mailbox` itself.
 */
export class MailboxContext {
  private constructor(
    public readonly artifactResolver: IArtifactResolver,
    public readonly stackVersion: string,
    public readonly deployerType: ServerlessInboxDeployerType,
    public readonly vendorAccountIds: string[],
    public readonly stackIdentityTagKey: string,
    public readonly encryptionPlan: MailboxEncryptionPlan,
  ) {}

  /** Resolves the foundation under `scope` and applies the base tags to it. */
  public static resolve(scope: Construct, props: MailboxContextProps): MailboxContext {
    const deployerType     = resolveDeployerType(scope);
    const vendorAccountIds = resolveVendorAccountIds(scope);

    // The supplied resolver wins; otherwise one is pinned from the package's baked versions,
    // overridden by CDK context.
    const artifactResolver: IArtifactResolver = props.artifactResolver
      ?? MailboxArtifactResolverFactory.fromContext(scope, loadMailboxRegistryRecord(), loadMailboxArtifactVersions());
    const stackVersion                        = artifactResolver.getVersion('mailbox-cdk');

    // Uses AWS::StackName so this also works when deployed via pure CloudFormation. The Mailbox
    // is the main stack, so it is its own root-stack (the base helper also tags `stack`).
    applyServerlessInboxBaseTags(scope, {
      rootStack: Aws.STACK_NAME,
      version: stackVersion,
      product: 'mailbox',
    });

    const encryptionPlan = resolveMailboxEncryptionPlan(scope, props.kms);

    return new MailboxContext(
      artifactResolver,
      stackVersion,
      deployerType,
      vendorAccountIds,
      ServerlessInboxTagKeys.rootStack,
      encryptionPlan,
    );
  }
}
