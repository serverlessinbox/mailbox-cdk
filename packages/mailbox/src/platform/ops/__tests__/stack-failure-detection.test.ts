/**
 * StackFailureDetection: the consent switch in front of the detector, and what it hands to the
 * sweeper. `disabled` must synthesize no detector resource at all, or a stack that opted out still
 * reports its failures. When enabled, the sweep targets must name the policy and the rule target the
 * template really contains, because the sweeper deletes them by those names, and the detector must be
 * told the log group its own grants are scoped to. What the infra provisions (names, retention, the
 * single inline policy) is pinned by the infra suite.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import {
  actionsOf,
  allPolicyStatements,
  getAttLogicalId,
  resourcesOf,
  statementsForAction,
} from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { PolicyStatementJson }                     from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                     from 'aws-cdk-lib/assertions';
import * as cdk                                         from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                from 'aws-cdk-lib';
import * as t                                           from 'typanion';

import { resourcesOfType }                              from '../../../__tests__/template-resources';
import { StackFailureDetection, SendStackFailuresMode } from '../stack-failure-detection';

const isRoleProperties     = t.isPartial({});
const isPolicyProperties   = t.isPartial({ PolicyName: t.isString(), Roles: t.isArray(t.isPartial({ Ref: t.isString() })) });
const isRuleProperties     = t.isPartial({ Targets: t.isArray(t.isPartial({ Id: t.isString() })) });
const isFunctionProperties = t.isPartial({
  Environment: t.isPartial({ Variables: t.isPartial({ INFRA_LOG_GROUP_NAME: t.isPartial({ Ref: t.isString() }) }) }),
});

function createTestArtifactResolver(stack: cdk.Stack): IArtifactResolver {
  const packages: Record<string, ArtifactPin> = {
    'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    'mailbox-go':  { version: '1.0.0', zone: ArtifactZone.REGIONAL },
  };
  return new PinnedArtifactResolver({
    packages,
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
}

function buildStack(id: string): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, id, {
    env:         { account: '111122223333', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('StackFailureDetection', () => {
  it('disabled: synthesizes zero detector resources and exposes no sweep targets', () => {
    const stack            = buildStack('test-stack-diag-disabled');
    const artifactResolver = createTestArtifactResolver(stack);

    const detection = new StackFailureDetection(stack, 'stack-failure-detection', {
      mode: SendStackFailuresMode.DISABLED,
      artifactResolver,
      vendorAccountIds: ['444455556666'],
    });

    const template = Template.fromStack(stack);
    expect(Object.keys(template.findResources('AWS::Lambda::Function'))).toEqual([]);
    expect(Object.keys(template.findResources('AWS::Events::Rule'))).toEqual([]);
    expect(Object.keys(template.findResources('AWS::IAM::Role'))).toEqual([]);
    expect(Object.keys(template.findResources('AWS::Lambda::Permission'))).toEqual([]);
    expect(detection.sweepTargets).toBeUndefined();
  });

  describe('enabled', () => {
    let template: Template;
    let detection: StackFailureDetection;

    beforeEach(() => {
      const stack            = buildStack('test-stack-diag-enabled');
      const artifactResolver = createTestArtifactResolver(stack);

      detection = new StackFailureDetection(stack, 'stack-failure-detection', {
        mode: SendStackFailuresMode.ENABLED,
        artifactResolver,
        vendorAccountIds: ['444455556666'],
      });

      template = Template.fromStack(stack);
    });

    it('matches the sweeper contract: the inline policy name and the rule target Id are the sweep targets', () => {
      const targets = detection.sweepTargets;
      if (!targets) {
        throw new Error('enabled detector must expose sweep targets');
      }
      const roleIds           = resourcesOfType(template, 'AWS::IAM::Role', isRoleProperties).map((role) => role.logicalId);
      const policyNamesOnRole = resourcesOfType(template, 'AWS::IAM::Policy', isPolicyProperties)
        .filter((policy) => policy.properties.Roles.some((role) => roleIds.includes(role.Ref)))
        .map((policy) => policy.properties.PolicyName);
      const ruleTargetIds     = resourcesOfType(template, 'AWS::Events::Rule', isRuleProperties)
        .flatMap((rule) => rule.properties.Targets.map((target) => target.Id));

      expect(policyNamesOnRole).toEqual([targets.detectorRolePolicyName]);
      expect(ruleTargetIds).toEqual([targets.stackFailedEvent.ruleTargetId]);
    });

    it('the detector Lambda\'s INFRA_LOG_GROUP_NAME env var points at the exact log group its IAM grant is scoped to', () => {
      // Regression test for a real deploy failure: the detector's Go handler
      // (`env.MustGet("INFRA_LOG_GROUP_NAME")`) panicked on cold start because the construct set no
      // `environment` at all. Both must reference the same CloudFormation logical id, so the variable
      // and the grant can never silently drift apart.
      const [detectorFunction] = resourcesOfType(template, 'AWS::Lambda::Function', isFunctionProperties);
      const envLogicalId       = detectorFunction.properties.Environment.Variables.INFRA_LOG_GROUP_NAME.Ref;

      const referencesLogGroup = (statement: PolicyStatementJson): boolean =>
        getAttLogicalId(resourcesOf(statement)[0]) === envLogicalId;

      const filterEventsMatch = statementsForAction(template, 'logs:FilterLogEvents').some(referencesLogGroup);
      const writeMatch        = allPolicyStatements(template)
        .filter((statement) => actionsOf(statement).includes('logs:CreateLogStream') && actionsOf(statement).includes('logs:PutLogEvents'))
        .some(referencesLogGroup);

      expect(filterEventsMatch).toBe(true);
      expect(writeMatch).toBe(true);
    });
  });
});
