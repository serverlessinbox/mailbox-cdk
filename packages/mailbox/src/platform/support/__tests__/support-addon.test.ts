/**
 * Pins what `SupportAddon` itself decides: nothing is provisioned for a literal DISABLED mode, every
 * resource sits behind a condition on the mode for a CloudFormation parameter token, the routes are
 * mounted behind the Admin API authorizer, and both Lambdas are wired to the same support roles and
 * to the vendor accounts of the CDK context. The roles' trust and actions are pinned by the roles'
 * own tests, and each Lambda's grants by its own wrapper test. Weakening these assertions can let
 * the feature leak into a deployment that disabled it, or trust the wrong AWS account.
 */

import { actionsOf, statementsForRole }          from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { VENDOR_ACCOUNT_ID }                     from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                       from 'aws-cdk-lib/assertions';
import * as cdk                                  from 'aws-cdk-lib';

import { SupportAddon, SupportMode }             from '../support-addon';

import {
  createApiWithAuthorizer,
  createSupportTestStack,
  findFunction,
  type SupportTestStack,
} from './support-test-fixtures';

const SUPPORT_API = 'support-api';

/** The root principal of an account, as a template renders it: partition-aware, never a literal `arn:aws`. */
function accountRoot(accountId: string): unknown {
  return { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:iam::${accountId}:root`]] };
}

function createAddon(inputs: SupportTestStack, mode: SupportMode): SupportAddon {
  return new SupportAddon(inputs.stack, 'addon', {
    mode,
    artifactResolver: inputs.artifactResolver,
    configTable:      inputs.configTable,
    auditEventsQueue: inputs.auditEventsQueue,
  });
}

function synthesizeEnabled(context?: Record<string, unknown>): Template {
  const inputs = createSupportTestStack(context);
  createAddon(inputs, SupportMode.ENABLED);
  return Template.fromStack(inputs.stack);
}

describe('SupportAddon', () => {
  describe('literal DISABLED mode', () => {
    it('provisions no support resources and reports support as unavailable', () => {
      const inputs = createSupportTestStack();
      const addon  = createAddon(inputs, SupportMode.DISABLED);

      const template = Template.fromStack(inputs.stack);
      template.resourceCountIs('AWS::IAM::Role', 0);
      template.resourceCountIs('AWS::Lambda::Function', 0);
      template.resourceCountIs('AWS::Events::Rule', 0);
      expect(template.toJSON().Conditions).toBeUndefined();
      expect(addon.uiConfig).toEqual({ support: { available: false } });
    });

    it('mounts no routes', () => {
      const inputs              = createSupportTestStack();
      const { api, authorizer } = createApiWithAuthorizer(inputs.stack);

      createAddon(inputs, SupportMode.DISABLED).addRoutes(api, authorizer);

      Template.fromStack(inputs.stack).resourceCountIs('AWS::ApiGatewayV2::Route', 0);
    });
  });

  describe('CloudFormation parameter mode', () => {
    function synthesizeWithParameter(): { template: Template; addon: SupportAddon } {
      const inputs        = createSupportTestStack();
      const modeParameter = new cdk.CfnParameter(inputs.stack, 'supportMode', { type: 'String' });
      const addon         = createAddon(inputs, modeParameter.valueAsString as SupportMode);
      return { template: Template.fromStack(inputs.stack), addon };
    }

    it('gates every support resource behind a condition on the parameter equalling enabled', () => {
      const { template } = synthesizeWithParameter();

      template.hasCondition('*', { 'Fn::Equals': [{ Ref: 'supportMode' }, SupportMode.ENABLED] });
      const [conditionName] = Object.keys(template.toJSON().Conditions as Record<string, unknown>);
      for (const type of ['AWS::IAM::Role', 'AWS::IAM::Policy', 'AWS::Lambda::Function', 'AWS::Events::Rule']) {
        const resources = Object.values(template.findResources(type));
        expect(resources.length).toBeGreaterThan(0);
        expect(resources.map((resource): unknown => resource.Condition)).toEqual(resources.map(() => conditionName));
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
      const inputs              = createSupportTestStack();
      const { api, authorizer } = createApiWithAuthorizer(inputs.stack);

      createAddon(inputs, SupportMode.ENABLED).addRoutes(api, authorizer);

      Template.fromStack(inputs.stack).hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey:          'POST /support/{proxy+}',
        AuthorizationType: 'CUSTOM',
      });
    });

    it('provisions the support-api Lambda and the role-assumption collector', () => {
      const template = synthesizeEnabled();

      expect(findFunction(template, SUPPORT_API).logicalId).not.toBe(findFunction(template, 'support-role-assumption-collector').logicalId);
    });

    describe('vendor account IDs', () => {
      const EXECUTE_API_SUFFIX  = ':*/*/POST/support-case-sync';
      const executeApiStatement = (template: Template) => statementsForRole(template, findFunction(template, SUPPORT_API).roleLogicalId)
        .find((statement) => actionsOf(statement).includes('execute-api:Invoke'));
      /** The execute-api resource as the template renders it: partition-aware, never a literal `arn:aws`. */
      const executeApiArn = (accountId: string): unknown =>
        ({ 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:execute-api:*:${accountId}${EXECUTE_API_SUFFIX}`]] });

      it('defaults to the product vendor account for hop role trust and the execute-api grant', () => {
        const template = synthesizeEnabled();

        template.hasResourceProperties('AWS::IAM::Role', {
          AssumeRolePolicyDocument: { Statement: [Match.objectLike({ Principal: { AWS: accountRoot(VENDOR_ACCOUNT_ID) } })] },
        });
        expect(executeApiStatement(template)?.Resource).toEqual(executeApiArn(VENDOR_ACCOUNT_ID));
      });

      it('uses the accounts from CDK context for hop role trust and the execute-api grant', () => {
        const template = synthesizeEnabled({ 'serverlessinbox:vendor_account_ids': ['111122223333', '444455556666'] });

        template.hasResourceProperties('AWS::IAM::Role', {
          AssumeRolePolicyDocument: {
            Statement: [
              Match.objectLike({ Principal: { AWS: accountRoot('111122223333') } }),
              Match.objectLike({ Principal: { AWS: accountRoot('444455556666') } }),
            ],
          },
        });
        expect(executeApiStatement(template)?.Resource).toEqual([
          executeApiArn('111122223333'),
          executeApiArn('444455556666'),
        ]);
      });
    });
  });
});
