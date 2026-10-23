/**
 * Pins the IAM roles `SupportRolesInfra` declares and the grants it hands to the Lambdas that work with
 * them: who may assume the hop role, how a tier role is reachable only through the hop role and a case
 * external ID, which actions each tier is granted and under what scoping, and what a Lambda may do to
 * the hop role. Weakening these assertions can let a support tier widen silently, trust the wrong AWS
 * account, let a tier role be assumed without a case, or let a Lambda tag keys outside the tier tags.
 */

import { Template }                             from 'aws-cdk-lib/assertions';
import * as iam                                 from 'aws-cdk-lib/aws-iam';
import type { Stack }                           from 'aws-cdk-lib';

import { newTestStack }                         from '../../__tests__/platform-helpers';
import { SupportRolesInfra }                    from '../support-roles-infra';

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

function build(vendorAccountIds: string[]): { stack: Stack; infra: SupportRolesInfra } {
  const stack = newTestStack('support-roles-stack', { account: '111122223333', region: 'us-east-1' });
  return { stack, infra: new SupportRolesInfra(stack, 'roles-infra', { vendorAccountIds }) };
}

function synthesize(vendorAccountIds: string[]): SynthesizedInfra {
  const { stack, infra } = build(vendorAccountIds);
  return { stack, template: Template.fromStack(stack), infra };
}

/** The parts of a synthesized `AWS::IAM::Policy` these assertions read. */
interface SynthesizedPolicy {
  readonly Properties: { readonly PolicyDocument: { readonly Statement: StatementJson[] } };
}

/** A token as the template renders it, as plain JSON. */
function templateValue(stack: Stack, value: string): unknown {
  return JSON.parse(JSON.stringify(stack.resolve(value))) as unknown;
}

/** The root principal of an account, as a template renders it: partition-aware, never a literal `arn:aws`. */
function accountRoot(accountId: string): unknown {
  return { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:iam::${accountId}:root`]] };
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
  const statement = statementsOf(role).find((candidate) => [candidate.Action].flat().includes(action));
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
        { Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: accountRoot('111111111111') } },
      ]);
      expect(role.Properties.MaxSessionDuration).toBe(3600);
    });

    it('trusts the root of every vendor account when there are several', () => {
      const { template } = synthesize(['111111111111', '222222222222']);

      const { role } = roleWithPolicy(template, HOP_POLICY);

      expect(role.Properties.AssumeRolePolicyDocument.Statement).toEqual([
        { Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: accountRoot('111111111111') } },
        { Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: accountRoot('222222222222') } },
      ]);
    });

    it('may only assume the tier roles', () => {
      const { stack, template, infra } = synthesize(['111111111111']);

      const { role } = roleWithPolicy(template, HOP_POLICY);

      expect(statementsOf(role)).toEqual([
        {
          Effect:   'Allow',
          Action:   'sts:AssumeRole',
          Resource: [stack.resolve(infra.diagRoleArn), stack.resolve(infra.configReadRoleArn)],
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
          Principal: { AWS: templateValue(stack, infra.hopRoleArn) },
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

      // Tripwire: a changed count means a tier gained or lost an action. Review it, do not just update the number.
      expect(diag.size).toBe(16);
      expect(configRead.size).toBe(42);
      expect(diag.has('logs:GetLogEvents')).toBe(true);
      expect(diag.has('lambda:GetFunctionConfiguration')).toBe(false);
      expect(configRead.has('lambda:GetFunctionConfiguration')).toBe(true);
      expect([...diag].filter((action) => !configRead.has(action))).toEqual([]);
    });

    it('scope resource-naming actions by the root-stack tags, by id and by name for a resource without an id tag, and leave enumeration actions unconditioned', () => {
      const { template } = synthesize(['111111111111']);
      const { role }     = roleWithPolicy(template, CONFIG_READ_POLICY);

      const owned = statementsOf(role).filter((statement) => [statement.Action].flat().includes('lambda:GetFunctionConfiguration'));
      expect(owned.map((statement) => Object.keys(statement.Condition as object))).toEqual([['StringEquals'], ['StringEquals', 'Null']]);
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
      const edgeLogGroupArn = (role: SynthesizedRole) => JSON.stringify(statementsOf(role).map((statement) => statement.Resource));

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

    it('build the edge log group and nested stack ARNs from partition and account intrinsics, never literals', () => {
      const { template } = synthesize(['111111111111']);
      const { role }     = roleWithPolicy(template, DIAG_POLICY);

      const edgeLogGroup = statementsOf(role).find((statement) => JSON.stringify(statement.Resource).includes(':log-group:'));
      const nestedStacks = statementGranting(role, 'cloudformation:GetTemplate');
      for (const statement of [edgeLogGroup, nestedStacks]) {
        const resource = JSON.stringify(statement?.Resource);
        expect(resource).toContain('"Ref":"AWS::Partition"');
        expect(resource).not.toContain('arn:aws:');
        expect(resource).not.toContain('111122223333');
      }
      expect(JSON.stringify(edgeLogGroup?.Resource)).toContain('"Ref":"AWS::AccountId"');
    });
  });

  describe('role handles', () => {
    it('expose the tier tag keys', () => {
      const { infra } = synthesize(['111111111111']);

      expect(infra.diagTagKey).toBe(DIAG_TAG_KEY);
      expect(infra.configReadTagKey).toBe(CONFIG_READ_TAG_KEY);
    });

    it('expose role ARNs built from partition and account intrinsics, never literals', () => {
      const { stack, infra } = synthesize(['111111111111']);

      for (const arn of [infra.hopRoleArn, infra.diagRoleArn, infra.configReadRoleArn]) {
        const rendered = JSON.stringify(stack.resolve(arn));
        expect(rendered).toContain('"Ref":"AWS::Partition"');
        expect(rendered).toContain('"Ref":"AWS::AccountId"');
        expect(rendered).not.toContain('111122223333');
      }
    });
  });

  describe('grants to a Lambda', () => {
    function grantTo(grant: (infra: SupportRolesInfra, grantee: iam.IGrantable) => void): { stack: Stack; infra: SupportRolesInfra; statements: StatementJson[] } {
      const { stack, infra } = build(['111111111111']);
      const grantee          = new iam.Role(stack, 'grantee', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

      grant(infra, grantee);

      // cast: CDK's findResources returns untyped template JSON; this is the one framework boundary.
      const policies   = Object.values(Template.fromStack(stack).findResources('AWS::IAM::Policy')) as SynthesizedPolicy[];
      const statements = policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement);
      return { stack, infra, statements };
    }

    it('grantTagWrites lets the grantee tag and untag only the hop role, with only the tier tag keys', () => {
      const { stack, infra, statements } = grantTo((roles, grantee) => roles.grantTagWrites(grantee));

      expect(statements).toEqual([
        {
          Effect:    'Allow',
          Action:    ['iam:TagRole', 'iam:UntagRole'],
          Resource:  templateValue(stack, infra.hopRoleArn),
          Condition: { 'ForAllValues:StringEquals': { 'aws:TagKeys': [DIAG_TAG_KEY, CONFIG_READ_TAG_KEY] } },
        },
      ]);
    });

    it('grantTagRead lets the grantee list the tags of the hop role only', () => {
      const { stack, infra, statements } = grantTo((roles, grantee) => roles.grantTagRead(grantee));

      expect(statements).toEqual([
        { Effect: 'Allow', Action: 'iam:ListRoleTags', Resource: templateValue(stack, infra.hopRoleArn) },
      ]);
    });

    it('grantAssumptionLookup lets the grantee look up CloudTrail events', () => {
      const { statements } = grantTo((roles, grantee) => roles.grantAssumptionLookup(grantee));

      expect(statements).toEqual([
        { Effect: 'Allow', Action: 'cloudtrail:LookupEvents', Resource: '*' },
      ]);
    });
  });
});
