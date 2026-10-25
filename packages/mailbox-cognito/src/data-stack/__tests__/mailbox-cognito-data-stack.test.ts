/**
 * Synthesis of the MFA mode in MailboxCognitoDataStack: the lowercase parameter is mapped to Cognito's
 * spelling through one CfnMapping, and the user pool reads that mapping. Each assertion reads the
 * synthesized template, so a break in the mapping or the lookup fails here.
 */

import { Template }                      from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { MfaMode }                       from '../../user-pool/mfa-mode';
import { MailboxCognitoDataStack }       from '../mailbox-cognito-data-stack';

function synthesizeDataStack(): Template {
  const app   = new App();
  const stack = new MailboxCognitoDataStack(app, 'TestMailboxCognitoMfa', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  return Template.fromStack(stack);
}

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

describe('MailboxCognitoDataStack user pool deletion protection', () => {
  it('turns on DeletionProtection for the retained user pool', () => {
    synthesizeDataStack().hasResource('AWS::Cognito::UserPool', {
      UpdateReplacePolicy: 'Retain',
      DeletionPolicy:      'RetainExceptOnCreate',
      Properties:          { DeletionProtection: 'ACTIVE' },
    });
  });
});
