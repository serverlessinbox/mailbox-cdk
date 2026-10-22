import { Template }                                  from 'aws-cdk-lib/assertions';
import { Role, ServicePrincipal }                    from 'aws-cdk-lib/aws-iam';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { App, Stack }                                from 'aws-cdk-lib';
import { Construct }                                 from 'constructs';

import { applyArtifactTags }                         from '../apply-artifact-tags';

const ARTIFACT_VERSION_KEY = 'serverless-inbox:artifact-version';

function synthWrapper(): Template {
  const stack   = new Stack(new App(), 'Probe');
  const wrapper = new Construct(stack, 'wrapper');
  const role    = new Role(wrapper, 'role', { assumedBy: new ServicePrincipal('lambda.amazonaws.com') });
  new LambdaFunction(wrapper, 'handler', {
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => ({});'),
    role,
  });

  applyArtifactTags(wrapper, 'mailbox-cdk', 'probe-lambda', '1.2.3', 'edge');

  return Template.fromStack(stack);
}

interface TemplateTag {
  readonly Key: string;
  readonly Value: string;
}

function tagsOf(template: Template, type: string): Record<string, string> {
  const resources = Object.values(template.findResources(type));
  expect(resources).toHaveLength(1);

  const properties = resources[0].Properties as { Tags: TemplateTag[] };

  return Object.fromEntries(properties.Tags.map((tag) => [tag.Key, tag.Value]));
}

describe('applyArtifactTags', () => {
  it('puts the artifact version on the function only', () => {
    const template = synthWrapper();

    expect(tagsOf(template, 'AWS::Lambda::Function')[ARTIFACT_VERSION_KEY]).toBe('1.2.3');
    expect(tagsOf(template, 'AWS::IAM::Role')).not.toHaveProperty(ARTIFACT_VERSION_KEY);
  });

  it('puts the name, package and update type on every resource of the wrapper', () => {
    const template = synthWrapper();

    const expected = {
      'serverless-inbox:artifact-name': 'probe-lambda',
      'serverless-inbox:artifact-package': 'mailbox-cdk',
      'serverless-inbox:auto-update-type': 'edge',
    };

    expect(tagsOf(template, 'AWS::Lambda::Function')).toMatchObject(expected);
    expect(tagsOf(template, 'AWS::IAM::Role')).toMatchObject(expected);
  });
});
