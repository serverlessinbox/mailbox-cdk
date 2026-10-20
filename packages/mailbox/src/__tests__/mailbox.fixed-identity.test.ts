/// <reference types="jest" />

/**
 * Mailbox: resources whose CloudFormation logical ID must never change.
 *
 * These resources have names that are unique outside the stack (API custom domains, API mappings,
 * Route53 records, aliased CloudFront distributions, the data override SSM parameters, the SES receipt
 * rule set). When a logical ID changes, CloudFormation creates the replacement before deleting the
 * original, and the create fails on the name clash. Installed stacks build `Mailbox` directly under
 * their stack with construct id `mailbox`, so this suite synthesizes exactly that, with every feature
 * on that creates these resources.
 */

import { Template }                      from 'aws-cdk-lib/assertions';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { Permission }                    from '../auth/jmap-scopes';
import type { IMailboxAuthProvider }     from '../auth/types';
import { Mailbox }                       from '../mailbox';

import { CloudFormationResource }        from './iam-test-helpers';

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

const UNIQUE_NAME_TYPES = [
  'AWS::ApiGatewayV2::DomainName',
  'AWS::ApiGatewayV2::ApiMapping',
  'AWS::Route53::RecordSet',
  'AWS::CloudFront::Distribution',
  'AWS::SES::ReceiptRuleSet',
];

const DATA_OVERRIDE_PARAMETER_NAME = '/data-override/';

/**
 * The logical IDs of the resources with a name that is unique outside the stack. Changing any of them
 * breaks updates of installed stacks unless the resource is pinned to its old ID.
 */
const EXPECTED_LOGICAL_IDS: string[] = [
  'Mailboxadminapidomain8793AE5D',
  'Mailboxjmapapidomain47B62A36',
  'MailboxwebsocketpushdomainCACDAF3B',
  'mailboxapisadminapimappingD85B4126',
  'mailboxapisjmapapimapping5B437303',
  'mailboxapismcpapidomain18974F64',
  'mailboxapismcpapimapping54EAF96C',
  'mailboxapiswebsocketpushmapping6ED6E20A',
  'mailboxdatadatadeployeroverrideresolverauditlogtableoverrideF4602B03',
  'mailboxdatadatadeployeroverrideresolverchangelogtableoverrideC4AB00B4',
  'mailboxdatadatadeployeroverrideresolverconfigtableoverride8B244E4B',
  'mailboxdatadatadeployeroverrideresolveritemtableoverrideBA1F1473',
  'mailboxdatadatadeployeroverrideresolvermailfeedbacktableoverrideD4990A02',
  'mailboxedgeblobcdnblobdistribution8EDBE4E4',
  'mailboxedgednsadmincnameD0EED4EA',
  'mailboxedgednsapicname8CC46562',
  'mailboxedgednscdncname21C80676',
  'mailboxedgednsjmapcname95DF0DEC',
  'mailboxedgednsjmapsrvF9375BBD',
  'mailboxedgednsmcpcnameA29EFA62',
  'mailboxedgednswebmailcname365CF89E',
  'mailboxedgednswscname315B739A',
  'mailboxemailsesrulesemailrulesetF0C73F44',
  'mailboxuiadminuidistribution9EDF9DAA',
  'mailboxuiwebmailuidistribution82B7033A',
];

function createMockAuthProvider(): IMailboxAuthProvider {
  return {
    issuer: 'https://example.com/issuer',
    tokenEndpoint: 'https://example.com/token',
    authorizationEndpoint: 'https://example.com/authorize',
    authMethod: 'header',
    usePkce: false,
    scopeMap: {
      'mail.read': [Permission.MAIL_READ],
      'mail.write': [Permission.MAIL_WRITE],
    },
    policies: {
      adminApi: { audiences: ['admin-api'] },
      jmapApi: { audiences: ['jmap-api'] },
    },
    provisionAdminApiClient: () => ({ clientId: 'test-admin-ui', requestScopeList: [], groups: [] }),
    provisionJmapApiClient: () => ({ clientId: 'test-jmap-ui', requestScopeList: [], groups: [] }),
    createAdminApiAddons: () => [],
  };
}

function isUniquelyNamed(resource: CloudFormationResource): boolean {
  if (UNIQUE_NAME_TYPES.includes(resource.Type)) {
    return true;
  }
  return resource.Type === 'AWS::SSM::Parameter' && JSON.stringify(resource.Properties?.Name).includes(DATA_OVERRIDE_PARAMETER_NAME);
}

function uniquelyNamedLogicalIds(): string[] {
  const app   = new App({ context: { 'serverlessinbox:artifacts': ARTIFACT_CONTEXT } });
  const stack = new cdk.Stack(app, 'TestFixedIdentity', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  new Mailbox(stack, 'mailbox', {
    authProvider: createMockAuthProvider(),
    hostedZoneId: 'Z1234567890ABC',
    enableMcp: true,
    enableReceiving: 'on',
  });

  const stacks = [stack, ...stack.node.findAll().filter((node): node is cdk.NestedStack => node instanceof cdk.NestedStack)];
  return stacks.flatMap((candidate) => {
    const resources = (Template.fromStack(candidate).toJSON() as { Resources: Record<string, CloudFormationResource> }).Resources;
    return Object.entries(resources)
      .filter(([, resource]) => isUniquelyNamed(resource))
      .map(([logicalId]) => logicalId);
  });
}

describe('Mailbox directly under its stack', () => {
  it('keeps the logical ID of every resource with a name that is unique outside the stack', () => {
    expect(uniquelyNamedLogicalIds().sort()).toEqual(EXPECTED_LOGICAL_IDS);
  });
});
