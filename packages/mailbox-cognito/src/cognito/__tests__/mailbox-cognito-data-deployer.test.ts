/// <reference types="jest" />

/**
 * Pins what the cognito data deployer hands CloudFormation and its worker. The custom resource's
 * properties are what the stack-deployer Lambda reads to create the cognito stack: `preserveOnDelete`
 * is what keeps the user pool, and with it every user, when the resource is removed, and the parameter
 * defaults decide the pool's MFA and password policy on every install that does not set them.
 */

import { Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { renderWithTokens, statementsForAction } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { MailboxCognitoDataDeployer } from '../mailbox-cognito-data-deployer';
import type { MailboxCognitoDataDeployerProps } from '../mailbox-cognito-data-deployer';
import { TEST_ARTIFACT_VERSION, newDeployerTestStack } from './cognito-deployer-helpers';

const DEPLOYER_RESOURCE_TYPE = 'Custom::MailboxCognitoDataDeployer';
const STACK_NAME_REF = { Ref: 'AWS::StackName' };
const COGNITO_STACK_NAME = { 'Fn::Join': ['', [STACK_NAME_REF, '-cognito']] };
const DEPLOYER_RESOURCE_ID = expect.stringMatching(/^deployerresource/);

interface SynthesizedDeployer {
  readonly stack: Stack;
  readonly artifactResolver: IArtifactResolver;
  readonly deployer: MailboxCognitoDataDeployer;
  readonly template: Template;
}

function synthDeployer(props: Partial<MailboxCognitoDataDeployerProps> = {}): SynthesizedDeployer {
  const { stack, artifactResolver } = newDeployerTestStack();
  const deployer = new MailboxCognitoDataDeployer(stack, 'deployer', {
    artifactResolver,
    cognitoDomainPrefix: 'test-prefix',
    deployerType: 'cdk',
    ...props,
  });
  return { stack, artifactResolver, deployer, template: Template.fromStack(stack) };
}

describe('MailboxCognitoDataDeployer', () => {
  describe('custom resource', () => {
    it('deploys the cognito data stack template into the deploying stack’s region, preserved on delete', () => {
      const { stack, artifactResolver, template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        stackName: COGNITO_STACK_NAME,
        templateUrl: stack.resolve(artifactResolver.getUrl('mailbox-cognito', 'cognito-data-stack-template.json')),
        region: { Ref: 'AWS::Region' },
        preserveOnDelete: true,
      });
    });

    it('tags the stack with the root stack, its own name and the product version', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        tags: {
          'serverless-inbox:product': 'mailbox',
          'serverless-inbox:root-stack': STACK_NAME_REF,
          'serverless-inbox:stack': COGNITO_STACK_NAME,
          'serverless-inbox:version': TEST_ARTIFACT_VERSION,
        },
      });
    });

    it('passes optional MFA mode and a password length of 8 unless set', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        parameters: {
          cognitoDomainPrefix: 'test-prefix',
          mfaMode: 'OPTIONAL',
          passwordMinLength: '8',
          rootStack: STACK_NAME_REF,
          productVersion: TEST_ARTIFACT_VERSION,
          deployerType: 'cdk',
        },
      });
    });

    it('passes the MFA mode and password length as set, the length as a string', () => {
      const { template } = synthDeployer({ mfaMode: 'ON', passwordMinLength: 12 });

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
          customDomainName: 'auth.example.com',
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

    it('reads the cognito data stack template it deploys', () => {
      const { stack, artifactResolver, template } = synthDeployer();

      const statements = statementsForAction(template, 's3:GetObject');
      expect(statements).toHaveLength(1);
      expect(statements[0].Resource).toEqual(
        stack.resolve(artifactResolver.getArn('mailbox-cognito', 'cognito-data-stack-template.json')),
      );
    });
  });

  it('exposes the user pool, its ARN and the OAuth domain from the stack outputs', () => {
    const { stack, deployer } = synthDeployer();

    expect(stack.resolve(deployer.dataStackRef.userPoolId)).toEqual({ 'Fn::GetAtt': [DEPLOYER_RESOURCE_ID, 'userPoolId'] });
    expect(stack.resolve(deployer.dataStackRef.userPoolArn)).toEqual({ 'Fn::GetAtt': [DEPLOYER_RESOURCE_ID, 'userPoolArn'] });
    expect(stack.resolve(deployer.dataStackRef.oauthDomain)).toEqual({ 'Fn::GetAtt': [DEPLOYER_RESOURCE_ID, 'oauthDomain'] });
  });
});
