/// <reference types="jest" />

/**
 * Mailbox: the personal access token table is reachable only by the roles its grants are given to.
 *
 * The walk runs over every IAM policy of the full stack, finds the statements that name the token table, and
 * maps each role to the Lambdas that run under it, by `SERVICE_NAME`. A grant that reaches another Lambda, a
 * `kms:` statement for the table, or an SES or submission-queue action on the user API or the job sweeper
 * fails here and in no other test, because each wrapper test sees only its own spies.
 */

import { Template }                                      from 'aws-cdk-lib/assertions';
import * as cdk                                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                 from 'aws-cdk-lib';

import { Mailbox }                                       from '../mailbox';
import { AutoUpdater }                                   from '../platform/update/auto-updater';

import { CloudFormationResource, isResourceOfType }      from './iam-test-helpers';
import { createMockAuthProvider, TEST_ARTIFACT_CONTEXT } from './mailbox-helpers';

const PAT_TABLE_MARKER        = 'patTableArn';
const SUBMISSION_QUEUE_MARKER = 'emailsubmissionsqueue';

/** The Lambdas (by SERVICE_NAME) that hold a grant on the token table; a name matches when it starts with an entry. */
const PAT_GRANTEE_SERVICES = ['authorizer-jmap-api', 'authorizer-user-api', 'authorizer-admin-api', 'jmap-api', 'user-api', 'admin-api', 'state-change-fanout', 'expiry-sweeper'];

interface PolicyStatement {
  readonly Action?:   string | string[];
  readonly Resource?: unknown;
}

interface RolePolicy {
  readonly roles:      string[];
  readonly statements: PolicyStatement[];
}

function actionsOf(statement: PolicyStatement): string[] {
  return [statement.Action ?? []].flat();
}

function serviceNamesByRole(resources: Record<string, CloudFormationResource>): Map<string, Set<string>> {
  const servicesByRole = new Map<string, Set<string>>();
  for (const resource of Object.values(resources)) {
    if (!isResourceOfType(resource, 'AWS::Lambda::Function')) {
      continue;
    }
    const role        = resource.Properties?.Role as { 'Fn::GetAtt'?: [string, string] } | undefined;
    const environment = resource.Properties?.Environment as { Variables?: Record<string, string> } | undefined;
    const serviceName = environment?.Variables?.SERVICE_NAME;
    if (!role?.['Fn::GetAtt'] || serviceName === undefined) {
      continue;
    }
    const services = servicesByRole.get(role['Fn::GetAtt'][0]) ?? new Set<string>();
    services.add(serviceName);
    servicesByRole.set(role['Fn::GetAtt'][0], services);
  }
  return servicesByRole;
}

function rolePolicies(resources: Record<string, CloudFormationResource>): RolePolicy[] {
  return Object.values(resources)
    .filter((resource) => isResourceOfType(resource, 'AWS::IAM::Policy'))
    .map((policy) => ({
      roles:      ((policy.Properties?.Roles ?? []) as { Ref?: string }[]).map((role) => role.Ref ?? ''),
      statements: (policy.Properties?.PolicyDocument as { Statement?: PolicyStatement[] } | undefined)?.Statement ?? [],
    }));
}

describe('Mailbox personal access token table access (full stack walk)', () => {
  let resourcesOfStack: Record<string, CloudFormationResource>;
  let servicesOnTable: Set<string>;
  let actionsOnTableByService: Map<string, Set<string>>;
  let tableStatements: PolicyStatement[];
  let servicesWithSes: Set<string>;
  let servicesWithSubmissionSend: Set<string>;

  beforeAll(() => {
    const app   = new App({ context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT } });
    const stack = new cdk.Stack(app, 'TestPatAccessWalk', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    new Mailbox(stack, 'mailbox', {
      authProvider:     createMockAuthProvider(),
      artifactResolver: new AutoUpdater(stack, 'auto-updater'),
    });

    const template             = Template.fromStack(stack).toJSON() as { Resources?: Record<string, CloudFormationResource> };
    const resources            = template.Resources ?? {};
    resourcesOfStack           = resources;
    const servicesByRole       = serviceNamesByRole(resources);
    servicesOnTable            = new Set<string>();
    actionsOnTableByService    = new Map<string, Set<string>>();
    servicesWithSes            = new Set<string>();
    servicesWithSubmissionSend = new Set<string>();
    tableStatements            = [];

    for (const { roles, statements } of rolePolicies(resources)) {
      const services = roles.flatMap((role) => [...(servicesByRole.get(role) ?? [])]);

      for (const statement of statements) {
        const resource = JSON.stringify(statement.Resource ?? '');

        if (resource.includes(PAT_TABLE_MARKER)) {
          tableStatements.push(statement);
          services.forEach((service) => servicesOnTable.add(service));
          for (const service of services) {
            const actions = actionsOnTableByService.get(service) ?? new Set<string>();
            actionsOf(statement).forEach((action) => actions.add(action));
            actionsOnTableByService.set(service, actions);
          }
        }
        if (actionsOf(statement).some((action) => action.startsWith('ses:'))) {
          services.forEach((service) => servicesWithSes.add(service));
        }
        if (actionsOf(statement).includes('sqs:SendMessage') && resource.toLowerCase().includes(SUBMISSION_QUEUE_MARKER)) {
          services.forEach((service) => servicesWithSubmissionSend.add(service));
        }
      }
    }
  });

  it('fronts the WebSocket API with an authorizer function that receives the token table', () => {
    const authorizer = Object.values(resourcesOfStack).find((resource) =>
      isResourceOfType(resource, 'AWS::ApiGatewayV2::Authorizer') && resource.Properties?.Name === 'websocket-authorizer');
    const functionId = /"Fn::GetAtt":\["([^"]+)","Arn"\]/.exec(JSON.stringify(authorizer?.Properties?.AuthorizerUri))?.[1] ?? '';
    const lambda     = resourcesOfStack[functionId];
    const variables  = (lambda?.Properties?.Environment as { Variables?: Record<string, string> } | undefined)?.Variables ?? {};

    expect(variables).toMatchObject({ SERVICE_NAME: 'authorizer-jmap-api', PRINCIPAL_LOOKUP: 'off' });
    expect(variables).toHaveProperty('PAT_TABLE_NAME');
  });

  it('names the token table only in statements of the authorizers, the JMAP API, the user API, the admin API, the state-change fan-out and the expiry sweeper', () => {
    expect(servicesOnTable.size).toBeGreaterThan(0);
    for (const service of servicesOnTable) {
      expect(PAT_GRANTEE_SERVICES.some((allowed) => service.startsWith(allowed))).toBe(true);
    }
  });

  it('gives the JMAP API handler only GetItem on the token table', () => {
    expect([...(actionsOnTableByService.get('jmap-api') ?? [])]).toEqual(['dynamodb:GetItem']);
  });

  it('gives the state-change fan-out only GetItem on the token table', () => {
    expect([...(actionsOnTableByService.get('state-change-fanout') ?? [])]).toEqual(['dynamodb:GetItem']);
  });

  it('reaches the token table from the user API and the expiry sweeper', () => {
    expect(servicesOnTable).toContain('user-api');
    expect(servicesOnTable).toContain('expiry-sweeper');
  });

  it('adds no kms statement for the token table', () => {
    const kmsActions = tableStatements.flatMap(actionsOf).filter((action) => action.startsWith('kms:'));

    expect(kmsActions).toEqual([]);
  });

  it('gives the user API and the expiry sweeper no SES action, while the admin API keeps its own', () => {
    expect(servicesWithSes).toContain('admin-api');
    expect(servicesWithSes).not.toContain('user-api');
    expect(servicesWithSes).not.toContain('expiry-sweeper');
  });

  it('gives the user API and the expiry sweeper no send on the submission queue, while the admin API keeps its own', () => {
    expect(servicesWithSubmissionSend).toContain('admin-api');
    expect(servicesWithSubmissionSend).not.toContain('user-api');
    expect(servicesWithSubmissionSend).not.toContain('expiry-sweeper');
  });
});
