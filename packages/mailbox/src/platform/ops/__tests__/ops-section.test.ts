/// <reference types="jest" />

/**
 * OpsSection takes over the `ops` group node. These tests pin what the section owns: the component
 * tag its subtree carries (tag-scoped grants and cost reports read it) and the children it places at
 * fixed ids (their paths are part of every resource's logical ID, so a rename replaces deployed
 * resources), including the removal that exists only when a regional certificate was created.
 */
import { renderWithTokens }                                from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { ServerlessInboxTagKeys, VENDOR_ACCOUNT_ID }       from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                                 from 'aws-cdk-lib/assertions';
import * as acm                                            from 'aws-cdk-lib/aws-certificatemanager';
import { CfnParameter, CfnResource, TagManager }           from 'aws-cdk-lib';
import type { Stack }                                      from 'aws-cdk-lib';
import * as t                                              from 'typanion';

import { isTemplateValue, resourcesOfType }                from '../../../__tests__/template-resources';
import { newArtifactResolver, newDataTable, newTestStack } from '../../__tests__/platform-helpers';
import { OpsSection }                                      from '../ops-section';
import type { OpsSectionProps }                            from '../ops-section';
import { SendStackFailuresMode }                           from '../stack-failure-detection';

const isStateMachineProperties = t.isPartial({ DefinitionString: isTemplateValue });

const VERSION_ARN = 'arn:aws:lambda:us-east-1:111122223333:function:jmap-blob-download:3';

function newSection(stack: Stack, overrides: Partial<OpsSectionProps> = {}): OpsSection {
  const section = new OpsSection(stack, 'ops', {
    artifactResolver: newArtifactResolver(stack),
    vendorAccountIds: [VENDOR_ACCOUNT_ID],
    domainName:       'example.com',
    data:             {
      configTable: newDataTable(stack, 'config-table'),
    },
    edge:             { jmapBlobDownloadVersionArn: VERSION_ARN },
    ...overrides,
  });
  Template.fromStack(stack);
  return section;
}

function componentTagsUnder(section: OpsSection): string[] {
  return section.node.findAll()
    .filter((child): child is CfnResource => CfnResource.isCfnResource(child) && TagManager.isTaggable(child))
    .map((resource) => TagManager.isTaggable(resource) ? resource.tags.tagValues()[ServerlessInboxTagKeys.component] : '');
}

describe('OpsSection', () => {
  it('tags every taggable resource under it with the ops component', () => {
    const stack = newTestStack('test-stack');

    const tags = componentTagsUnder(newSection(stack));

    expect(tags.length).toBeGreaterThan(0);
    expect(new Set(tags)).toEqual(new Set(['ops']));
  });

  it('keeps its children at the ids the group node used', () => {
    const stack = newTestStack('test-stack');

    const section = newSection(stack);

    for (const childId of ['license-refresh', 'stack-failure-detection', 'edge-fn-removal-target', 'edge-fn-removal', 'stack-failure-detector-removal', 'sweeper-infra', 'deferred-removal']) {
      expect(section.node.tryFindChild(childId)).toBeDefined();
    }
  });

  it('hands the domain it was given to the license refresh', () => {
    const stack = newTestStack('test-stack');

    newSection(stack, { domainName: 'mail.example.org' });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ CORE_DOMAIN: 'mail.example.org' }) },
    });
  });

  describe('edge function removal target', () => {
    it('is the function ARN, without the version qualifier of the version ARN it is given', () => {
      const stack = newTestStack('test-stack');

      newSection(stack);

      Template.fromStack(stack).hasResourceProperties('Custom::DeferredRemoval', {
        'edge-fn': { edgeFnArn: 'arn:aws:lambda:us-east-1:111122223333:function:jmap-blob-download' },
      });
    });

    it('keeps the first seven parts of a version ARN that is only known at deploy time', () => {
      const stack      = newTestStack('test-stack');
      const versionArn = new CfnParameter(stack, 'versionArn').valueAsString;

      newSection(stack, { edge: { jmapBlobDownloadVersionArn: versionArn } });

      const parts = [0, 1, 2, 3, 4, 5, 6].map((index) => ({ 'Fn::Select': [index, { 'Fn::Split': [':', { Ref: 'versionArn' }] }] }));
      Template.fromStack(stack).hasResourceProperties('Custom::DeferredRemoval', {
        'edge-fn': { edgeFnArn: { 'Fn::Join': [':', parts] } },
      });
    });
  });

  describe('stack failure detector removal', () => {
    it('is registered by default, because the detector is then provisioned', () => {
      const stack = newTestStack('test-stack');

      newSection(stack);

      Template.fromStack(stack).hasResourceProperties('Custom::DeferredRemoval', { detector: Match.anyValue() });
    });

    it('is registered when the mode is enabled', () => {
      const stack = newTestStack('test-stack');

      newSection(stack, { sendStackFailures: SendStackFailuresMode.ENABLED });

      Template.fromStack(stack).hasResourceProperties('Custom::DeferredRemoval', { detector: Match.anyValue() });
    });

    it('is not registered when the mode is disabled, because no detector is provisioned', () => {
      const stack = newTestStack('test-stack');

      const section = newSection(stack, { sendStackFailures: SendStackFailuresMode.DISABLED });

      expect(section.node.tryFindChild('stack-failure-detector-removal')).toBeUndefined();
      Template.fromStack(stack).hasResourceProperties('Custom::DeferredRemoval', { detector: Match.absent() });
    });
  });

  it('sweeps the certificate, then the edge function, then the stack failure detector', () => {
    const stack = newTestStack('test-stack');
    newSection(stack, {
      edge: {
        jmapBlobDownloadVersionArn: VERSION_ARN,
        regionalCertificate:        acm.Certificate.fromCertificateArn(stack, 'regional-cert', 'arn:aws:acm:us-west-2:111122223333:certificate/regional'),
      },
    });

    const [sweeper]  = resourcesOfType(Template.fromStack(stack), 'AWS::StepFunctions::StateMachine', isStateMachineProperties);
    const definition = renderWithTokens(sweeper.properties.DefinitionString);
    const positions  = ['cert', 'edge-fn', 'detector'].map((id) => definition.indexOf(`"Variable":"$.toSweep.${id}"`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((first, second) => first - second));
  });

  it('registers the certificate removal only when a regional certificate was created', () => {
    const certStack   = newTestStack('test-stack');
    const withCert    = newSection(certStack, {
      edge: {
        jmapBlobDownloadVersionArn: VERSION_ARN,
        regionalCertificate:        acm.Certificate.fromCertificateArn(certStack, 'regional-cert', 'arn:aws:acm:us-west-2:111122223333:certificate/regional'),
      },
    });
    const withoutCert = newSection(newTestStack('test-stack'));

    expect(withCert.node.tryFindChild('cert-removal')).toBeDefined();
    expect(withoutCert.node.tryFindChild('cert-removal')).toBeUndefined();
  });
});
