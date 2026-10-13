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
 * DeferredRemoval wraps a CfnCustomResource that triggers the sweeper on stack Delete or Update.
 *
 * `ResourceProperties` is a per-removal-type keyed map (`{ [removal.id]: removal.crProperties() }`) —
 * one opaque entry per registered removal. On Update, CloudFormation also sends the previous map as
 * `OldResourceProperties`.
 */
export class DeferredRemoval extends Construct {
  constructor(scope: Construct, id: string, props: DeferredRemovalProps) {
    super(scope, id);

    const properties: RemovalProperties = {};
    for (const removal of props.removals) {
      this.addEntry(properties, removal);
    }

    const cr = new cdk.CustomResource(this, 'resource', {
      serviceToken: props.sweeperStarter.functionArn,
      serviceTimeout: cdk.Duration.minutes(2), // 2× Lambda timeout ceiling (60s); starter responds in ~1-2s via wrapHandler, so 120s fails fast without cutting off legitimate invocations
      resourceType: 'Custom::DeferredRemoval',
      properties: { ...properties },
    });

    // Explicit dependency: ensure the custom resource is deleted BEFORE its provider Lambda.
    // Because the serviceToken is a plain string (formatArn, to avoid circular dependencies),
    // CDK cannot infer the CR→provider dependency automatically. Without this, CloudFormation
    // deletes them concurrently, causing the provider role to die first and the Delete to fail.
    cr.node.addDependency(props.sweeperStarter);
  }

  private addEntry<TId extends RemovalId>(properties: RemovalProperties, removal: IResourceRemoval<TId>): void {
    properties[removal.id] = removal.crProperties();
  }
}
