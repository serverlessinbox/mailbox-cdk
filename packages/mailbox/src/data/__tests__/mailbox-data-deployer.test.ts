/// <reference types="jest" />

/**
 * Pins what the data deployer hands CloudFormation and its worker. The custom resource's properties are
 * what the stack-deployer Lambda reads to create the data stack: a wrong key or value deploys the
 * wrong stack, leaves its resources untagged for the root stack's tag-scoped grants, or lets a delete
 * remove the tables.
 */

import { Match, Template } from 'aws-cdk-lib/assertions';
import { MailboxDataDeployer } from '../mailbox-data-deployer';
import type { MailboxDataDeployerProps } from '../mailbox-data-deployer';
import {
  TEST_ACCOUNT,
  TEST_ARTIFACT_VERSION,
  TEST_REGION,
  newDeployerTestStack,
  renderWithTokens,
  statementsForAction,
} from '../../__tests__/deployer-test-helpers';

const DEPLOYER_RESOURCE_TYPE = 'Custom::MailboxDataDeployer';
const STACK_NAME_REF = { Ref: 'AWS::StackName' };

interface SynthesizedDeployer {
  readonly template: Template;
  readonly templateUrl: string;
  readonly templateObjectArn: string;
}

function synthDeployer(props: Partial<MailboxDataDeployerProps> = {}): SynthesizedDeployer {
  const { stack, artifactResolver } = newDeployerTestStack();
  new MailboxDataDeployer(stack, 'data-deployer', {
    artifactResolver,
    nameBase: 'test-name-base',
    deployerType: 'cdk',
    ...props,
  });
  return {
    template: Template.fromStack(stack),
    templateUrl: stack.resolve(artifactResolver.getUrl('mailbox-cdk', 'data-stack-template.json')),
    templateObjectArn: stack.resolve(artifactResolver.getArn('mailbox-cdk', 'data-stack-template.json')),
  };
}

describe('MailboxDataDeployer', () => {
  describe('custom resource', () => {
    it('deploys the data stack template, preserved on delete, with its name base and deployer type', () => {
      const { template, templateUrl } = synthDeployer({ deployerType: 'marketplace' });

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        templateUrl,
        preserveOnDelete: true,
        parameters: {
          nameBase: 'test-name-base',
          rootStack: STACK_NAME_REF,
          productVersion: TEST_ARTIFACT_VERSION,
          deployerType: 'marketplace',
        },
      });
    });

    it('names the stack after the deploying stack unless a name is given', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        stackName: { 'Fn::Join': ['', [STACK_NAME_REF, '-data']] },
      });
    });

    it('names the stack as given', () => {
      const { template } = synthDeployer({ dataStackName: 'given-data' });

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, { stackName: 'given-data' });
    });

    it('tags the stack with the root stack, its own name and the product version', () => {
      const { template } = synthDeployer({ dataStackName: 'given-data' });

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        tags: {
          'serverless-inbox:product': 'mailbox',
          'serverless-inbox:root-stack': STACK_NAME_REF,
          'serverless-inbox:stack': 'given-data',
          'serverless-inbox:version': TEST_ARTIFACT_VERSION,
        },
      });
    });
  });

  describe('worker', () => {
    it('manages the data stack under the name the custom resource deploys', () => {
      const { template } = synthDeployer();

      const statements = statementsForAction(template, 'cloudformation:CreateStack');
      expect(statements).toHaveLength(1);
      expect(renderWithTokens(statements[0].Resource)).toBe(
        `arn:<token>:cloudformation:${TEST_REGION}:${TEST_ACCOUNT}:stack/<token>-data/*`,
      );
    });

    it('manages the stack of a given name', () => {
      const { template } = synthDeployer({ dataStackName: 'given-data' });

      const statements = statementsForAction(template, 'cloudformation:CreateStack');
      expect(renderWithTokens(statements[0].Resource)).toBe(
        `arn:<token>:cloudformation:${TEST_REGION}:${TEST_ACCOUNT}:stack/given-data/*`,
      );
    });

    it('reads the data stack template it deploys', () => {
      const { template, templateObjectArn } = synthDeployer();

      const statements = statementsForAction(template, 's3:GetObject');
      expect(statements).toHaveLength(1);
      expect(statements[0].Resource).toEqual(templateObjectArn);
    });

    it('creates only tables named from the name base', () => {
      const { template } = synthDeployer();

      const statements = statementsForAction(template, 'dynamodb:CreateTable');
      expect(renderWithTokens(statements[0].Resource)).toMatch(/-test-name-base-\*$/);
    });
  });

  it('resolves table overrides only after the data stack is deployed', () => {
    const { template } = synthDeployer();

    const deployer = Object.keys(template.findResources(DEPLOYER_RESOURCE_TYPE))[0];
    template.hasResource('Custom::MailboxDataOverrideResolver', {
      DependsOn: Match.arrayWith([deployer]),
    });
  });
});
