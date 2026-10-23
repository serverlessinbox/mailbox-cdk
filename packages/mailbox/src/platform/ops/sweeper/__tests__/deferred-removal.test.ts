/// <reference types="jest" />

/**
 * DeferredRemoval: the `Custom::DeferredRemoval` resource that fires the sweeper starter. Its
 * properties must be exactly one entry per registered removal under the removal's id, because the
 * starter reads them back by id to learn what to sweep; its dependency on the whole starter keeps
 * CloudFormation from deleting the starter's policy before the Delete the starter has to answer;
 * and its service timeout stops a starter that dies without answering from holding the stack for an hour.
 */

import { Template }                                                    from 'aws-cdk-lib/assertions';
import * as iam                                                        from 'aws-cdk-lib/aws-iam';
import * as lambda                                                     from 'aws-cdk-lib/aws-lambda';
import { Duration }                                                    from 'aws-cdk-lib';
import * as t                                                          from 'typanion';

import { isTemplateValue, resourcesOfType }                            from '../../../../__tests__/template-resources';
import { newTestStack }                                                from '../../../__tests__/platform-helpers';
import { DeferredRemoval }                                             from '../deferred-removal';

import { newCertificateRemoval, newEdgeFunctionRemoval }               from './sweeper-helpers';

const isDeferredRemovalProperties = t.isRecord(isTemplateValue);

/** The keys the custom resource carries for itself. Every other key is a removal's entry. */
const CUSTOM_RESOURCE_KEYS = new Set(['ServiceToken', 'ServiceTimeout']);

/** The removal entries of the deferred-removal resource in a template: its properties without the custom resource's own keys. */
function removalEntriesOf(template: Template): Record<string, unknown> {
  const [resource] = resourcesOfType(template, 'Custom::DeferredRemoval', isDeferredRemovalProperties);
  return Object.fromEntries(Object.entries(resource.properties).filter(([key]) => !CUSTOM_RESOURCE_KEYS.has(key)));
}

describe('DeferredRemoval', () => {
  function synthesize(withCertificate: boolean): Template {
    const stack          = newTestStack('DeferredRemovalStack');
    const sweeperStarter = lambda.Function.fromFunctionAttributes(stack, 'starter', {
      functionArn:     'arn:aws:lambda:us-west-2:123456789012:function:sweeper-starter',
      sameEnvironment: true,
    });
    const removals       = withCertificate
      ? [newCertificateRemoval(stack), newEdgeFunctionRemoval(stack)]
      : [newEdgeFunctionRemoval(stack)];
    new DeferredRemoval(stack, 'deferred-removal', { sweeperStarter, removals });
    return Template.fromStack(stack);
  }

  it('is a Custom::DeferredRemoval resource served by the starter, with a service timeout of two minutes', () => {
    const template = synthesize(true);

    template.hasResourceProperties('Custom::DeferredRemoval', {
      ServiceToken:   'arn:aws:lambda:us-west-2:123456789012:function:sweeper-starter',
      ServiceTimeout: Duration.minutes(2).toSeconds().toString(),
    });
  });

  it('depends on the whole starter construct, including the policy on its role', () => {
    const stack          = newTestStack('DeferredRemovalDependencyStack');
    const sweeperStarter = new lambda.Function(stack, 'starter', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code:    lambda.Code.fromInline('exports.handler = async () => ({});'),
    });
    sweeperStarter.addToRolePolicy(new iam.PolicyStatement({ actions: ['cloudformation:DescribeStacks'], resources: ['*'] }));
    new DeferredRemoval(stack, 'deferred-removal', { sweeperStarter, removals: [newEdgeFunctionRemoval(stack)] });
    const template = Template.fromStack(stack);

    const [policyLogicalId] = Object.keys(template.findResources('AWS::IAM::Policy'));
    const [resource]        = Object.values(template.findResources('Custom::DeferredRemoval'));
    expect(resource.DependsOn).toContain(policyLogicalId);
  });

  it('carries exactly one entry per registered removal, under the removal id', () => {
    expect(removalEntriesOf(synthesize(false))).toEqual({
      'edge-fn': { edgeFnArn: 'arn:aws:lambda:us-east-1:123456789012:function:edge-fn' },
    });
  });

  it('carries the entry each registered removal reports for its own id', () => {
    expect(removalEntriesOf(synthesize(true))).toEqual({
      cert:      { certArn: 'arn:aws:acm:us-west-2:123456789012:certificate/test-cert' },
      'edge-fn': { edgeFnArn: 'arn:aws:lambda:us-east-1:123456789012:function:edge-fn' },
    });
  });
});
