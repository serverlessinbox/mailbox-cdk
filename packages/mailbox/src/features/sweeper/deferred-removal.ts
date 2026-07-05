import * as cdk from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface DeferredRemovalProps {
  /** Optional ARN of the ACM certificate to defer removal for. */
  readonly certArn?: string;
  /** Optional ARN of the Lambda@Edge function to defer removal for. */
  readonly edgeFnArn?: string;
  /** The sweeper starter Lambda function to use as the custom resource service token. */
  readonly sweeperStarter: IFunction;
  /** Root stack name for ownership verification. */
  readonly rootStackName: string;
}

/**
 * DeferredRemoval wraps a CfnCustomResource that enqueues resource ARNs to the sweeper.
 *
 * On Delete or Update (with ARN change), the custom resource fires the sweeper starter Lambda,
 * which starts a single SFN execution to asynchronously delete both resources (if present).
 * Both targets are processed in parallel by the worker Lambda.
 *
 * The custom resource returns SUCCESS immediately; actual cleanup happens in the background.
 * Physical resource ID is stable, combining both ARNs if present.
 */
export class DeferredRemoval extends Construct {
  constructor(scope: Construct, id: string, props: DeferredRemovalProps) {
    super(scope, id);

    // At least one ARN must be provided
    if (!props.certArn && !props.edgeFnArn) {
      throw new Error('DeferredRemoval requires at least one of certArn or edgeFnArn');
    }

    const cr = new cdk.CfnCustomResource(this, 'resource', {
      serviceToken: props.sweeperStarter.functionArn,
      serviceTimeout: cdk.Duration.minutes(2).toSeconds(), // 2× Lambda timeout ceiling (60s); starter responds in ~1-2s via wrapHandler, so 120s fails fast without cutting off legitimate invocations
    });

    cr.addPropertyOverride('CertArn', props.certArn);
    cr.addPropertyOverride('EdgeFnArn', props.edgeFnArn);

    // Override logical ID to a single stable ID (not per-resource-kind anymore)
    cr.overrideLogicalId('MailboxDeferredRemoval');

    // Physical resource ID: stable identifier combining both ARNs if present
    // This ensures CFN issues an Update (not Delete+Create) when only metadata changes.
    const physicalResourceId = [props.certArn, props.edgeFnArn]
      .filter(Boolean)
      .join('|') || 'mailbox-deferred-removal';
    (cr as any).physicalResourceId = physicalResourceId;

    // Explicit dependency: ensure the custom resource is deleted BEFORE its provider Lambda.
    // Because the serviceToken is a plain string (formatArn, to avoid circular dependencies),
    // CDK cannot infer the CR→provider dependency automatically. Without this, CloudFormation
    // deletes them concurrently, causing the provider role to die first and the Delete to fail.
    cr.node.addDependency(props.sweeperStarter);
  }
}
