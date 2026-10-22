/**
 * resourcesOfType: the typed reader the template tests use instead of reading `any` out of
 * `findResources`. A test that read a property a resource does not carry would pass on `undefined`,
 * so a resource that does not fit its schema must throw, naming the resource, instead of being read.
 */

import { Template }        from 'aws-cdk-lib/assertions';
import * as t              from 'typanion';

import { resourcesOfType } from './template-resources';

const isTopicProperties = t.isPartial({ TopicName: t.isString() });

describe('resourcesOfType', () => {
  it('reads the properties, policies and dependencies of every resource of the type', () => {
    const template = Template.fromJSON({
      Resources: {
        Kept:  { Type: 'AWS::SNS::Topic', Properties: { TopicName: 'kept' }, DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', DependsOn: 'Other' },
        Plain: { Type: 'AWS::SNS::Topic', Properties: { TopicName: 'plain' }, DependsOn: ['A', 'B'] },
        Other: { Type: 'AWS::SQS::Queue', Properties: {} },
      },
    });

    expect(resourcesOfType(template, 'AWS::SNS::Topic', isTopicProperties)).toEqual([
      { logicalId: 'Kept', properties: { TopicName: 'kept' }, deletionPolicy: 'Retain', updateReplacePolicy: 'Retain', dependsOn: ['Other'] },
      { logicalId: 'Plain', properties: { TopicName: 'plain' }, deletionPolicy: undefined, updateReplacePolicy: undefined, dependsOn: ['A', 'B'] },
    ]);
  });

  it('throws, naming the resource and the property, when a resource does not fit the schema', () => {
    const template = Template.fromJSON({
      Resources: { Broken: { Type: 'AWS::SNS::Topic', Properties: { TopicName: 7 } } },
    });

    expect(() => resourcesOfType(template, 'AWS::SNS::Topic', isTopicProperties)).toThrow(
      /AWS::SNS::Topic Broken has unexpected properties: .*TopicName/,
    );
  });
});
