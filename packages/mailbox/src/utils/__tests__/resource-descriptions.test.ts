/**
 * Pins how `MailboxResourceDescriptions` describes a resource. The sentence of a described component on its path
 * wins over the `fallbackDescription` option, which wins over a description derived from the group and path. The
 * `Name` tag is the path below the anchor without the CDK wrapper segments, and tag values are cut down to the AWS
 * tag charset and length because a value outside it fails the deploy. The component sentence is also the native
 * `Description` or `Comment` of the resource types that have one, never over a value the resource already holds,
 * and cut down to Latin-1 because an IAM role rejects anything else. Each resource type is given its role in the
 * description tag.
 */

import { ComponentDescription, ServerlessInboxTagKeys }                from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                                             from 'aws-cdk-lib/assertions';
import * as apigatewayv2                                               from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudfront                                                 from 'aws-cdk-lib/aws-cloudfront';
import * as events                                                     from 'aws-cdk-lib/aws-events';
import * as iam                                                        from 'aws-cdk-lib/aws-iam';
import * as lambda                                                     from 'aws-cdk-lib/aws-lambda';
import * as sqs                                                        from 'aws-cdk-lib/aws-sqs';
import { App, Aspects, CfnResource, Lazy, Stack, TagManager, TagType } from 'aws-cdk-lib';
import type { CfnResourceProps, ITaggable }                            from 'aws-cdk-lib';
import { Construct }                                                   from 'constructs';
import * as t                                                          from 'typanion';

import { MailboxResourceDescriptions }                                 from '../resource-descriptions';
import type { MailboxResourceDescriptionsOptions }                     from '../resource-descriptions';

/** A resource of any CloudFormation type that carries tags, standing in for an L1 whose props this suite has no use for. */
class TaggableResource extends CfnResource implements ITaggable {
  public readonly tags: TagManager;

  constructor(scope: Construct, id: string, props: CfnResourceProps) {
    super(scope, id, props);
    this.tags = new TagManager(TagType.STANDARD, props.type);
  }

  protected override get cfnProperties(): Record<string, unknown> {
    return { Tags: Object.entries(this.tags.tagValues()).map(([key, value]) => ({ Key: key, Value: value })) };
  }
}

/** A resource type with a native description, and how to create one holding the given description. */
interface NativeDescriptionCase {
  readonly type:   string;
  readonly create: (component: Construct, description: string | undefined) => void;
}

const LAMBDA_ROLE_ARN = 'arn:aws:iam::123456789012:role/function-role';

const NATIVE_DESCRIPTION_CASES: readonly NativeDescriptionCase[] = [
  { type: 'AWS::Lambda::Function', create: (component, description) => new lambda.CfnFunction(component, 'fn', { code: { zipFile: 'x' }, role: LAMBDA_ROLE_ARN, description }) },
  { type: 'AWS::IAM::Role', create: (component, description) => new iam.CfnRole(component, 'role', { assumeRolePolicyDocument: {}, description }) },
  { type: 'AWS::ApiGatewayV2::Api', create: (component, description) => new apigatewayv2.CfnApi(component, 'api', { name: 'api', protocolType: 'HTTP', description }) },
  { type: 'AWS::ApiGatewayV2::Stage', create: (component, description) => new apigatewayv2.CfnStage(component, 'stage', { apiId: 'api-1', stageName: 'prod', description }) },
  { type: 'AWS::Events::Rule', create: (component, description) => new events.CfnRule(component, 'rule', { description }) },
];

const isTaggedResource = t.isPartial({
  Properties: t.isPartial({ Tags: t.isArray(t.isObject({ Key: t.isString(), Value: t.isString() })) }),
});

const DISTRIBUTION_CONFIG ={ enabled: true, defaultCacheBehavior: { targetOriginId: 'origin', viewerProtocolPolicy: 'allow-all' } };

/** Synthesizes `Stack/Mailbox/ops/license-refresh`, which `build` fills, under the aspect anchored at `anchorId`. */
function synthesizeComponent(
  build: (component: Construct) => void,
  options: MailboxResourceDescriptionsOptions = {},
  anchorId = 'Mailbox',
): Template {
  const stack     = new Stack(new App(), 'Stack');
  const mailbox   = new Construct(stack, 'Mailbox');
  const component = new Construct(new Construct(mailbox, 'ops'), 'license-refresh');
  build(component);
  Aspects.of(stack).add(new MailboxResourceDescriptions(anchorId, options));
  return Template.fromStack(stack);
}

/** Synthesizes `Stack/Mailbox/ops/license-refresh` holding one queue, optionally describing the component first. */
function synthesizeQueue(
  options: MailboxResourceDescriptionsOptions = {},
  describeComponent?: (component: Construct) => void,
): Template {
  return synthesizeComponent((component) => {
    new sqs.CfnQueue(component, 'queue');
    describeComponent?.(component);
  }, options);
}

function queueHasDescriptionTag(template: Template, value: string): void {
  template.hasResourceProperties('AWS::SQS::Queue', {
    Tags: Match.arrayWith([{ Key: ServerlessInboxTagKeys.description, Value: value }]),
  });
}

/** The tags of the one resource of `type`, by key. */
function tagsOf(template: Template, type: string): Record<string, string> {
  const resources: unknown[] = Object.values(template.findResources(type));
  expect(resources).toHaveLength(1);

  const errors: string[] = [];
  if (!isTaggedResource(resources[0], { errors })) {
    throw new Error(`${type} carries no tags: ${errors.join('; ')}`);
  }
  return Object.fromEntries(resources[0].Properties.Tags.map((tag) => [tag.Key, tag.Value]));
}

describe('MailboxResourceDescriptions', () => {
  describe('component sentence', () => {
    it('describes a resource by the sentence of its described component', () => {
      const template = synthesizeQueue({}, (component) => ComponentDescription.describe(component, 'Own sentence'));

      queueHasDescriptionTag(template, 'Own sentence - queue');
    });

    it('prefers a described component over the fallbackDescription option', () => {
      const template = synthesizeQueue(
        { fallbackDescription: 'Fallback sentence' },
        (component) => ComponentDescription.describe(component, 'Own sentence'),
      );

      queueHasDescriptionTag(template, 'Own sentence - queue');
    });

    it('uses the fallbackDescription option when no component on the path is described', () => {
      queueHasDescriptionTag(synthesizeQueue({ fallbackDescription: 'Fallback sentence' }), 'Fallback sentence - queue');
    });

    it('derives a description from the group and path when nothing else applies', () => {
      queueHasDescriptionTag(synthesizeQueue(), 'ServerlessInbox ops ops/license-refresh/queue - queue');
    });
  });

  describe('Name tag', () => {
    it('is the path below the anchor', () => {
      const template = synthesizeQueue();

      expect(tagsOf(template, 'AWS::SQS::Queue')[ServerlessInboxTagKeys.name]).toBe('ops/license-refresh/queue');
    });

    it('is the whole path when the anchor is not on it', () => {
      const template = synthesizeComponent((component) => new sqs.CfnQueue(component, 'queue'), {}, 'NoSuchAnchor');

      expect(tagsOf(template, 'AWS::SQS::Queue')[ServerlessInboxTagKeys.name]).toBe('Stack/Mailbox/ops/license-refresh/queue');
    });

    it('drops the trailing Resource segment CDK adds under an L2', () => {
      const template = synthesizeComponent((component) => new sqs.Queue(component, 'jobs'));

      expect(tagsOf(template, 'AWS::SQS::Queue')[ServerlessInboxTagKeys.name]).toBe('ops/license-refresh/jobs');
    });

    it('drops a trailing Default segment', () => {
      const template = synthesizeComponent((component) => new TaggableResource(new Construct(component, 'jobs'), 'Default', { type: 'AWS::SQS::Queue' }));

      expect(tagsOf(template, 'AWS::SQS::Queue')[ServerlessInboxTagKeys.name]).toBe('ops/license-refresh/jobs');
    });

    it('keeps a route id inside the AWS tag charset', () => {
      const template = synthesizeComponent((component) => new TaggableResource(component, 'route-{proxy+}', { type: 'AWS::SQS::Queue' }));

      expect(tagsOf(template, 'AWS::SQS::Queue')[ServerlessInboxTagKeys.name]).toBe('ops/license-refresh/route- proxy+');
    });
  });

  describe('description tag value', () => {
    it('replaces dashes and characters outside the AWS tag charset', () => {
      const template = synthesizeQueue({}, (component) => ComponentDescription.describe(component, 'Stores mail (fast), safe — always'));

      queueHasDescriptionTag(template, 'Stores mail fast safe - always - queue');
    });

    it('is cut to the AWS tag value maximum of 256 characters', () => {
      const template = synthesizeQueue({}, (component) => ComponentDescription.describe(component, 'x'.repeat(300)));

      expect(tagsOf(template, 'AWS::SQS::Queue')[ServerlessInboxTagKeys.description]).toBe('x'.repeat(256));
    });
  });

  describe('resource role in the description tag', () => {
    it.each([
      ['AWS::Lambda::Function', 'fn', 'Lambda function'],
      ['AWS::IAM::Role', 'role', 'execution role'],
      ['AWS::IAM::Policy', 'policy', 'IAM policy'],
      ['AWS::Logs::LogGroup', 'logs', 'log group'],
      ['AWS::DynamoDB::Table', 'table', 'DynamoDB table'],
      ['AWS::SQS::Queue', 'jobs', 'queue'],
      ['AWS::SQS::Queue', 'jobs-dlq', 'dead-letter queue'],
      ['AWS::S3::Bucket', 'bucket', 'S3 bucket'],
      ['AWS::CloudFront::Distribution', 'cdn', 'CloudFront distribution'],
      ['AWS::ApiGatewayV2::Api', 'api', 'API'],
      ['AWS::ApiGatewayV2::Stage', 'stage', 'API stage'],
      ['AWS::Events::Rule', 'rule', 'event/schedule rule'],
      ['AWS::StepFunctions::StateMachine', 'machine', 'state machine'],
      ['AWS::CertificateManager::Certificate', 'cert', 'ACM certificate'],
      ['Custom::DeferredRemoval', 'removal', 'custom resource'],
      ['AWS::CloudFormation::CustomResource', 'custom', 'custom resource'],
      ['AWS::SNS::Topic', 'topic', 'sns topic'],
      ['AWS::DynamoDB::GlobalTable', 'global', 'dynamodb global table'],
    ])('describes %s %s as a %s', (type, id, role) => {
      const template = synthesizeComponent((component) => {
        new TaggableResource(component, id, { type });
        ComponentDescription.describe(component, 'Sentence');
      });

      expect(tagsOf(template, type)[ServerlessInboxTagKeys.description]).toBe(`Sentence - ${role}`);
    });
  });

  describe('native description', () => {
    it.each(NATIVE_DESCRIPTION_CASES)('sets the component sentence as the Description of $type that has none', ({ type, create }) => {
      const template = synthesizeComponent((component) => {
        create(component, undefined);
        ComponentDescription.describe(component, 'Own sentence');
      });

      template.hasResourceProperties(type, { Description: 'Own sentence' });
    });

    it.each(NATIVE_DESCRIPTION_CASES)('keeps the Description $type already has', ({ type, create }) => {
      const template = synthesizeComponent((component) => {
        create(component, 'Held already');
        ComponentDescription.describe(component, 'Own sentence');
      });

      template.hasResourceProperties(type, { Description: 'Held already' });
    });

    it('is cut down to Latin-1, which an IAM role requires', () => {
      const template = synthesizeComponent((component) => {
        new iam.CfnRole(component, 'role', { assumeRolePolicyDocument: {} });
        ComponentDescription.describe(component, 'Café — ✓handler');
      });

      template.hasResourceProperties('AWS::IAM::Role', { Description: 'Café - handler' });
    });
  });

  describe('CloudFront distribution comment', () => {
    it('is the component sentence when the distribution has none', () => {
      const template = synthesizeComponent((component) => {
        new cloudfront.CfnDistribution(component, 'cdn', { distributionConfig: DISTRIBUTION_CONFIG });
        ComponentDescription.describe(component, 'Own sentence');
      });

      template.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: { Comment: 'Own sentence' } });
    });

    it('is kept when the distribution has one', () => {
      const template = synthesizeComponent((component) => {
        new cloudfront.CfnDistribution(component, 'cdn', { distributionConfig: { ...DISTRIBUTION_CONFIG, comment: 'Held already' } });
        ComponentDescription.describe(component, 'Own sentence');
      });

      template.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: { Comment: 'Held already' } });
    });

    it('is the component sentence when the distribution config is not yet resolved', () => {
      const template = synthesizeComponent((component) => {
        new cloudfront.CfnDistribution(component, 'cdn', { distributionConfig: Lazy.any({ produce: () => DISTRIBUTION_CONFIG }) });
        ComponentDescription.describe(component, 'Own sentence');
      });

      template.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: { Comment: 'Own sentence' } });
    });
  });

  describe('resources without tags', () => {
    it('are left untagged', () => {
      const template = synthesizeComponent((component) => new CfnResource(component, 'custom', {
        type:       'AWS::CloudFormation::CustomResource',
        properties: { ServiceToken: 'arn:aws:lambda:eu-west-1:123456789012:function:handler' },
      }));

      template.hasResourceProperties('AWS::CloudFormation::CustomResource', { Tags: Match.absent() });
    });
  });
});
