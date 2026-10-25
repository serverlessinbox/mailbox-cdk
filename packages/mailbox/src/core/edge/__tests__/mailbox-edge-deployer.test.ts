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
import { AuthKeyStoreTable, type IAuthKeyStoreTable } from '../../../resources/tables/auth-key-store-table';
import { DataTable }                                  from '../../../resources/tables/data-tables';
import { MailboxEdgeDeployer }                        from '../mailbox-edge-deployer';
import type { MailboxEdgeDeployerProps }              from '../mailbox-edge-deployer';

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
/** The replica log groups of the edge stack: `/aws/lambda/us-east-1.` then `<root stack>-edge-*`, in any region of this account. */
const REPLICA_LOG_GROUP_ARN = {
  'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':logs:*:', { Ref: 'AWS::AccountId' }, ':log-group:/aws/lambda/us-east-1.', STACK_NAME_REF, '-edge-*']],
};
const ROOT_STACK_NAME       = 'mystack';

/** A statement's `Resource` as rendered ARN strings, whether the statement lists one resource or several. */
function renderResources(resource: unknown): string[] {
  return (Array.isArray(resource) ? resource : [resource]).map(renderWithTokens);
}

const isJoin                  = t.isObject({ 'Fn::Join': t.isTuple([t.isString(), t.isArray(t.isOneOf([t.isString(), t.isRecord(t.isString())]))]) });
const isFunctionNameCondition = t.isObject({ StringLike: t.isObject({ 'lambda:FunctionName': isJoin }) });

function functionNameConditionOf(condition: unknown): string {
  t.assert(condition, isFunctionNameCondition);
  return renderWithTokens(condition.StringLike['lambda:FunctionName']);
}

/** IAM wildcard matching: `*` stands for any run of characters, everything else is literal. */
function matchesAnyPattern(patterns: string[], value: string): boolean {
  return patterns.some((pattern) => new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(value));
}

const ITEM_TABLE_ARN   = 'arn:aws:dynamodb:us-west-2:111122223333:table/item';
const CONFIG_TABLE_ARN = 'arn:aws:dynamodb:us-west-2:111122223333:table/config';

interface SynthesizedDeployer {
  readonly stack:            Stack;
  readonly artifactResolver: IArtifactResolver;
  readonly deployer:         MailboxEdgeDeployer;
  readonly template:         Template;
}

function dataTable(stack: Stack, id: string, tableArn: string): DataTable {
  return new DataTable(Table.fromTableArn(stack, id, tableArn));
}

function authKeyStoreTable(stack: Stack, id: string): IAuthKeyStoreTable {
  return new AuthKeyStoreTable(stack, id);
}

/** The logical id of the auth key store table, the only DynamoDB table this stack creates. */
function authKeyStoreTableId(template: Template): string {
  return Object.keys(template.findResources('AWS::DynamoDB::Table'))[0];
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
    authKeyStoreTable: authKeyStoreTable(stack, 'auth-key-store-table'),
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
          authKeyStoreTableArn: { 'Fn::GetAtt': [authKeyStoreTableId(template), 'Arn'] },
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
    it('manages edge stacks in us-east-1 under the hashed name only', () => {
      const { template } = synthDeployer();

      const statements = statementsForAction(template, 'cloudformation:CreateStack');
      expect(statements).toHaveLength(1);
      expect(renderResources(statements[0].Resource)).toEqual([
        `arn:<token>:cloudformation:us-east-1:${TEST_ACCOUNT}:stack/<token>-edge-*/*`,
      ]);
    });

    const hashedSuffix                                                                    = 'edge-0a1b2c3d';
    const scopedByName: Array<[string, (template: Template) => string[], string, string]> = [
      [
        'the stack',
        (template) => renderResources(statementsForAction(template, 'cloudformation:CreateStack')[0].Resource).map((arn) => arn.split('stack/')[1]),
        `${ROOT_STACK_NAME}-${hashedSuffix}/0a1b-uuid`,
        `${ROOT_STACK_NAME}-edgefoo-${hashedSuffix}/0a1b-uuid`,
      ],
      [
        'the Lambda function ARN',
        (template) => renderResources(statementsForAction(template, 'lambda:CreateFunction')[0].Resource).map((arn) => arn.split('function:')[1]),
        `${ROOT_STACK_NAME}-${hashedSuffix}-JmapBlobDownload0A1B-xyz`,
        `${ROOT_STACK_NAME}-edgefoo-JmapBlobDownload0A1B-xyz`,
      ],
      [
        'the Lambda function-name condition',
        (template) => [functionNameConditionOf(statementsForAction(template, 'lambda:CreateFunction')[1].Condition)],
        `${ROOT_STACK_NAME}-${hashedSuffix}-JmapBlobDownload0A1B-xyz`,
        `${ROOT_STACK_NAME}-edgefoo-JmapBlobDownload0A1B-xyz`,
      ],
      [
        'the replica log group',
        (template) => renderResources(statementsForAction(template, 'logs:CreateLogGroup')[0].Resource).map((arn) => arn.split('log-group:')[1]),
        `/aws/lambda/us-east-1.${ROOT_STACK_NAME}-${hashedSuffix}-JmapBlobDownload0A1B-xyz`,
        `/aws/lambda/us-east-1.${ROOT_STACK_NAME}-edgefoo-JmapBlobDownload0A1B-xyz`,
      ],
      [
        'the resource group',
        (template) => renderResources(statementsForAction(template, 'resource-groups:DeleteGroup')[0].Resource).map((arn) => arn.split('group/')[1]),
        `${ROOT_STACK_NAME}-${hashedSuffix}-serverless-inbox`,
        `${ROOT_STACK_NAME}-edgefoo-serverless-inbox`,
      ],
    ];

    it.each(scopedByName)('scopes %s to a hashed edge stack and not to a sibling stack\'s', (_scope, patternsOf, hashedName, siblingName) => {
      const { template } = synthDeployer();

      const patterns = patternsOf(template).map((pattern) => pattern.replace('<token>', ROOT_STACK_NAME));

      expect(matchesAnyPattern(patterns, hashedName)).toBe(true);
      expect(matchesAnyPattern(patterns, siblingName)).toBe(false);
    });

    const unhashedScopes: Array<[string, (template: Template) => string[], string]> = [
      [
        'the stack',
        (template) => renderResources(statementsForAction(template, 'cloudformation:CreateStack')[0].Resource).map((arn) => arn.split('stack/')[1]),
        `${ROOT_STACK_NAME}-edge/0a1b-uuid`,
      ],
      [
        'the resource group',
        (template) => renderResources(statementsForAction(template, 'resource-groups:DeleteGroup')[0].Resource).map((arn) => arn.split('group/')[1]),
        `${ROOT_STACK_NAME}-edge-serverless-inbox`,
      ],
    ];

    it.each(unhashedScopes)('does not scope %s to the unhashed edge stack', (_scope, patternsOf, unhashedName) => {
      const { template } = synthDeployer();

      const patterns = patternsOf(template).map((pattern) => pattern.replace('<token>', ROOT_STACK_NAME));

      expect(matchesAnyPattern(patterns, unhashedName)).toBe(false);
    });

    it('lets the starter read the same edge stacks', () => {
      const { template } = synthDeployer();

      const describing = statementsForAction(template, 'cloudformation:DescribeStacks')
        .flatMap((statement) => renderResources(statement.Resource));
      expect(describing).toContain(`arn:<token>:cloudformation:us-east-1:${TEST_ACCOUNT}:stack/<token>-edge-*/*`);
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
    it('is created as the deployer’s child "jmap-blob-download-role" and scoped to the stack’s edge stack name', () => {
      const { template } = synthDeployer();

      expect(Object.keys(template.findResources('AWS::IAM::Role'))).toContainEqual(expect.stringMatching(/^edgedeployerjmapblobdownloadrole[0-9A-F]{8}$/));
      expect(statementsForAction(template, 'logs:CreateLogGroup')).toEqual([
        { Action: 'logs:CreateLogGroup', Effect: 'Allow', Resource: REPLICA_LOG_GROUP_ARN },
      ]);
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
