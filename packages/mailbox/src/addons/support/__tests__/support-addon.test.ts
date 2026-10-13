/**
 * Pins what `SupportAddon` provisions: nothing for a literal DISABLED mode, a condition-gated
 * feature for a CloudFormation parameter token, and for ENABLED the support roles and their
 * trust, the support-api and collector Lambdas, and the least-privilege grants those Lambdas hold.
 * Weakening these assertions can let a support tier widen silently, let the feature leak into a
 * deployment that disabled it, or trust the wrong AWS account.
 */

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { VENDOR_ACCOUNT_ID } from '@serverlessinbox/mailbox-cdk-shared';
import { statementsForRole } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { SupportAddon, SupportMode } from '../support-addon';
import {
  createApiWithAuthorizer,
  createSupportTestStack,
  findFunction,
  type SupportTestStack,
  type SynthesizedResource,
} from './support-test-fixtures';

const DIAG_TAG_KEY = 'serverless-inbox:support:diag';
const CONFIG_READ_TAG_KEY = 'serverless-inbox:support:config-read';
const SUPPORT_API = 'support-api';
const COLLECTOR = 'support-role-assumption-collector';

function createAddon(inputs: SupportTestStack, mode: SupportMode): SupportAddon {
  return new SupportAddon(inputs.stack, 'addon', {
    mode,
    artifactResolver: inputs.artifactResolver,
    configTable: inputs.configTable,
    auditEventsQueue: inputs.auditEventsQueue,
  });
}

function synthesizeEnabled(context?: Record<string, unknown>): Template {
  const inputs = createSupportTestStack(context);
  createAddon(inputs, SupportMode.ENABLED);
  return Template.fromStack(inputs.stack);
}

interface InlinePolicyRoleProperties {
  readonly Policies: Array<{ PolicyDocument: { Statement: Array<{ Action: string[] }> } }>;
}

function actionsOf(role: SynthesizedResource): Set<string> {
  const { Policies } = role.Properties as InlinePolicyRoleProperties;
  return new Set(Policies.flatMap((policy) => policy.PolicyDocument.Statement.flatMap((statement) => statement.Action)));
}

describe('SupportAddon', () => {
  describe('literal DISABLED mode', () => {
    it('provisions no support resources and reports support as unavailable', () => {
      const inputs = createSupportTestStack();
      const addon = createAddon(inputs, SupportMode.DISABLED);

      const template = Template.fromStack(inputs.stack);
      template.resourceCountIs('AWS::IAM::Role', 0);
      template.resourceCountIs('AWS::Lambda::Function', 0);
      template.resourceCountIs('AWS::Events::Rule', 0);
      expect(template.toJSON().Conditions).toBeUndefined();
      expect(addon.uiConfig).toEqual({ support: { available: false } });
    });

    it('mounts no routes', () => {
      const inputs = createSupportTestStack();
      const { api, authorizer } = createApiWithAuthorizer(inputs.stack);

      createAddon(inputs, SupportMode.DISABLED).addRoutes(api, authorizer);

      Template.fromStack(inputs.stack).resourceCountIs('AWS::ApiGatewayV2::Route', 0);
    });
  });

  describe('CloudFormation parameter mode', () => {
    function synthesizeWithParameter(): { template: Template; addon: SupportAddon } {
      const inputs = createSupportTestStack();
      const modeParameter = new cdk.CfnParameter(inputs.stack, 'supportMode', { type: 'String' });
      const addon = createAddon(inputs, modeParameter.valueAsString as SupportMode);
      return { template: Template.fromStack(inputs.stack), addon };
    }

    it('gates every support resource behind a condition on the parameter equalling enabled', () => {
      const { template } = synthesizeWithParameter();

      template.hasCondition('*', { 'Fn::Equals': [{ Ref: 'supportMode' }, SupportMode.ENABLED] });
      const [conditionName] = Object.keys(template.toJSON().Conditions);
      for (const type of ['AWS::IAM::Role', 'AWS::IAM::Policy', 'AWS::Lambda::Function', 'AWS::Events::Rule']) {
        const resources = Object.values(template.findResources(type));
        expect(resources.length).toBeGreaterThan(0);
        expect(resources.map((resource) => resource.Condition)).toEqual(resources.map(() => conditionName));
      }
    });

    it('reports support as available, since the deployer may enable it', () => {
      expect(synthesizeWithParameter().addon.uiConfig).toEqual({ support: { available: true } });
    });
  });

  describe('ENABLED mode', () => {
    it('reports support as available', () => {
      const inputs = createSupportTestStack();

      expect(createAddon(inputs, SupportMode.ENABLED).uiConfig).toEqual({ support: { available: true } });
    });

    it('mounts POST /support/{proxy+} behind the Admin API authorizer', () => {
      const inputs = createSupportTestStack();
      const { api, authorizer } = createApiWithAuthorizer(inputs.stack);

      createAddon(inputs, SupportMode.ENABLED).addRoutes(api, authorizer);

      Template.fromStack(inputs.stack).hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'POST /support/{proxy+}',
        AuthorizationType: 'CUSTOM',
      });
    });

    describe('Lambdas', () => {
      const template = synthesizeEnabled();

      it('gives the support-api Lambda the hop role, tier roles, config table and audit queue', () => {
        expect(findFunction(template, SUPPORT_API).environment).toEqual(expect.objectContaining({
          SUPPORT_HOP_ROLE_ARN: expect.anything(),
          SUPPORT_DIAG_ROLE_ARN: expect.anything(),
          SUPPORT_CONFIG_READ_ROLE_ARN: expect.anything(),
          CONFIG_TABLE_NAME: expect.anything(),
          AUDIT_EVENTS_QUEUE_URL: expect.anything(),
          SUPPORT_DIAG_TAG_KEY: DIAG_TAG_KEY,
          SUPPORT_CONFIG_READ_TAG_KEY: CONFIG_READ_TAG_KEY,
        }));
      });

      it('gives the collector Lambda the hop role, tier roles and config table', () => {
        expect(findFunction(template, COLLECTOR).environment).toEqual(expect.objectContaining({
          SUPPORT_HOP_ROLE_ARN: expect.anything(),
          SUPPORT_DIAG_ROLE_ARN: expect.anything(),
          SUPPORT_CONFIG_READ_ROLE_ARN: expect.anything(),
          CONFIG_TABLE_NAME: expect.anything(),
        }));
      });

      it('triggers the collector hourly', () => {
        template.hasResourceProperties('AWS::Events::Rule', {
          ScheduleExpression: 'cron(0 * * * ? *)',
          Targets: [Match.objectLike({ Arn: { 'Fn::GetAtt': [findFunction(template, COLLECTOR).logicalId, 'Arn'] } })],
        });
      });
    });

    describe('support roles', () => {
      const template = synthesizeEnabled();
      const roles = Object.entries(template.findResources('AWS::IAM::Role'));
      const trusting = (needle: string) => roles.filter(([, role]) => JSON.stringify(role.Properties.AssumeRolePolicyDocument).includes(needle));

      it('trusts only the vendor account root on the hop role', () => {
        template.hasResourceProperties('AWS::IAM::Role', {
          AssumeRolePolicyDocument: {
            Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: `arn:aws:iam::${VENDOR_ACCOUNT_ID}:root` } }],
          },
          MaxSessionDuration: 3600,
        });
      });

      it.each([
        ['diag', DIAG_TAG_KEY],
        ['config-read', CONFIG_READ_TAG_KEY],
      ])('trusts the hop role on the %s tier only for sessions tagged with the case external ID', (_tier, tagKey) => {
        const [[, role]] = trusting(`aws:PrincipalTag/${tagKey}"`);

        expect(role.Properties.MaxSessionDuration).toBe(3600);
        expect(role.Properties.AssumeRolePolicyDocument.Statement).toEqual([
          expect.objectContaining({
            Effect: 'Allow',
            Action: 'sts:AssumeRole',
            Condition: { StringLike: { [`aws:PrincipalTag/${tagKey}`]: '*/${sts:ExternalId}/*' } },
          }),
        ]);
      });

      it('creates the tier roles only after the hop role they trust exists', () => {
        const [[hopLogicalId]] = trusting(`:iam::${VENDOR_ACCOUNT_ID}:root`);

        for (const tagKey of [DIAG_TAG_KEY, CONFIG_READ_TAG_KEY]) {
          const [[, tierRole]] = trusting(`aws:PrincipalTag/${tagKey}"`);
          expect(tierRole.DependsOn).toContain(hopLogicalId);
        }
      });

      it('grants the diag tier a fixed action set and config-read that set plus configuration reads', () => {
        const [[, diag]] = trusting(`aws:PrincipalTag/${DIAG_TAG_KEY}"`);
        const [[, configRead]] = trusting(`aws:PrincipalTag/${CONFIG_READ_TAG_KEY}"`);

        // Tripwire: a changed count means a tier gained or lost an action. Review it, do not just update the number.
        expect(actionsOf(diag).size).toBe(16);
        expect(actionsOf(configRead).size).toBe(42);
        expect(actionsOf(diag).has('lambda:GetFunctionConfiguration')).toBe(false);
        expect(actionsOf(configRead).has('lambda:GetFunctionConfiguration')).toBe(true);
        expect([...actionsOf(diag)].filter((action) => !actionsOf(configRead).has(action))).toEqual([]);
      });
    });

    describe.each([SUPPORT_API, COLLECTOR])('%s Lambda role', (serviceName) => {
      const template = synthesizeEnabled();
      const fn = findFunction(template, serviceName);
      const statements = statementsForRole(template, fn.roleLogicalId);

      it('may only tag and untag the hop role, with only the two tier tag keys', () => {
        expect(statements).toContainEqual({
          Effect: 'Allow',
          Action: ['iam:TagRole', 'iam:UntagRole'],
          Condition: { 'ForAllValues:StringEquals': { 'aws:TagKeys': [DIAG_TAG_KEY, CONFIG_READ_TAG_KEY] } },
          Resource: fn.environment.SUPPORT_HOP_ROLE_ARN,
        });
      });

      it('reads and writes the config table it was given', () => {
        const tableArn = { 'Fn::GetAtt': [(fn.environment.CONFIG_TABLE_NAME as { Ref: string }).Ref, 'Arn'] };

        expect(statements).toContainEqual(expect.objectContaining({
          Action: expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem']),
          Resource: expect.arrayContaining([tableArn]),
        }));
      });

      it('may look up CloudTrail events', () => {
        expect(statements).toContainEqual(expect.objectContaining({ Action: 'cloudtrail:LookupEvents' }));
      });
    });

    describe('support-api Lambda role', () => {
      const template = synthesizeEnabled();
      const fn = findFunction(template, SUPPORT_API);
      const statements = statementsForRole(template, fn.roleLogicalId);

      it('may send messages to the audit queue it was given', () => {
        const queueArn = { 'Fn::GetAtt': [(fn.environment.AUDIT_EVENTS_QUEUE_URL as { Ref: string }).Ref, 'Arn'] };

        expect(statements).toContainEqual(expect.objectContaining({ Action: 'sqs:SendMessage', Resource: queueArn }));
      });
    });

    describe('vendor account IDs', () => {
      const EXECUTE_API_SUFFIX = ':*/*/POST/support-case-sync';
      const executeApiStatement = (template: Template) => statementsForRole(template, findFunction(template, SUPPORT_API).roleLogicalId)
        .find((statement) => statement.Action === 'execute-api:Invoke');

      it('defaults to the product vendor account for hop role trust and the execute-api grant', () => {
        const template = synthesizeEnabled();

        template.hasResourceProperties('AWS::IAM::Role', {
          AssumeRolePolicyDocument: { Statement: [Match.objectLike({ Principal: { AWS: `arn:aws:iam::${VENDOR_ACCOUNT_ID}:root` } })] },
        });
        expect(executeApiStatement(template)?.Resource).toBe(`arn:aws:execute-api:*:${VENDOR_ACCOUNT_ID}${EXECUTE_API_SUFFIX}`);
      });

      it('uses the accounts from CDK context for hop role trust and the execute-api grant', () => {
        const template = synthesizeEnabled({ 'serverlessinbox:vendor_account_ids': ['111122223333', '444455556666'] });

        template.hasResourceProperties('AWS::IAM::Role', {
          AssumeRolePolicyDocument: {
            Statement: [Match.objectLike({ Principal: { AWS: ['arn:aws:iam::111122223333:root', 'arn:aws:iam::444455556666:root'] } })],
          },
        });
        expect(executeApiStatement(template)?.Resource).toEqual([
          `arn:aws:execute-api:*:111122223333${EXECUTE_API_SUFFIX}`,
          `arn:aws:execute-api:*:444455556666${EXECUTE_API_SUFFIX}`,
        ]);
      });
    });
  });
});
