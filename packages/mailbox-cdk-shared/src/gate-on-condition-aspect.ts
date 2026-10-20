import * as cdk       from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

/**
 * Aspect that gates all CfnResource children of a construct onto a condition,
 * so the whole subtree produces zero resources when the condition is false.
 *
 * Useful for feature toggles (e.g. support access, artifact tracking) where synth-time
 * opt-in is literal (fully disabled, no resources) but deploy-time opt-in is a
 * CFN-parameter token (condition gates resources until token resolves).
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
    // Skip the condition itself (a condition cannot carry a condition)
    if (node === this.condition) {return;}

    // Gate every CfnResource in the subtree
    if (cdk.CfnResource.isCfnResource(node)) {
      node.cfnOptions.condition = this.condition;
    }
  }
}
