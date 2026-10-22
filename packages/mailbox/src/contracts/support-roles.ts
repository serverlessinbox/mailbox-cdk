import type { IGrantable } from 'aws-cdk-lib/aws-iam';

/**
 * What a Lambda that works with the support roles needs from them: the role ARNs and tag keys to
 * run with, and the grants to hold. A Lambda grants itself through these methods.
 */
export interface ISupportRoles {
  /** ARN of the hop role, which the case API tags to open and close access to the tier roles. */
  readonly hopRoleArn:        string;
  /** ARN of the support-diag tier role. */
  readonly diagRoleArn:       string;
  /** ARN of the support-config-read tier role. */
  readonly configReadRoleArn: string;
  /** Tag key on the hop role that opens access to the support-diag tier role. */
  readonly diagTagKey:        string;
  /** Tag key on the hop role that opens access to the support-config-read tier role. */
  readonly configReadTagKey:  string;

  /** Lets the grantee tag and untag the hop role, restricted to the tier tag keys. */
  grantTagWrites(grantee: IGrantable): void;

  /** Lets the grantee list the tags on the hop role. */
  grantTagRead(grantee: IGrantable): void;

  /** Lets the grantee look up the CloudTrail events of the support roles being assumed. */
  grantAssumptionLookup(grantee: IGrantable): void;
}
