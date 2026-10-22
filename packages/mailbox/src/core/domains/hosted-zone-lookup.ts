import type { IArtifactResolver }                                                                               from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription, MailboxArtifactResolverFactory, StackHelpers, applyServerlessInboxComponentTag } from '@serverlessinbox/mailbox-cdk-shared';
import * as route53                                                                                             from 'aws-cdk-lib/aws-route53';
import { Construct }                                                                                            from 'constructs';

import { loadMailboxArtifactVersions }                                                                          from '../../mailbox-artifact-versions';
import { loadMailboxRegistryRecord }                                                                            from '../../mailbox-registry-record';

/**
 * Settings of a {@link HostedZoneLookup}.
 */
export interface HostedZoneLookupProps {
  /**
   * The ID of the Route53 hosted zone to look up, for example `Z0123456789ABCDEFGHIJ`. A
   * CloudFormation parameter value is fine: the zone is looked up at deploy time, not while the
   * template is synthesized.
   *
   * An empty value at deploy time means there is no zone: no Route53 call is made and the zone name
   * is empty.
   */
  readonly hostedZoneId: string;

  /**
   * Resolves the artifacts the lookup's Lambda is deployed from. Pass the same resolver you give to
   * your `Mailbox`, so both use one set of pinned artifact versions.
   *
   * @default - a resolver pinned to the versions this package was released with
   */
  readonly artifactResolver?: IArtifactResolver;
}

/**
 * Looks a Route53 hosted zone up once, at deploy time, and offers it as a `hostedZone` that every
 * construct of your app can share. Create one in your stack, and pass its `hostedZone` to the
 * `Mailbox` and to a `MailboxUserPool` that derives its domain from the zone, so the zone is
 * looked up once however many constructs need it.
 *
 * The lookup needs the Lambda of the shared stack helpers, which this construct adds to your stack
 * if it is not there yet. It creates no DNS records and takes no ownership of the zone.
 */
export class HostedZoneLookup extends Construct {
  /**
   * The hosted zone with the ID you gave. Its `zoneName` is the zone's name without the trailing
   * dot, a deploy-time value, so it cannot be used in a decision made while the template is
   * synthesized.
   */
  public readonly hostedZone: route53.IHostedZone;

  constructor(scope: Construct, id: string, props: HostedZoneLookupProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'edge');
    ComponentDescription.describe(this, 'Deploy-time lookup of the name of the hosted zone.');

    const artifactResolver = props.artifactResolver
      ?? MailboxArtifactResolverFactory.fromContext(this, loadMailboxRegistryRecord(), loadMailboxArtifactVersions());
    const zoneName         = StackHelpers.getOrCreate(this, artifactResolver)
      .resolveHostedZoneName(this, 'resource', props.hostedZoneId);

    this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName,
    });
  }
}
