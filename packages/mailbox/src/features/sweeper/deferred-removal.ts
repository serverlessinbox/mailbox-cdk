import * as cdk from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import type { RemovalId, RemovalTargets } from '../../ts-lambdas/resource-sweeper/removal';
import type { IResourceRemoval } from './removal';

/** The custom resource's `ResourceProperties`: the entry of each registered removal, by removal id. */
type RemovalProperties = { -readonly [TId in RemovalId]?: RemovalTargets[TId] };

export interface DeferredRemovalProps {
  /** The sweeper starter Lambda function to use as the custom resource service token. */
  readonly sweeperStarter: IFunction;
  /**
   * Removals to register on the custom resource. Each contributes its own `ResourceProperties` entry
   * (via `crProperties()`), placed under its own `id` key — this construct never looks inside any
   * removal's entry, it only assembles the map.
   */
  readonly removals: IResourceRemoval[];
}

/**
 * DeferredRemoval wraps a `Custom::DeferredRemoval` custom resource that triggers the sweeper on stack Delete or Update.
 *
 * `ResourceProperties` is a per-removal-type keyed map (`{ [removal.id]: removal.crProperties() }`) —
 * one opaque entry per registered removal. On Update, CloudFormation also sends the previous map as
 * `OldResourceProperties`.
 */
export class DeferredRemoval extends Construct {
  /** Bounds how long CloudFormation waits for the starter's answer, instead of the one-hour default. */
  private static readonly serviceTimeout = cdk.Duration.minutes(2);

  constructor(scope: Construct, id: string, props: DeferredRemovalProps) {
    super(scope, id);

    const properties: RemovalProperties = {};
    for (const removal of props.removals) {
      this.addEntry(properties, removal);
    }

    const cr = new cdk.CustomResource(this, 'resource', {
      serviceToken: props.sweeperStarter.functionArn,
      serviceTimeout: DeferredRemoval.serviceTimeout,
      resourceType: 'Custom::DeferredRemoval',
      properties: { ...properties },
    });

    // Depends on everything in the starter's construct, not only the function the service token resolves to,
    // so CloudFormation deletes this resource before the starter's role and policy.
    cr.node.addDependency(props.sweeperStarter);
  }

  private addEntry<TId extends RemovalId>(properties: RemovalProperties, removal: IResourceRemoval<TId>): void {
    properties[removal.id] = removal.crProperties();
  }
}
