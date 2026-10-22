import { Grant }            from 'aws-cdk-lib/aws-iam';
import type { IGrantable }  from 'aws-cdk-lib/aws-iam';
import type { IHostedZone } from 'aws-cdk-lib/aws-route53';

/** The hosted zone as its dependants see it: the zone's id, and the permission to manage its records. */
export interface IDnsZone {
  /** Id of the hosted zone. */
  readonly hostedZoneId: string;

  /** Allows the grantee to change and read the records of this zone. */
  grantRecordManagement(grantee: IGrantable): void;
}

/**
 * The Route 53 hosted zone a mailbox is served from, behind {@link IDnsZone}: the zone's id and its
 * record-management grant, without exposing the CDK hosted zone. Not responsible for looking the zone up.
 */
export class DnsZone implements IDnsZone {
  public readonly hostedZoneId: string;

  private readonly hostedZoneArn: string;

  constructor(hostedZone: IHostedZone) {
    this.hostedZoneId  = hostedZone.hostedZoneId;
    this.hostedZoneArn = hostedZone.hostedZoneArn;
  }

  public grantRecordManagement(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['route53:ChangeResourceRecordSets', 'route53:GetHostedZone'],
      resourceArns: [this.hostedZoneArn],
    });
  }
}
