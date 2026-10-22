import type { IArtifactResolver }         from '@serverlessinbox/artifact-registry-cdk';
import { MailboxArtifactResolverFactory } from '@serverlessinbox/mailbox-cdk-shared';
import type { Construct }                 from 'constructs';

import { loadMailboxArtifactVersions }    from './mailbox-artifact-versions';
import { loadMailboxRegistryRecord }      from './mailbox-registry-record';

/**
 * Pins an artifact resolver from the registry record and artifact versions shipped with this
 * package, overridden by the CDK context of `scope`.
 */
export function createMailboxPinnedResolver(scope: Construct): IArtifactResolver {
  return MailboxArtifactResolverFactory.fromContext(scope, loadMailboxRegistryRecord(), loadMailboxArtifactVersions());
}
