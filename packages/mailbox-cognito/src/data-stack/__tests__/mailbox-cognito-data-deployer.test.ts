/// <reference types="jest" />

/**
 * Pins what the cognito data deployer hands CloudFormation and its worker. The custom resource's
 * properties are what the stack-deployer Lambda reads to create the cognito stack: `preserveOnDelete`
 * is what keeps the user pool, and with it every user, when the resource is removed, and the parameter
 * defaults decide the pool's MFA and password policy on every install that does not set them.
 */

import type { IArtifactResolver }                      from '@serverlessinbox/artifact-registry-cdk';
import { renderWithTokens, statementsForAction }       from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { RootStack }                              from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                             from 'aws-cdk-lib/assertions';
import { Stack }                                       from 'aws-cdk-lib';

import { MfaMode }                                     from '../../user-pool/mfa-mode';
import { MailboxCognitoDataDeployer }                  from '../mailbox-cognito-data-deployer';
import type { MailboxCognitoDataDeployerProps }        from '../mailbox-cognito-data-deployer';

import { newDeployerTestStack }                        from './cognito-deployer-helpers';

const DEPLOYER_RESOURCE_TYPE        = 'Custom::MailboxCognitoDataDeployer';
const STACK_NAME_REF                = { Ref: 'AWS::StackName' };
const ROOT_STACK: RootStack         = { name: 'given-root-stack', id: 'given-root-guid' };
const COGNITO_STACK_NAME            = { 'Fn::Join': ['', [STACK_NAME_REF, '-cognito']] };
const DEPLOYER_RESOURCE_ID: unknown = expect.stringMatching(/^deployerresource/);

interface SynthesizedDeployer {
  readonly stack:            Stack;
  readonly artifactResolver: IArtifactResolver;
  readonly deployer:         MailboxCognitoDataDeployer;
  readonly template:         Template;
}

function synthDeployer(props: Partial<MailboxCognitoDataDeployerProps> = {}): SynthesizedDeployer {
  const { stack, artifactResolver } = newDeployerTestStack();
  const deployer                    = new MailboxCognitoDataDeployer(stack, 'deployer', {
    artifactResolver,
    cognitoDomainPrefix: 'test-prefix',
    deployerType:        'cdk',
    rootStack:           ROOT_STACK,
    ...props,
  });
  return { stack, artifactResolver, deployer, template: Template.fromStack(stack) };
}

describe('MailboxCognitoDataDeployer', () => {
  describe('custom resource', () => {
    it('deploys the cognito data stack template into the deploying stack’s region, preserved on delete', () => {
      const { stack, artifactResolver, template } = synthDeployer();
      const templateUrl: unknown                  = stack.resolve(artifactResolver.getUrl('mailbox-cognito', 'cognito-data-stack-template.json'));

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        stackName:        COGNITO_STACK_NAME,
        templateUrl,
        region:           { Ref: 'AWS::Region' },
        preserveOnDelete: true,
      });
    });

    it('passes the given root stack id as the root stack id parameter and sub-stack tag', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        parameters: Match.objectLike({ rootStackId: ROOT_STACK.id }),
        tags:       Match.objectLike({ 'serverless-inbox:root-stack-id': ROOT_STACK.id }),
      });
    });

    it('tags the stack with the root stack, and its own name', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        tags: {
          'serverless-inbox:product':    'mailbox',
          'serverless-inbox:root-stack': ROOT_STACK.name,
          'serverless-inbox:stack':      COGNITO_STACK_NAME,
        },
      });
    });

    it('passes optional MFA mode and a password length of 8 unless set', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        parameters: {
          cognitoDomainPrefix: 'test-prefix',
          mfaMode:             'OPTIONAL',
          passwordMinLength:   '8',
          rootStack:           ROOT_STACK.name,
          deployerType:        'cdk',
        },
      });
    });

    it('passes the MFA mode and password length as set, the length as a string', () => {
      const { template } = synthDeployer({ mfaMode: MfaMode.ON, passwordMinLength: 12 });

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        parameters: Match.objectLike({ mfaMode: 'ON', passwordMinLength: '12' }),
      });
    });

    it('passes the custom domain and its certificate when one is set', () => {
      const { template } = synthDeployer({
        customDomain: { domainName: 'auth.example.com', certificateArn: 'arn:aws:acm:us-east-1:111122223333:certificate/abc' },
      });

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        parameters: Match.objectLike({
          customDomainName:    'auth.example.com',
          customDomainCertArn: 'arn:aws:acm:us-east-1:111122223333:certificate/abc',
        }),
      });
    });

    it('leaves the custom domain parameters out without a custom domain', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        parameters: Match.not(Match.objectLike({ customDomainName: Match.anyValue() })),
      });
    });
  });

  describe('worker', () => {
    it('manages the stack the custom resource deploys', () => {
      const { template } = synthDeployer();

      const statements = statementsForAction(template, 'cloudformation:CreateStack');
      expect(statements).toHaveLength(1);
      expect(renderWithTokens(statements[0].Resource)).toBe('arn:<token>:cloudformation:<token>:<token>:stack/<token>-cognito/*');
    });

    it('admits the pools of the given root stack in its tag-gated grants', () => {
      const { template } = synthDeployer();

      const [byId] = statementsForAction(template, 'cognito-idp:DeleteUserPool');
      expect(byId.Condition?.StringEquals).toEqual({ 'aws:ResourceTag/serverless-inbox:root-stack-id': ROOT_STACK.id });
    });

    it('reads the cognito data stack template it deploys', () => {
      const { stack, artifactResolver, template } = synthDeployer();

      const statements = statementsForAction(template, 's3:GetObject');
      expect(statements).toHaveLength(1);
      expect(statements[0].Resource).toEqual(
        stack.resolve(artifactResolver.getArn('mailbox-cognito', 'cognito-data-stack-template.json')),
      );
    });
  });

  it('exposes the user pool, located by its ARN, and the OAuth domain from the stack outputs', () => {
    const { stack, deployer } = synthDeployer();

    expect(stack.resolve(deployer.dataStackRef.userPool.userPoolArn)).toEqual({ 'Fn::GetAtt': [DEPLOYER_RESOURCE_ID, 'userPoolArn'] });
    expect(stack.resolve(deployer.dataStackRef.oauthDomain)).toEqual({ 'Fn::GetAtt': [DEPLOYER_RESOURCE_ID, 'oauthDomain'] });
  });
});
