/**
 * AutoUpdater: how its props and defaults reach the updater Lambda and its triggers.
 *
 * The defaults decide what an owner who passes nothing gets (the stable line, minor-release
 * tracking, a six-hourly check). The tracking condition decides whether the post-deploy trigger and
 * the schedule exist at all, and the updater must stay out of its own scan, or it replaces its own
 * code mid-run.
 */

import { getAttLogicalId, statementsForRole }             from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { ServerlessInboxTagKeys }                         from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                                from 'aws-cdk-lib/assertions';
import { PolicyStatement }                                from 'aws-cdk-lib/aws-iam';
import type { Stack }                                     from 'aws-cdk-lib';
import { Duration }                                       from 'aws-cdk-lib';
import * as t                                             from 'typanion';

import { isTemplateValue, resourcesOfType }               from '../../../__tests__/template-resources';
import type { TemplateResource }                          from '../../../__tests__/template-resources';
import type { AdminApiAddonContext }                      from '../../../core/apis/addons';
import { newInlineFunction, newTestStack }                from '../../__tests__/platform-helpers';
import { AutoUpdater }                                    from '../auto-updater';
import type { AutoUpdaterProps }                          from '../auto-updater';

const ARTIFACT_CONTEXT = {
  bucketBase: 'test-artifacts',
  packages:   {
    'mailbox-go':         { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk':        { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk-shared': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk-edge':   { zone: 'edge', version: '1.0.0' },
    'mailbox-admin-ui':   { zone: 'regional', version: '1.0.0' },
    'mailbox-webmail-ui': { zone: 'regional', version: '1.0.0' },
  },
};

const isFunctionProperties = t.isPartial({
  Role:        isTemplateValue,
  Environment: t.isOptional(t.isPartial({ Variables: t.isRecord(isTemplateValue) })),
  Tags:        t.isOptional(t.isArray(t.isPartial({ Key: t.isString(), Value: t.isString() }))),
});

const isConditionsJson = t.isPartial({ Conditions: t.isOptional(t.isRecord(t.isPartial({}))) });

interface UpdaterFixture {
  readonly stack:       Stack;
  readonly autoUpdater: AutoUpdater;
}

function build(props?: AutoUpdaterProps): UpdaterFixture {
  const stack = newTestStack('TestStack', undefined, { 'serverlessinbox:artifacts': ARTIFACT_CONTEXT });
  return { stack, autoUpdater: new AutoUpdater(stack, 'auto-updater', props) };
}

/** The updater is the only function whose environment sets DIST_TAG. */
function updaterOf(template: Template): TemplateResource<t.InferType<typeof isFunctionProperties>> {
  const [updater] = resourcesOfType(template, 'AWS::Lambda::Function', isFunctionProperties).filter(
    (candidate) => candidate.properties.Environment?.Variables.DIST_TAG !== undefined,
  );
  if (updater === undefined) {
    throw new Error('No function sets DIST_TAG');
  }
  return updater;
}

/** The conditions of a synthesized template, keyed by logical id. */
function conditionsOf(template: Template): Record<string, unknown> {
  const json: unknown    = template.toJSON();
  const errors: string[] = [];
  if (!isConditionsJson(json, { errors })) {
    throw new Error(`Unexpected template shape: ${errors.join('; ')}`);
  }
  return json.Conditions ?? {};
}

describe('AutoUpdater', () => {
  describe('updater settings', () => {
    it('follows the stable line at minor granularity when given no props', () => {
      const template = Template.fromStack(build().stack);

      expect(updaterOf(template).properties.Environment?.Variables).toMatchObject({ DIST_TAG: 'stable', GRANULARITY: 'minor' });
    });

    it('passes the given dist-tag and granularity to the updater', () => {
      const template = Template.fromStack(build({ distTag: 'beta', granularity: 'major' }).stack);

      expect(updaterOf(template).properties.Environment?.Variables).toMatchObject({ DIST_TAG: 'beta', GRANULARITY: 'major' });
    });

    it('reads release artifacts from the registry bucket base of the pinned resolver', () => {
      const template = Template.fromStack(build().stack);

      expect(updaterOf(template).properties.Environment?.Variables).toMatchObject({ ARTIFACT_BUCKET_BASE: ARTIFACT_CONTEXT.bucketBase });
    });

    it('scopes the updater to the stack it is deployed in', () => {
      const template = Template.fromStack(build().stack);

      expect(updaterOf(template).properties.Environment?.Variables).toMatchObject({
        ROOT_STACK_TAG_VALUE: { Ref: 'AWS::StackName' },
        ROOT_STACK_ID:        { 'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }] },
      });
    });

    it('tags the updater so it is left out of its own scan', () => {
      const template = Template.fromStack(build().stack);

      expect(updaterOf(template).properties.Tags).toContainEqual({ Key: ServerlessInboxTagKeys.autoUpdateType, Value: 'none' });
    });
  });

  describe('tracking', () => {
    it('tracks unless granularity is pinned, and is minor by default', () => {
      const template = Template.fromStack(build().stack);

      expect(Object.values(conditionsOf(template))).toEqual([{ 'Fn::Not': [{ 'Fn::Equals': ['minor', 'pinned'] }] }]);
    });

    it('compares the given granularity with pinned', () => {
      const template = Template.fromStack(build({ granularity: 'pinned' }).stack);

      expect(Object.values(conditionsOf(template))).toEqual([{ 'Fn::Not': [{ 'Fn::Equals': ['pinned', 'pinned'] }] }]);
    });

    it('keeps the updater function ungated, so pinned stacks can still invoke it', () => {
      const template = Template.fromStack(build({ granularity: 'pinned' }).stack);

      template.hasResource('AWS::Lambda::Function', {
        Condition:  Match.absent(),
        Properties: Match.objectLike({ Environment: { Variables: Match.objectLike({ DIST_TAG: 'stable' }) } }),
      });
    });

    it('checks every six hours by default', () => {
      Template.fromStack(build().stack).hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(6 hours)' });
    });

    it('checks at the given interval', () => {
      Template.fromStack(build({ updateInterval: Duration.minutes(30) }).stack).hasResourceProperties('AWS::Events::Rule', {
        ScheduleExpression: 'rate(30 minutes)',
      });
    });

    it('makes the deploy-end trigger wait for a dependency added after construction', () => {
      const { stack, autoUpdater } = build();

      autoUpdater.addDeployEndDependency(newInlineFunction(stack, 'awaited'));

      const template         = Template.fromStack(stack);
      const functions        = template.findResources('AWS::Lambda::Function');
      const awaitedLogicalId = Object.keys(functions).find((id) => id.startsWith('awaited'));
      const [deployEnd]      = Object.values(template.findResources('Custom::DeployEndTrigger'));
      expect(awaitedLogicalId).toBeDefined();
      expect(deployEnd.DependsOn).toContain(awaitedLogicalId);
    });
  });

  describe('grantPrincipal', () => {
    it("is the updater function's own role", () => {
      const { stack, autoUpdater } = build();
      autoUpdater.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({ actions: ['s3:PutObject'], resources: ['arn:aws:s3:::a-bucket/*'] }));

      const template      = Template.fromStack(stack);
      const roleLogicalId = getAttLogicalId(updaterOf(template).properties.Role) ?? '';
      expect(statementsForRole(template, roleLogicalId)).toContainEqual({
        Action:   's3:PutObject',
        Effect:   'Allow',
        Resource: 'arn:aws:s3:::a-bucket/*',
      });
    });
  });

  describe('createAdminApiAddons', () => {
    it('returns one addon for the admin API', () => {
      const { stack, autoUpdater } = build();
      // cast: AutoUpdater does not read the context, so an empty one stands in for the shared tables.
      const addons = autoUpdater.createAdminApiAddons(stack, {} as AdminApiAddonContext);

      expect(addons).toHaveLength(1);
    });
  });
});
