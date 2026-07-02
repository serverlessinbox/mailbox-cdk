import * as cdk from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface DeferredRemovalProps {
  /** The ARN of the resource to defer removal for. */
  readonly resourceArn: string;
  /** The kind of resource: 'core-acm-cert' or 'edge-lambda-fn'. */
  readonly resourceKind: 'core-acm-cert' | 'edge-lambda-fn';
  /** The sweeper starter Lambda function to use as the custom resource service token. */
  readonly sweeperStarter: IFunction;
  /** Optional label for the resource (used in logical IDs and descriptions). */
  readonly label?: string;
}

/**
 * DeferredRemoval wraps a CfnCustomResource that enqueues resource ARNs to the sweeper.
 *
 * On Delete or Update (with ARN change), the custom resource fires the sweeper starter Lambda,
 * which starts a SFN execution to asynchronously delete the resource after it drains (e.g., CloudFront
 * replica propagation for Lambda@Edge, or API Gateway custom domain detachment for ACM certs).
 *
 * The custom resource returns SUCCESS immediately; actual cleanup happens in the background.
 * Physical resource ID is set to the resource ARN for stable tracking.
 */
export class DeferredRemoval extends Construct {
  constructor(scope: Construct, id: string, props: DeferredRemovalProps) {
    super(scope, id);

    const cr = new cdk.CfnCustomResource(this, 'resource', {
      serviceToken: props.sweeperStarter.functionArn,
      serviceTimeout: cdk.Duration.minutes(2).toSeconds(), // 2× Lambda timeout ceiling (60s); starter responds in ~1-2s via wrapHandler, so 120s fails fast without cutting off legitimate invocations
    });

    cr.addPropertyOverride('ResourceArn', props.resourceArn);
    cr.addPropertyOverride('ResourceKind', props.resourceKind);
    cr.addPropertyOverride('Label', props.label ?? props.resourceKind);

    // Override logical ID to avoid collisions when multiple DeferredRemoval instances exist
    // (one per resource kind). The suffix ensures unique IDs across instances.
    cr.overrideLogicalId(`MailboxDeferredRemoval${props.resourceKind.replace(/-/g, '')}`);

    // Physical resource ID: stable identifier (the resource ARN)
    // This ensures CFN issues an Update (not Delete+Create) when only metadata changes.
    (cr as any).physicalResourceId = props.resourceArn;
  }
}
