/**
 * Pins the IAM roles `SupportRolesInfra` declares and the tier registry it exports: who may assume the
 * hop role, how a tier role is reachable only through the hop role and a case external ID, and which
 * actions each tier is granted and under what scoping. Weakening these assertions can let a support
 * tier widen silently, trust the wrong AWS account, or let a tier role be assumed without a case.
 */

import { Template }                             from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import {
  SupportRolesInfra,
  SUPPORT_CONFIG_READ_TAG_KEY,
  SUPPORT_DIAG_TAG_KEY,
  buildSupportTierEnvironment,
  getSupportTierTagKeys,
} from '../support-roles-infra';

const DIAG_TAG_KEY        = 'serverless-inbox:support:diag';
const CONFIG_READ_TAG_KEY = 'serverless-inbox:support:config-read';
const DIAG_POLICY         = 'support-diag-access';
const CONFIG_READ_POLICY  = 'support-config-read-access';
const HOP_POLICY          = 'support-hop-assume';

interface StatementJson {
  readonly Effect:     string;
  readonly Action:     string | string[];
  readonly Resource:   unknown;
  readonly Condition?: unknown;
}

/** The parts of a synthesized `AWS::IAM::Role` these assertions read. */
interface SynthesizedRole {
  readonly DependsOn?: string[];
  readonly Properties: {
    readonly MaxSessionDuration:       number;
    readonly AssumeRolePolicyDocument: { readonly Statement: Array<{ Principal: unknown; Condition?: unknown }> };
    readonly Policies:                 Array<{ PolicyName: string; PolicyDocument: { Statement: StatementJson[] } }>;
  };
}

interface SynthesizedInfra {
  readonly stack:    Stack;
  readonly template: Template;
  readonly infra:    SupportRolesInfra;
}

function synthesize(vendorAccountIds: string[]): SynthesizedInfra {
  const stack = new Stack(new App(), 'support-roles-stack', {
    env:         { account: '111122223333', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const infra = new SupportRolesInfra(stack, 'roles-infra', { vendorAccountIds });
  return { stack, template: Template.fromStack(stack), infra };
}

function roleWithPolicy(template: Template, policyName: string): { logicalId: string; role: SynthesizedRole } {
  // cast: CDK's findResources returns untyped template JSON; this is the one framework boundary.
  const roles = Object.entries(template.findResources('AWS::IAM::Role')) as Array<[string, SynthesizedRole]>;
  const match = roles.find(([, role]) => role.Properties.Policies.some((policy) => policy.PolicyName === policyName));
  if (!match) {
    throw new Error(`No role carries the inline policy ${policyName}`);
  }
  return { logicalId: match[0], role: match[1] };
}

function statementsOf(role: SynthesizedRole): StatementJson[] {
  return role.Properties.Policies.flatMap((policy) => policy.PolicyDocument.Statement);
}

function actionsOf(role: SynthesizedRole): Set<string> {
  return new Set(statementsOf(role).flatMap((statement) => [statement.Action].flat()));
}

function statementGranting(role: SynthesizedRole, action: string): StatementJson {
  const statement = statementsOf(role).find((s) => [s.Action].flat().includes(action));
  if (!statement) {
    throw new Error(`No statement grants ${action}`);
  }
  return statement;
}

describe('SupportRolesInfra', () => {
  describe('hop role', () => {
    it('trusts the root of the single vendor account as a plain ARN', () => {
      const { template } = synthesize(['111111111111']);

      const { role } = roleWithPolicy(template, HOP_POLICY);

      expect(role.Properties.AssumeRolePolicyDocument.Statement).toEqual([
        { Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: 'arn:aws:iam::111111111111:root' } },
      ]);
      expect(role.Properties.MaxSessionDuration).toBe(3600);
    });

    it('trusts the root of every vendor account when there are several', () => {
      const { template } = synthesize(['111111111111', '222222222222']);

      const { role } = roleWithPolicy(template, HOP_POLICY);

      expect(role.Properties.AssumeRolePolicyDocument.Statement).toEqual([
        {
          Effect:    'Allow',
          Action:    'sts:AssumeRole',
          Principal: { AWS: ['arn:aws:iam::111111111111:root', 'arn:aws:iam::222222222222:root'] },
        },
      ]);
    });

    it('may only assume the tier roles', () => {
      const { stack, template, infra } = synthesize(['111111111111']);

      const { role } = roleWithPolicy(template, HOP_POLICY);

      expect(statementsOf(role)).toEqual([
        {
          Effect:   'Allow',
          Action:   'sts:AssumeRole',
          Resource: [stack.resolve(infra.tierArns['support-diag']), stack.resolve(infra.tierArns['support-config-read'])],
        },
      ]);
    });
  });

  describe('tier roles', () => {
    it.each([
      [DIAG_POLICY, DIAG_TAG_KEY],
      [CONFIG_READ_POLICY, CONFIG_READ_TAG_KEY],
    ])('%s is assumable only by the hop role, for sessions tagged with the case external ID', (policyName, tagKey) => {
      const { stack, template, infra } = synthesize(['111111111111']);

      const { role } = roleWithPolicy(template, policyName);

      expect(role.Properties.MaxSessionDuration).toBe(3600);
      expect(role.Properties.AssumeRolePolicyDocument.Statement).toEqual([
        {
          Effect:    'Allow',
          Action:    'sts:AssumeRole',
          Principal: { AWS: stack.resolve(infra.supportHopRoleArn) },
          Condition: { StringLike: { [`aws:PrincipalTag/${tagKey}`]: '*/${sts:ExternalId}/*' } },
        },
      ]);
    });

    it('are created only after the hop role they trust exists', () => {
      const { template }                = synthesize(['111111111111']);
      const { logicalId: hopLogicalId } = roleWithPolicy(template, HOP_POLICY);

      for (const policyName of [DIAG_POLICY, CONFIG_READ_POLICY]) {
        expect(roleWithPolicy(template, policyName).role.DependsOn).toContain(hopLogicalId);
      }
    });

    it('grant diag the observability actions and config-read those plus configuration reads', () => {
      const { template } = synthesize(['111111111111']);

      const diag       = actionsOf(roleWithPolicy(template, DIAG_POLICY).role);
      const configRead = actionsOf(roleWithPolicy(template, CONFIG_READ_POLICY).role);

      expect(diag.has('logs:GetLogEvents')).toBe(true);
      expect(diag.has('lambda:GetFunctionConfiguration')).toBe(false);
      expect(configRead.has('lambda:GetFunctionConfiguration')).toBe(true);
      expect([...diag].filter((action) => !configRead.has(action))).toEqual([]);
    });

    it('scope resource-naming actions by the root-stack tags, by id and by name for a resource without an id tag, and leave enumeration actions unconditioned', () => {
      const { template } = synthesize(['111111111111']);
      const { role }     = roleWithPolicy(template, CONFIG_READ_POLICY);

      const owned = statementsOf(role).filter((s) => [s.Action].flat().includes('lambda:GetFunctionConfiguration'));
      expect(owned.map((s) => Object.keys(s.Condition as object))).toEqual([['StringEquals'], ['StringEquals', 'Null']]);
      expect(Object.keys((owned[0].Condition as { StringEquals: object }).StringEquals)).toEqual([
        'aws:ResourceTag/serverless-inbox:root-stack-id',
      ]);
      expect(Object.keys((owned[1].Condition as { StringEquals: object }).StringEquals)).toEqual([
        'aws:ResourceTag/serverless-inbox:root-stack',
      ]);
      expect((owned[1].Condition as { Null: object }).Null).toEqual({ 'aws:ResourceTag/serverless-inbox:root-stack-id': 'true' });
      expect(statementGranting(role, 'lambda:ListFunctions').Condition).toBeUndefined();
      expect(statementGranting(role, 'lambda:ListFunctions').Resource).toBe('*');
    });

    it('let only diag read the edge log group, by its exact ARN', () => {
      const { template }    = synthesize(['111111111111']);
      const edgeLogGroupArn = (role: SynthesizedRole) => JSON.stringify(statementsOf(role).map((s) => s.Resource));

      expect(edgeLogGroupArn(roleWithPolicy(template, DIAG_POLICY).role)).toContain(':log-group:/serverlessinbox/');
      expect(edgeLogGroupArn(roleWithPolicy(template, CONFIG_READ_POLICY).role)).not.toContain(':log-group:/serverlessinbox/');
    });

    it.each([DIAG_POLICY, CONFIG_READ_POLICY])('%s may read the stack and its nested stacks', (policyName) => {
      const { template } = synthesize(['111111111111']);
      const { role }     = roleWithPolicy(template, policyName);

      const statement = statementGranting(role, 'cloudformation:GetTemplate');

      expect(statement.Condition).toBeUndefined();
      expect(JSON.stringify(statement.Resource)).toContain(':stack/');
    });
  });

  describe('tier registry', () => {
    it('exposes a role ARN per tier', () => {
      const { infra } = synthesize(['111111111111']);

      expect(Object.keys(infra.tierArns)).toEqual(['support-diag', 'support-config-read']);
    });

    it('lists the tier tag keys in registry order and exposes each as a constant', () => {
      expect(getSupportTierTagKeys()).toEqual([DIAG_TAG_KEY, CONFIG_READ_TAG_KEY]);
      expect(SUPPORT_DIAG_TAG_KEY).toBe(DIAG_TAG_KEY);
      expect(SUPPORT_CONFIG_READ_TAG_KEY).toBe(CONFIG_READ_TAG_KEY);
    });

    it('maps each tier role ARN to its environment variable', () => {
      const environment = buildSupportTierEnvironment({
        'support-diag':        'arn:diag',
        'support-config-read': 'arn:config-read',
      });

      expect(environment).toEqual({
        SUPPORT_DIAG_ROLE_ARN:        'arn:diag',
        SUPPORT_CONFIG_READ_ROLE_ARN: 'arn:config-read',
      });
    });
  });
});
