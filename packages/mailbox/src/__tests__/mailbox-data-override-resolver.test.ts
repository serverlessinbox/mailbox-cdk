import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { MailboxDataDeployer } from '../data/mailbox-data-deployer';
import { MailboxDataOverrideResolver } from '../data/mailbox-data-override-resolver';
import { MailboxArtifactResolverFactory, applyServerlessInboxBaseTags } from '@serverlessinbox/mailbox-cdk-shared';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { loadMailboxRegistryRecord } from '../mailbox-registry-record';

const ROLES = ['configTable', 'itemTable', 'changelogTable', 'auditLogTable', 'mailFeedbackTable'] as const;

describe('MailboxDataOverrideResolver synthesis', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: IArtifactResolver;
  let deployer: MailboxDataDeployer;
  let template: Template;

  beforeEach(() => {
    app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-cdk': { zone: 'regional', version: '1.0.0' },
            'mailbox-go': { zone: 'regional', version: '1.0.0' },
            'mailbox-cdk-shared': { zone: 'regional', version: '1.0.0' },
          },
        },
      },
    });
    stack = new cdk.Stack(app, 'TestStack', {
      synthesizer: new BootstraplessSynthesizer(),
      env: { account: '123456789012', region: 'us-west-2' },
    });
    const registryRecord = loadMailboxRegistryRecord();
    artifactResolver = MailboxArtifactResolverFactory.fromContext(stack, registryRecord, {});

    applyServerlessInboxBaseTags(stack, {
      rootStack: cdk.Aws.STACK_NAME,
      version: '1.0.0',
      product: 'mailbox',
    });

    deployer = new MailboxDataDeployer(stack, 'DataDeployer', {
      artifactResolver,
      nameBase: 'test-base',
      deployerType: 'cdk',
    });
    template = Template.fromStack(stack);
  });

  /**
   * Helper: find exactly one resource of a given type (optionally with matching properties).
   * Throws if zero or more than one resource is found.
   */
  function onlyLogicalId(type: string, props?: object): string {
    const ids = Object.keys(
      template.findResources(type, props === undefined ? undefined : { Properties: props })
    );
    expect(ids).toHaveLength(1);
    return ids[0];
  }

  /**
   * Helper: construct the SSM parameter name for a given role.
   * Must match the exact synthesized shape with Fn::Join.
   */
  const parameterName = (role: string) => ({
    'Fn::Join': ['', ['/serverlessinbox/', { Ref: 'AWS::StackName' }, `/data-override/${role}`]],
  });

  it('declares one tagged override parameter per role, valued with the data stack\'s table ARN', () => {
    template.resourceCountIs('AWS::SSM::Parameter', 5);

    const deployerId = onlyLogicalId('Custom::MailboxDataDeployer');

    for (const role of ROLES) {
      const paramId = onlyLogicalId('AWS::SSM::Parameter', {
        Name: parameterName(role),
        Value: { 'Fn::GetAtt': [deployerId, `${role}Arn`] },
        Tags: Match.objectLike({ 'serverless-inbox:root-stack': Match.anyValue() }),
      });
      expect(paramId).toBeTruthy();
    }
  });

  it('passes the incoming ARN and a dynamic reference to the override parameter per role', () => {
    template.resourceCountIs('Custom::MailboxDataOverrideResolver', 1);

    const deployerId = onlyLogicalId('Custom::MailboxDataDeployer');

    const expected: Record<string, unknown> = {
      ServiceToken: Match.anyValue(),
      ServiceTimeout: Match.anyValue(),
    };

    for (const role of ROLES) {
      const paramId = onlyLogicalId('AWS::SSM::Parameter', {
        Name: parameterName(role),
      });
      expected[`${role}IncomingArn`] = { 'Fn::GetAtt': [deployerId, `${role}Arn`] };
      expected[`${role}OverrideArn`] = {
        'Fn::Join': ['', ['{{resolve:ssm:', { Ref: paramId }, '}}']],
      };
    }

    template.hasResourceProperties('Custom::MailboxDataOverrideResolver', Match.objectEquals(expected));
  });

  it('grants the resolver DescribeTable and no SSM access', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'dynamodb:DescribeTable', Effect: 'Allow' }),
        ]),
      },
      Roles: [{ Ref: Match.stringLikeRegexp('overrideresolverhandler') }],
    });
    expect(JSON.stringify(template.findResources('AWS::IAM::Policy'))).not.toMatch(/"ssm:/);
  });

  it('feeds the resolver\'s outputs into the data stack ref', () => {
    const resolverId = onlyLogicalId('Custom::MailboxDataOverrideResolver');
    // Test that each deployer table accessor returns the resolver's GetAtt output.
    expect(stack.resolve(deployer.configTable.tableArn)).toEqual({
      'Fn::GetAtt': [resolverId, 'configTableArn'],
    });
    expect(stack.resolve(deployer.itemTable.tableArn)).toEqual({
      'Fn::GetAtt': [resolverId, 'itemTableArn'],
    });
    expect(stack.resolve(deployer.changelogTable.tableArn)).toEqual({
      'Fn::GetAtt': [resolverId, 'changelogTableArn'],
    });
    expect(stack.resolve(deployer.auditLogTable.tableArn)).toEqual({
      'Fn::GetAtt': [resolverId, 'auditLogTableArn'],
    });
    expect(stack.resolve(deployer.mailFeedbackTable.tableArn)).toEqual({
      'Fn::GetAtt': [resolverId, 'mailFeedbackTableArn'],
    });
  });

  it('template contains no CloudFormation parameters with "revision" in the name', () => {
    const parameters: Record<string, unknown> = template.toJSON().Parameters ?? {};
    const revisionParams = Object.keys(parameters).filter((key) =>
      key.toLowerCase().includes('revision')
    );
    expect(revisionParams).toEqual([]);
  });
});

describe('MailboxDataOverrideResolver with an unpinned package', () => {
  it('fails to synthesize naming the package the resolver holds no pin for', () => {
    const stack = new cdk.Stack(new App(), 'TestStack', {
      synthesizer: new BootstraplessSynthesizer(),
      env: { account: '123456789012', region: 'us-west-2' },
    });
    const resolverWithoutMailboxCdk = new PinnedArtifactResolver({
      packages: { 'mailbox-go': { zone: ArtifactZone.REGIONAL, version: '1.0.0' } },
      location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    expect(() => {
      new MailboxDataOverrideResolver(stack, 'override-resolver', {
        configTableArn: 'arn:aws:dynamodb:us-west-2:123456789012:table/config',
        itemTableArn: 'arn:aws:dynamodb:us-west-2:123456789012:table/item',
        changelogTableArn: 'arn:aws:dynamodb:us-west-2:123456789012:table/changelog',
        auditLogTableArn: 'arn:aws:dynamodb:us-west-2:123456789012:table/audit',
        mailFeedbackTableArn: 'arn:aws:dynamodb:us-west-2:123456789012:table/feedback',
        artifactResolver: resolverWithoutMailboxCdk,
      });
    }).toThrow("No resolved data for package 'mailbox-cdk'");
  });
});
