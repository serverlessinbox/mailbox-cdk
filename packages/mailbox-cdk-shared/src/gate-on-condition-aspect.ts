import * as cdk       from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

/**
 * Aspect that gates all CfnResource children of a construct onto a condition,
 * so the whole subtree produces zero resources when the condition is false.
 *
 * Synth-time opt-in is literal (fully disabled, no resources); deploy-time opt-in is a
 * CFN-parameter token (the condition gates the resources until the token resolves).
 *
 * @example
 * ```ts
 * const condition = new cdk.CfnCondition(this, 'IsFeatureEnabled', {
 *   expression: Fn.conditionEquals(feature, 'enabled'),
 * });
 * const featureSubtree = new FeatureConstruct(this, 'feature', {...});
 * cdk.Aspects.of(featureSubtree).add(new GateOnConditionAspect(condition));
 * ```
 */
export class GateOnConditionAspect implements cdk.IAspect {
  constructor(private readonly condition: cdk.CfnCondition) {}

  visit(node: IConstruct): void {
    if (cdk.CfnResource.isCfnResource(node)) {
      node.cfnOptions.condition = this.condition;
    }
  }
}
