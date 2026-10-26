/**
 * Synthesis of MailboxCognitoDataStack. The stack takes all of its configuration as CloudFormation parameters and
 * publishes the retained identity resources, so each assertion reads the synthesized template: the parameter
 * contract the deployer fills in, the conditional domain, the retained user pool and its MFA lookup, the JMAP
 * scopes, the default groups and the outputs. The tags and descriptions the stack applies through shared aspects
 * are pinned by those aspects; here only the values the stack passes to them are.
 */

import { DEVELOPMENT_CONTEXT_KEY }                     from '@serverlessinbox/mailbox-cdk-shared';
import { Permission }                                  from '@serverlessinbox/mailbox';
import { JMAP_SCOPE_DESCRIPTIONS }                     from '@serverlessinbox/mailbox';
import { Match, Template }                             from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, CfnParameter } from 'aws-cdk-lib';

import { CognitoScope }                                from '../../user-pool/cognito-scopemap';
import { MfaMode }                                     from '../../user-pool/mfa-mode';
import {
  ADMIN_GROUP_NAME,
  DEFAULT_PASSWORD_MIN_LENGTH,
  RESOURCE_SERVER_IDENTIFIER,
  USER_GROUP_NAME,
}                                        from '../mailbox-cognito-data-stack-contract';
import { MailboxCognitoDataStack }       from '../mailbox-cognito-data-stack';

function newDataStack(options: { development?: boolean; terminationProtection?: boolean } = {}): MailboxCognitoDataStack {
  const app = new App();
  if (options.development !== undefined) {
    app.node.setContext(DEVELOPMENT_CONTEXT_KEY, options.development);
  }
  return new MailboxCognitoDataStack(app, 'TestMailboxCognitoData', {
    env:                   { account: '123456789012', region: 'us-west-2' },
    synthesizer:           new BootstraplessSynthesizer(),
    terminationProtection: options.terminationProtection,
  });
}

function synthesizeDataStack(): Template {
  return Template.fromStack(newDataStack());
}

const HAS_CUSTOM_DOMAIN = 'HasCustomDomain';

describe('MailboxCognitoDataStack termination protection', () => {
  it.each([
    { description: 'is on by default', options: {}, expected: true },
    { description: 'follows the prop outside development mode', options: { terminationProtection: false }, expected: false },
    { description: 'is off in development mode, whatever the prop says', options: { development: true, terminationProtection: true }, expected: false },
  ])('$description', ({ options, expected }) => {
    expect(newDataStack(options).terminationProtection).toBe(expected);
  });
});

describe('MailboxCognitoDataStack parameters', () => {
  it('bounds the password length to the range Cognito accepts, with the default the deployer assumes', () => {
    synthesizeDataStack().hasParameter('passwordMinLength', {
      Type:     'Number',
      MinValue: 6,
      MaxValue: 99,
      Default:  DEFAULT_PASSWORD_MIN_LENGTH,
    });
  });

  it('feeds the password length parameter to the minimum length of the password policy', () => {
    synthesizeDataStack().hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: { Ref: 'passwordMinLength' } }) },
    });
  });

  it('allows the three deployer types, defaulting to cfn', () => {
    synthesizeDataStack().hasParameter('deployerType', { Type: 'String', AllowedValues: ['cdk', 'cfn', 'marketplace'], Default: 'cfn' });
  });

  it('declares a mandatory rootStackId parameter and tags the user pool with it', () => {
    const template   = synthesizeDataStack();
    const parameters = template.toJSON().Parameters as Record<string, { Type: string; Default?: string }>;

    expect(parameters.rootStackId.Type).toBe('String');
    expect(parameters.rootStackId.Default).toBeUndefined();
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolTags: { 'serverless-inbox:root-stack-id': { Ref: 'rootStackId' } },
    });
  });
});

describe('MailboxCognitoDataStack MFA mode mapping', () => {
  it('maps each lowercase mode to Cognito\'s spelling in one mapping', () => {
    const mappings = synthesizeDataStack().findMappings('*');

    const mappingIds = Object.keys(mappings);
    expect(mappingIds).toHaveLength(1);
    expect(mappings[mappingIds[0]]).toEqual({
      [MfaMode.OFF]:      { value: 'OFF' },
      [MfaMode.OPTIONAL]: { value: 'OPTIONAL' },
      [MfaMode.ON]:       { value: 'ON' },
    });
  });

  it('reads the user pool MfaConfiguration through the mapping, keyed by the mode parameter', () => {
    const template    = synthesizeDataStack();
    const [mappingId] = Object.keys(template.findMappings('*'));

    template.hasResourceProperties('AWS::Cognito::UserPool', {
      MfaConfiguration: { 'Fn::FindInMap': [mappingId, { Ref: 'mfaMode' }, 'value'] },
    });
  });

  it('declares the mode parameter with lowercase allowed values and the optional default', () => {
    synthesizeDataStack().hasParameter('mfaMode', {
      Type:          'String',
      AllowedValues: ['off', 'optional', 'on'],
      Default:       'optional',
    });
  });
});

describe('MailboxCognitoDataStack user pool', () => {
  it('turns on DeletionProtection for the retained user pool', () => {
    synthesizeDataStack().hasResource('AWS::Cognito::UserPool', {
      UpdateReplacePolicy: 'Retain',
      DeletionPolicy:      'RetainExceptOnCreate',
      Properties:          { DeletionProtection: 'ACTIVE' },
    });
  });

  it('names the pool after the account and the stack', () => {
    synthesizeDataStack().hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: { 'Fn::Sub': '${AWS::AccountId}-${AWS::StackName}-users' },
    });
  });
});

describe('MailboxCognitoDataStack domain', () => {
  it('has a custom domain exactly when the custom domain name parameter is not empty', () => {
    synthesizeDataStack().hasCondition(HAS_CUSTOM_DOMAIN, {
      'Fn::Not': [{ 'Fn::Equals': [{ Ref: 'customDomainName' }, ''] }],
    });
  });

  it('retains a domain that is the custom name when there is one and the Cognito prefix otherwise', () => {
    synthesizeDataStack().hasResource('AWS::Cognito::UserPoolDomain', {
      UpdateReplacePolicy: 'Retain',
      DeletionPolicy:      'RetainExceptOnCreate',
      Properties:          {
        Domain: { 'Fn::If': [HAS_CUSTOM_DOMAIN, { Ref: 'customDomainName' }, { Ref: 'cognitoDomainPrefix' }] },
      },
    });
  });

  it('passes the certificate ARN as CertificateArn when there is a custom domain and leaves the config out otherwise', () => {
    const stack         = newDataStack();
    const certParameter = stack.node.findChild('customDomainCertArn');
    if (!(certParameter instanceof CfnParameter)) {
      throw new Error('the stack declares no customDomainCertArn parameter');
    }

    Template.fromStack(stack).hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      CustomDomainConfig: {
        'Fn::If': [
          HAS_CUSTOM_DOMAIN,
          { CertificateArn: { Ref: stack.getLogicalId(certParameter) } },
          { Ref: 'AWS::NoValue' },
        ],
      },
    });
  });
});

describe('MailboxCognitoDataStack resource server and groups', () => {
  it('publishes one scope per Cognito scope, described by the permission it grants', () => {
    const template = synthesizeDataStack();

    template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
      Identifier: RESOURCE_SERVER_IDENTIFIER,
      Scopes:     Match.arrayEquals(
        Object.values(CognitoScope).map((scope) => Match.objectLike({ ScopeName: scope, ScopeDescription: Match.anyValue() })),
      ),
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
      Scopes: Match.arrayWith([{ ScopeName: CognitoScope.MAIL_READ, ScopeDescription: JMAP_SCOPE_DESCRIPTIONS[Permission.MAIL_READ] }]),
    });
  });

  it.each([ADMIN_GROUP_NAME, USER_GROUP_NAME])('creates the %s group', (groupName) => {
    synthesizeDataStack().hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: groupName });
  });
});

describe('MailboxCognitoDataStack outputs', () => {
  it('publishes the user pool id and ARN', () => {
    const template = synthesizeDataStack();
    const poolRef  = { Ref: Match.stringLikeRegexp('^userpool') };

    template.hasOutput('userPoolId', { Value: poolRef });
    template.hasOutput('userPoolArn', {
      Value: { 'Fn::Sub': ['arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/${PoolId}', { PoolId: poolRef }] },
    });
  });

  it('publishes the custom domain when there is one and the Cognito domain of the prefix otherwise', () => {
    synthesizeDataStack().hasOutput('oauthDomain', {
      Value: {
        'Fn::If': [
          HAS_CUSTOM_DOMAIN,
          { Ref: 'customDomainName' },
          { 'Fn::Sub': ['${Prefix}.auth.${AWS::Region}.amazoncognito.com', { Prefix: { Ref: 'cognitoDomainPrefix' } }] },
        ],
      },
    });
  });
});
