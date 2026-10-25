/// <reference types="jest" />

/**
 * Pins what the data deployer hands CloudFormation and its worker. The custom resource's properties are
 * what the stack-deployer Lambda reads to create the data stack: a wrong key or value deploys the
 * wrong stack, leaves its resources untagged for the root stack's tag-scoped grants, or lets a delete
 * remove the tables. It also pins how the deployer's outputs reach the data stack ref: the override
 * resolver is fed the data stack's table ARNs, and the table and blob store handles consumers receive
 * resolve to the resolver's answers and the data stack's blob store output. A handle wired to the
 * wrong output grants the mailbox access to the wrong resource.
 */

import { renderWithTokens, resourcesOf, statementsForAction } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Match, Template }                                    from 'aws-cdk-lib/assertions';
import * as iam                                               from 'aws-cdk-lib/aws-iam';

import {
  TEST_ACCOUNT,
  TEST_REGION,
  newDeployerTestStack,
} from '../../../../__tests__/deployer-test-helpers';
import type { TableRole }                from '../../../../runtime/data-override-resolver/resource-properties-contract';
import { MailboxDataDeployer }           from '../mailbox-data-deployer';
import type { MailboxDataDeployerProps } from '../mailbox-data-deployer';

const DEPLOYER_RESOURCE_TYPE            = 'Custom::MailboxDataDeployer';
const RESOLVER_RESOURCE_TYPE            = 'Custom::MailboxDataOverrideResolver';
const DATA_STACK_NAME                   = 'given-data';
const STACK_NAME_REF                    = { Ref: 'AWS::StackName' };
const STACK_GUID                        = { 'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }] };
const TABLE_ROLES: readonly TableRole[] = ['configTable', 'itemTable', 'changelogTable', 'auditLogTable', 'mailFeedbackTable'];

interface SynthesizedDeployer {
  readonly template:          Template;
  readonly templateUrl:       unknown;
  readonly templateObjectArn: unknown;
}

function synthDeployer(
  props: Partial<MailboxDataDeployerProps> = {},
  grant?: (deployer: MailboxDataDeployer, grantee: iam.IGrantable) => void,
): SynthesizedDeployer {
  const { stack, artifactResolver } = newDeployerTestStack();
  const deployer                    = new MailboxDataDeployer(stack, 'data-deployer', {
    artifactResolver,
    dataStackName: DATA_STACK_NAME,
    nameBase:      'test-name-base',
    deployerType:  'cdk',
    ...props,
  });
  if (grant) {
    grant(deployer, new iam.Role(stack, 'grantee', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') }));
  }
  return {
    template:          Template.fromStack(stack),
    templateUrl:       stack.resolve(artifactResolver.getUrl('mailbox-cdk', 'data-stack-template.json')),
    templateObjectArn: stack.resolve(artifactResolver.getArn('mailbox-cdk', 'data-stack-template.json')),
  };
}

function logicalIdOf(template: Template, resourceType: string): string {
  return Object.keys(template.findResources(resourceType))[0];
}

describe('MailboxDataDeployer', () => {
  describe('custom resource', () => {
    it('deploys the data stack template, preserved on delete, with its name base and deployer type', () => {
      const { template, templateUrl } = synthDeployer({ deployerType: 'marketplace' });

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        templateUrl,
        preserveOnDelete: true,
        parameters:       {
          nameBase:     'test-name-base',
          rootStack:    STACK_NAME_REF,
          deployerType: 'marketplace',
        },
      });
    });

    it('names the stack as given', () => {
      const { template } = synthDeployer({ dataStackName: 'other-data' });

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, { stackName: 'other-data' });
    });

    it('passes the deploying stack’s guid as the root stack id parameter and sub-stack tag', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        parameters: Match.objectLike({ rootStackId: STACK_GUID }),
        tags:       Match.objectLike({ 'serverless-inbox:root-stack-id': STACK_GUID }),
      });
    });

    it('tags the stack with the root stack, and its own name', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        tags: {
          'serverless-inbox:product':    'mailbox',
          'serverless-inbox:root-stack': STACK_NAME_REF,
          'serverless-inbox:stack':      DATA_STACK_NAME,
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
        `arn:<token>:cloudformation:${TEST_REGION}:${TEST_ACCOUNT}:stack/${DATA_STACK_NAME}/*`,
      );
    });

    it('reads the data stack template it deploys', () => {
      const { template, templateObjectArn } = synthDeployer();

      const statements = statementsForAction(template, 's3:GetObject');
      expect(statements).toHaveLength(1);
      expect(statements[0].Resource).toEqual(templateObjectArn);
    });
  });

  it('resolves table overrides only after the data stack is deployed', () => {
    const { template } = synthDeployer();

    const deployer = logicalIdOf(template, DEPLOYER_RESOURCE_TYPE);
    template.hasResource(RESOLVER_RESOURCE_TYPE, {
      DependsOn: Match.arrayWith([deployer]),
    });
  });

  describe('data stack ref', () => {
    it.each(TABLE_ROLES)('hands the override resolver the data stack output for the %s as its incoming ARN', (role) => {
      const { template } = synthDeployer();

      template.hasResourceProperties(RESOLVER_RESOURCE_TYPE, {
        [`${role}IncomingArn`]: { 'Fn::GetAtt': [logicalIdOf(template, DEPLOYER_RESOURCE_TYPE), `${role}Arn`] },
      });
    });

    it.each(TABLE_ROLES)('points the %s handle at the ARN the override resolver answers with', (role) => {
      const { template } = synthDeployer({},(deployer, grantee) => deployer[role].grantRead(grantee));

      const [statement] = statementsForAction(template, 'dynamodb:GetItem');
      expect(resourcesOf(statement)[0]).toEqual({ 'Fn::GetAtt': [logicalIdOf(template, RESOLVER_RESOURCE_TYPE), `${role}Arn`] });
    });

    it('points the blob store handle at the data stack output for the blob store', () => {
      const { template } = synthDeployer({},(deployer, grantee) => deployer.blobStore.grantUploadBlobReadWriteDelete(grantee));

      const [statement] = statementsForAction(template, 's3:PutObject');
      expect(statement.Resource).toEqual({
        'Fn::Join': ['', [{ 'Fn::GetAtt': [logicalIdOf(template, DEPLOYER_RESOURCE_TYPE), 'blobStoreArn'] }, '/uploads/*']],
      });
    });
  });
});
