/// <reference types="jest" />

/**
 * Pins what the edge deployer hands CloudFormation and its worker. The custom resource's parameters are
 * the edge stack's inputs: a wrong prefix form breaks every edge hostname, a missing hosted zone
 * silently drops the certificate, and a table grant on the Lambda@Edge role widens what the public
 * blob endpoint can read.
 */

import type { IArtifactResolver }                from '@serverlessinbox/artifact-registry-cdk';
import { renderWithTokens, statementsForAction } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Match, Template }                       from 'aws-cdk-lib/assertions';
import { Table }                                 from 'aws-cdk-lib/aws-dynamodb';
import * as route53                              from 'aws-cdk-lib/aws-route53';
import { Stack, Token }                          from 'aws-cdk-lib';
import { Construct }                             from 'constructs';
import * as t                                    from 'typanion';

import {
  TEST_ACCOUNT,
  newDeployerTestStack,
} from '../../../__tests__/deployer-test-helpers';
import { DataTable }                     from '../../../resources/tables/data-tables';
import { MailboxEdgeDeployer }           from '../mailbox-edge-deployer';
import type { MailboxEdgeDeployerProps } from '../mailbox-edge-deployer';

const DEPLOYER_RESOURCE_TYPE        = 'Custom::MailboxEdgeDeployer';
const STACK_NAME_REF                = { Ref: 'AWS::StackName' };
const STACK_GUID                    = { 'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }] };
const EDGE_STACK_NAME               = { 'Fn::Join': ['', [STACK_NAME_REF, Match.stringLikeRegexp('^-edge-[0-9a-f]{8}$')]] };
const DEPLOYER_RESOURCE_ID: unknown = expect.stringMatching(/^edgedeployeredgestack/);
const DEPLOYER_LOGICAL_ID: unknown  = expect.stringMatching(/^edgedeployeredgestack[0-9A-F]{8}$/);

/** The `stackName` property of the edge deployer resource: a `Fn::Join` of a separator and its parts. */
const isDeployerResource       = t.isPartial({
  Properties: t.isPartial({
    stackName: t.isRecord(t.isTuple([t.isString(), t.isArray(t.isOneOf([t.isString(), t.isRecord(t.isString())]))])),
  }),
});
const ITEM_TABLE_ARN           = 'arn:aws:dynamodb:us-west-2:111122223333:table/item';
const CONFIG_TABLE_ARN         = 'arn:aws:dynamodb:us-west-2:111122223333:table/config';
const AUTH_KEY_STORE_TABLE_ARN = 'arn:aws:dynamodb:us-west-2:111122223333:table/auth-keys';

interface SynthesizedDeployer {
  readonly stack:            Stack;
  readonly artifactResolver: IArtifactResolver;
  readonly deployer:         MailboxEdgeDeployer;
  readonly template:         Template;
}

function dataTable(stack: Stack, id: string, tableArn: string): DataTable {
  return new DataTable(Table.fromTableArn(stack, id, tableArn));
}

function synthDeployer(
  extraProps: (stack: Stack) => Partial<MailboxEdgeDeployerProps> = () => ({}),
  parentId?: string,
): SynthesizedDeployer {
  const { stack, artifactResolver } = newDeployerTestStack();
  const parent                      = parentId === undefined ? stack : new Construct(stack, parentId);
  const deployer                    = new MailboxEdgeDeployer(parent, 'edge-deployer', {
    artifactResolver,
    domainName:        'example.com',
    itemTable:         dataTable(stack, 'item-table', ITEM_TABLE_ARN),
    configTable:       dataTable(stack, 'config-table', CONFIG_TABLE_ARN),
    authKeyStoreTable: dataTable(stack, 'auth-key-store-table', AUTH_KEY_STORE_TABLE_ARN),
    productVersion:    '1.2.3',
    logGroupName:      'test-log-group',
    deployerType:      'cfn',
    ...extraProps(stack),
  });
  return { stack, artifactResolver, deployer, template: Template.fromStack(stack) };
}

function withHostedZone(stack: Stack): Partial<MailboxEdgeDeployerProps> {
  return {
    hostedZone: route53.HostedZone.fromHostedZoneAttributes(stack, 'zone', {
      hostedZoneId: 'Z0TESTZONE',
      zoneName:     'example.com',
    }),
  };
}

describe('MailboxEdgeDeployer', () => {
  describe('custom resource', () => {
    it('deploys the edge stack template to us-east-1 with termination protection off', () => {
      const { stack, artifactResolver, template } = synthDeployer();
      const templateUrl: unknown                  = stack.resolve(artifactResolver.getUrl('mailbox-cdk-edge', 'edge-stack-template.json'));

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        stackName:             EDGE_STACK_NAME,
        templateUrl,
        region:                'us-east-1',
        terminationProtection: false,
      });
    });

    it('is created as the deployer’s child "edge-stack"', () => {
      const { template } = synthDeployer();

      expect(Object.keys(template.findResources(DEPLOYER_RESOURCE_TYPE))).toEqual([DEPLOYER_LOGICAL_ID]);
    });

    it('names the stack after the position of the deployer, so a moved deployer deploys a new stack', () => {
      const stackNameOf = ({ template }: SynthesizedDeployer): string => {
        const [deployerResource]: unknown[] = Object.values(template.findResources(DEPLOYER_RESOURCE_TYPE));
        const errors: string[]              = [];
        if (!isDeployerResource(deployerResource, { errors })) {
          throw new Error(`The deployer resource has no stack name: ${errors.join('; ')}`);
        }
        return JSON.stringify(deployerResource.Properties.stackName);
      };

      const atTheRoot    = stackNameOf(synthDeployer());
      const underAParent = stackNameOf(synthDeployer(() => ({}), 'moved-here'));

      expect(underAParent).not.toEqual(atTheRoot);
    });

    it('tags the stack with the root stack, and its own name', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        tags: {
          'serverless-inbox:product':    'mailbox',
          'serverless-inbox:root-stack': STACK_NAME_REF,
          'serverless-inbox:stack':      EDGE_STACK_NAME,
        },
      });
    });

    it('passes the deploying stack’s guid as the root stack id parameter and sub-stack tag', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        parameters: Match.objectLike({ rootStackId: STACK_GUID }),
        tags:       Match.objectLike({ 'serverless-inbox:root-stack-id': STACK_GUID }),
      });
    });

    it('passes the domain, the JMAP blob download artifact, the tables, the log group and the tagging values as template parameters', () => {
      const { artifactResolver, template } = synthDeployer();
      const jmapBlobDownload               = artifactResolver.resolve('mailbox-cdk-edge', 'lambdas/jmap-blob-download.zip');

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        parameters: Match.objectLike({
          domainName:           'example.com',
          artifactBucket:       jmapBlobDownload.bucket,
          jmapBlobDownloadKey:  jmapBlobDownload.key,
          itemTableArn:         ITEM_TABLE_ARN,
          configTableArn:       CONFIG_TABLE_ARN,
          authKeyStoreTableArn: AUTH_KEY_STORE_TABLE_ARN,
          logGroupName:         'test-log-group',
          rootStack:            STACK_NAME_REF,
          productVersion:       '1.2.3',
          deployerType:         'cfn',
        }),
      });
    });

    it('passes the region the stack is deployed in as the root region parameter, not the region it was synthesized for', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
        parameters: Match.objectLike({ rootRegion: { Ref: 'AWS::Region' } }),
      });
    });

    describe('prefix parameter', () => {
      it.each([
        { name: 'no prefix', prefix: undefined, expected: '.' },
        { name: 'a bare label', prefix: 'mailbox', expected: '.mailbox.' },
        { name: 'an already dot-wrapped label', prefix: '.mailbox.', expected: '.mailbox.' },
        { name: 'a padded label with extra dots', prefix: '  ..mailbox..  ', expected: '.mailbox.' },
        { name: 'a blank prefix', prefix: '   ', expected: '.' },
      ])('wraps $name for the edge template', ({ prefix, expected }) => {
        const { template } = synthDeployer(() => ({ prefix }));

        template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
          parameters: Match.objectLike({ prefix: expected }),
        });
      });

      it('passes an unresolved token through untouched', () => {
        const { template } = synthDeployer(() => ({ prefix: Token.asString({ Ref: 'PrefixParameter' }) }));

        template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
          parameters: Match.objectLike({ prefix: { Ref: 'PrefixParameter' } }),
        });
      });
    });

    describe('hosted zone', () => {
      it('passes the zone to the edge stack', () => {
        const { template } = synthDeployer(withHostedZone);

        template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
          parameters: Match.objectLike({ hostedZoneId: 'Z0TESTZONE', hostedZoneName: 'example.com' }),
        });
      });

      it('exposes the certificate the edge stack creates', () => {
        const { stack, deployer } = synthDeployer(withHostedZone);

        expect(stack.resolve(deployer.edgeCertificate?.certificateArn)).toEqual({
          'Fn::GetAtt': [DEPLOYER_RESOURCE_ID, 'edgeCertificateArn'],
        });
      });

      it('lets the worker write the zone’s DNS records', () => {
        const { template } = synthDeployer(withHostedZone);

        const statements = statementsForAction(template, 'route53:ChangeResourceRecordSets');
        expect(statements).toHaveLength(1);
        expect(renderWithTokens(statements[0].Resource)).toBe('arn:<token>:route53:::hostedzone/Z0TESTZONE');
      });

      it('leaves the zone parameters and the certificate out without a zone', () => {
        const { deployer, template } = synthDeployer();

        template.hasResourceProperties(DEPLOYER_RESOURCE_TYPE, {
          parameters: Match.not(Match.objectLike({ hostedZoneId: Match.anyValue() })),
        });
        expect(deployer.edgeCertificate).toBeUndefined();
      });
    });
  });

  describe('worker', () => {
    it('manages edge stacks in us-east-1 under every name the custom resource has deployed, hashed or not', () => {
      const { template } = synthDeployer();

      const statements = statementsForAction(template, 'cloudformation:CreateStack');
      expect(statements).toHaveLength(1);
      expect(renderWithTokens(statements[0].Resource)).toBe(
        `arn:<token>:cloudformation:us-east-1:${TEST_ACCOUNT}:stack/<token>-edge*/*`,
      );
    });

    it('lets the starter read the same edge stacks', () => {
      const { template } = synthDeployer();

      const describing = statementsForAction(template, 'cloudformation:DescribeStacks')
        .map((statement) => renderWithTokens(statement.Resource));
      expect(describing).toContain(`arn:<token>:cloudformation:us-east-1:${TEST_ACCOUNT}:stack/<token>-edge*/*`);
    });

    it('reads the edge template and the JMAP blob download zip it deploys', () => {
      const { stack, artifactResolver, template } = synthDeployer();

      const statements = statementsForAction(template, 's3:GetObject');
      expect(statements.map((statement) => statement.Resource)).toEqual([
        stack.resolve(artifactResolver.getArn('mailbox-cdk-edge', 'edge-stack-template.json')),
        stack.resolve(artifactResolver.getArn('mailbox-cdk-edge', 'lambdas/jmap-blob-download.zip')),
      ]);
    });

    it('may pass only the JMAP blob download role', () => {
      const { stack, deployer, template } = synthDeployer();

      const statements = statementsForAction(template, 'iam:PassRole');
      expect(statements).toHaveLength(1);
      expect(statements[0].Resource).toEqual(stack.resolve(deployer.jmapBlobDownloadRole.roleArn));
    });
  });

  describe('JMAP blob download role', () => {
    it('is assumed by Lambda and Lambda@Edge, with the basic execution policy', () => {
      const { template } = synthDeployer();

      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' } },
            { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'edgelambda.amazonaws.com' } },
          ],
        },
        ManagedPolicyArns:        [
          { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole']] },
        ],
      });
    });

    it('can read the auth key store table and no other table', () => {
      const { template } = synthDeployer();

      const statements = statementsForAction(template, 'dynamodb:GetItem');
      expect(statements).toHaveLength(1);
      expect(JSON.stringify(statements[0].Resource)).toContain(AUTH_KEY_STORE_TABLE_ARN);
    });
  });

  describe('outputs', () => {
    it('reads a CloudFormation output from the custom resource', () => {
      const { stack, deployer } = synthDeployer();

      expect(stack.resolve(deployer.getOutput('someOutput'))).toEqual({
        'Fn::GetAtt': [DEPLOYER_RESOURCE_ID, 'someOutput'],
      });
    });

    it('takes the Lambda@Edge version from the edge stack output', () => {
      const { stack, deployer } = synthDeployer();

      expect(stack.resolve(deployer.jmapBlobDownloadVersion.functionArn)).toEqual({
        'Fn::GetAtt': [DEPLOYER_RESOURCE_ID, 'jmapBlobDownloadVersionArn'],
      });
    });
  });
});
