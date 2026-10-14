/// <reference types="jest" />

/**
 * AutoUpdater: how its props and defaults reach the updater Lambda and its triggers.
 *
 * The defaults decide what an owner who passes nothing gets (the stable line, minor-release
 * tracking, a six-hourly check). The tracking condition decides whether the post-deploy trigger and
 * the schedule exist at all, and the updater must stay out of its own scan, or it replaces its own
 * code mid-run.
 */

import { App, BootstraplessSynthesizer, Duration, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import { getAttLogicalId, statementsForRole } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { AdminApiAddonContext } from '../../../api/addons';
import { AutoUpdater } from '../auto-updater';
import type { AutoUpdaterProps } from '../auto-updater';

const ARTIFACT_CONTEXT = {
  bucketBase: 'test-artifacts',
  packages: {
    'mailbox-go': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk-shared': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk-edge': { zone: 'edge', version: '1.0.0' },
    'mailbox-admin-ui': { zone: 'regional', version: '1.0.0' },
    'mailbox-webmail-ui': { zone: 'regional', version: '1.0.0' },
  },
};

interface UpdaterFixture {
  readonly stack: Stack;
  readonly autoUpdater: AutoUpdater;
}

interface FunctionResource {
  readonly Properties: {
    readonly Role: unknown;
    readonly Environment?: { readonly Variables: Record<string, unknown> };
    readonly Tags?: Array<{ Key: string; Value: string }>;
  };
}

interface UpdaterFunction {
  readonly logicalId: string;
  readonly resource: FunctionResource;
}

function build(props?: AutoUpdaterProps): UpdaterFixture {
  const app = new App({ context: { 'serverlessinbox:artifacts': ARTIFACT_CONTEXT } });
  const stack = new Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  return { stack, autoUpdater: new AutoUpdater(stack, 'auto-updater', props) };
}

function inlineFunction(stack: Stack, id: string): LambdaFunction {
  return new LambdaFunction(stack, id, { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });
}

/** The updater is the only function whose environment sets DIST_TAG. */
function updaterOf(template: Template): UpdaterFunction {
  const functions = template.findResources('AWS::Lambda::Function');
  const [logicalId] = Object.keys(functions).filter((id) => (functions[id] as FunctionResource).Properties.Environment?.Variables.DIST_TAG);
  return { logicalId, resource: functions[logicalId] as FunctionResource };
}

describe('AutoUpdater', () => {
  describe('updater settings', () => {
    it('follows the stable line at minor granularity when given no props', () => {
      const { resource } = updaterOf(Template.fromStack(build().stack));

      expect(resource.Properties.Environment?.Variables).toMatchObject({ DIST_TAG: 'stable', GRANULARITY: 'minor' });
    });

    it('passes the given dist-tag and granularity to the updater', () => {
      const { resource } = updaterOf(Template.fromStack(build({ distTag: 'beta', granularity: 'major' }).stack));

      expect(resource.Properties.Environment?.Variables).toMatchObject({ DIST_TAG: 'beta', GRANULARITY: 'major' });
    });

    it('reads release artifacts from the registry bucket base of the pinned resolver', () => {
      const { resource } = updaterOf(Template.fromStack(build().stack));

      expect(resource.Properties.Environment?.Variables).toMatchObject({ ARTIFACT_BUCKET_BASE: ARTIFACT_CONTEXT.bucketBase });
    });

    it('scopes the updater to the stack it is deployed in', () => {
      const { resource } = updaterOf(Template.fromStack(build().stack));

      expect(resource.Properties.Environment?.Variables).toMatchObject({ ROOT_STACK_TAG_VALUE: { Ref: 'AWS::StackName' } });
    });

    it('tags the updater so it is left out of its own scan', () => {
      const { resource } = updaterOf(Template.fromStack(build().stack));

      expect(resource.Properties.Tags).toContainEqual({ Key: ServerlessInboxTagKeys.autoUpdateType, Value: 'none' });
    });
  });

  describe('tracking', () => {
    it('tracks unless granularity is pinned, and is minor by default', () => {
      const template = Template.fromStack(build().stack);

      expect(Object.values(template.toJSON().Conditions)).toEqual([{ 'Fn::Not': [{ 'Fn::Equals': ['minor', 'pinned'] }] }]);
    });

    it('compares the given granularity with pinned', () => {
      const template = Template.fromStack(build({ granularity: 'pinned' }).stack);

      expect(Object.values(template.toJSON().Conditions)).toEqual([{ 'Fn::Not': [{ 'Fn::Equals': ['pinned', 'pinned'] }] }]);
    });

    it('keeps the updater function ungated, so pinned stacks can still invoke it', () => {
      const template = Template.fromStack(build({ granularity: 'pinned' }).stack);

      expect(updaterOf(template).resource).toBeDefined();
      expect(updaterOf(template).resource).not.toHaveProperty('Condition');
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

      autoUpdater.addDeployEndDependency(inlineFunction(stack, 'awaited'));

      const template = Template.fromStack(stack);
      const functions = template.findResources('AWS::Lambda::Function');
      const awaitedLogicalId = Object.keys(functions).find((id) => id.startsWith('awaited'));
      const [deployEnd] = Object.values(template.findResources('Custom::DeployEndTrigger'));
      expect(awaitedLogicalId).toBeDefined();
      expect(deployEnd.DependsOn).toContain(awaitedLogicalId);
    });
  });

  describe('grantPrincipal', () => {
    it("is the updater function's own role", () => {
      const { stack, autoUpdater } = build();
      autoUpdater.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({ actions: ['s3:PutObject'], resources: ['arn:aws:s3:::a-bucket/*'] }));

      const template = Template.fromStack(stack);
      const roleLogicalId = getAttLogicalId(updaterOf(template).resource.Properties.Role) ?? '';
      expect(statementsForRole(template, roleLogicalId)).toContainEqual({
        Action: 's3:PutObject',
        Effect: 'Allow',
        Resource: 'arn:aws:s3:::a-bucket/*',
      });
    });
  });

  describe('createAdminApiAddons', () => {
    it('returns one addon that mounts the updater function on the admin API', () => {
      const { stack, autoUpdater } = build();
      const api = new HttpApi(stack, 'api');
      const authorizer = new HttpLambdaAuthorizer('authorizer', inlineFunction(stack, 'authorizer'), {
        responseTypes: [HttpLambdaResponseType.SIMPLE],
      });
      // cast: AutoUpdater does not read the context, so an empty one stands in for the shared tables.
      const addons = autoUpdater.createAdminApiAddons(stack, {} as AdminApiAddonContext);

      addons.forEach((addon) => addon.addRoutes(api, authorizer));

      const template = Template.fromStack(stack);
      const invokedByApiGateway = Object.values(template.findResources('AWS::Lambda::Permission'))
        .filter((permission) => permission.Properties.Principal === 'apigateway.amazonaws.com')
        .map((permission) => getAttLogicalId(permission.Properties.FunctionName));
      expect(addons).toHaveLength(1);
      expect(invokedByApiGateway).toContain(updaterOf(template).logicalId);
    });
  });
});
