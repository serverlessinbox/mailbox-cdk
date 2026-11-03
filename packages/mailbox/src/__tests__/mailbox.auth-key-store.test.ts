/// <reference types="jest" />

/**
 * Mailbox: the auth key store is reachable only by the roles its item types are granted to.
 *
 * Every statement that touches the auth key store carries one exact `dynamodb:LeadingKeys` value, and each value
 * is held only by the Lambdas that need that item type. The walk runs over every IAM policy of the full stack
 * (the policies that name the table) and maps each role to the Lambdas that run under it, by `SERVICE_NAME`. A
 * statement that drops its key condition, or a grant that moves an item type to another Lambda, fails here and in
 * no other test.
 */

import { Template }                                      from 'aws-cdk-lib/assertions';
import * as cdk                                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                 from 'aws-cdk-lib';

import { Mailbox }                                       from '../mailbox';
import { AutoUpdater }                                   from '../platform/update/auto-updater';

import { CloudFormationResource, isResourceOfType }      from './iam-test-helpers';
import { createMockAuthProvider, TEST_ARTIFACT_CONTEXT } from './mailbox-helpers';

const AUTH_KEY_STORE_TABLE_MARKER = 'auth-key-store';

/** The Lambdas (by SERVICE_NAME) each item type may be reached through; a name matches when it starts with its entry. */
const ALLOWED_SERVICES_BY_ITEM_TYPE: Record<string, string[]> = {
  'connection-key-private': ['mail-import-runner', 'auth-key-store-updater'],
  'connection-key-public':  ['user-api', 'auth-key-store-updater'],
  'jwks':                   ['authorizer', 'auth-key-store-updater'],
  'hmac':                   ['jmap-api', 'bootstrap', 'auth-key-store-updater', 'edge-function'],
};

/** The item types each role reaches, and the Lambdas that run under that role, for the full stack. */
interface AccessWalk {
  readonly servicesByItemType:      Map<string, Set<string>>;
  readonly unconditionedStatements: string[];
}

function tableLogicalIdOf(resources: Record<string, CloudFormationResource>, marker: string): string {
  const match = Object.entries(resources).find(([, resource]) =>
    isResourceOfType(resource, 'AWS::DynamoDB::Table') && JSON.stringify(resource.Properties?.TableName ?? '').includes(marker),
  );
  if (!match) {
    throw new Error(`No DynamoDB table whose name contains "${marker}"`);
  }
  return match[0];
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

function walkAuthKeyStore(template: Record<string, unknown>): AccessWalk {
  const resources                         = (template.Resources ?? {}) as Record<string, CloudFormationResource>;
  const tableId                           = tableLogicalIdOf(resources, AUTH_KEY_STORE_TABLE_MARKER);
  const servicesByRole                    = serviceNamesByRole(resources);
  const servicesByItemType                = new Map<string, Set<string>>();
  const unconditionedStatements: string[] = [];

  for (const [policyId, policy] of Object.entries(resources)) {
    if (!isResourceOfType(policy, 'AWS::IAM::Policy')) {
      continue;
    }
    const roles      = (policy.Properties?.Roles ?? []) as { Ref?: string }[];
    const statements = (policy.Properties?.PolicyDocument as { Statement?: Record<string, unknown>[] } | undefined)?.Statement ?? [];

    for (const statement of statements) {
      if (!JSON.stringify(statement.Resource ?? '').includes(tableId)) {
        continue;
      }
      const leadingKeys = (statement.Condition as Record<string, Record<string, string[]>> | undefined)?.['ForAllValues:StringEquals']?.['dynamodb:LeadingKeys'];
      if (!leadingKeys || leadingKeys.length !== 1) {
        unconditionedStatements.push(policyId);
        continue;
      }
      const services = servicesByItemType.get(leadingKeys[0]) ?? new Set<string>();
      for (const role of roles) {
        for (const service of servicesByRole.get(role.Ref ?? '') ?? []) {
          services.add(service);
        }
      }
      servicesByItemType.set(leadingKeys[0], services);
    }
  }

  return { servicesByItemType, unconditionedStatements };
}

function buildStack(stackId: string): cdk.Stack {
  const app = new App({ context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT } });
  return new cdk.Stack(app, stackId, {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('Mailbox auth key store access (full stack walk)', () => {
  let walk: AccessWalk;

  beforeAll(() => {
    const stack = buildStack('TestAuthKeyStoreWalk');
    new Mailbox(stack, 'mailbox', {
      authProvider:     createMockAuthProvider(),
      artifactResolver: new AutoUpdater(stack, 'auto-updater'),
    });

    walk = walkAuthKeyStore(Template.fromStack(stack).toJSON() as Record<string, unknown>);
  });

  it('gives every statement on the auth key store exactly one LeadingKeys value', () => {
    expect(walk.unconditionedStatements).toEqual([]);
  });

  it('uses only the four item types the auth key store defines', () => {
    expect([...walk.servicesByItemType.keys()].sort()).toEqual(Object.keys(ALLOWED_SERVICES_BY_ITEM_TYPE).sort());
  });

  it.each(Object.keys(ALLOWED_SERVICES_BY_ITEM_TYPE))('reaches the item type %s only through the Lambdas the plan lists', (itemType) => {
    const services = [...(walk.servicesByItemType.get(itemType) ?? [])];
    const allowed  = ALLOWED_SERVICES_BY_ITEM_TYPE[itemType];

    expect(services.length).toBeGreaterThan(0);
    for (const service of services) {
      expect(allowed.some((prefix) => service.startsWith(prefix))).toBe(true);
    }
  });

  it('gives the connection private key only to the mail-import runner and the key store updater', () => {
    expect([...(walk.servicesByItemType.get('connection-key-private') ?? [])].sort()).toEqual(['auth-key-store-updater', 'mail-import-runner']);
  });

  it('gives the connection public key only to the user API and the key store updater', () => {
    expect([...(walk.servicesByItemType.get('connection-key-public') ?? [])].sort()).toEqual(['auth-key-store-updater', 'user-api']);
  });
});
