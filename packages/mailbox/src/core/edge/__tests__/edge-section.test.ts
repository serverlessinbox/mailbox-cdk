/// <reference types="jest" />

/**
 * EdgeSection takes over the `edge` group node. These tests pin what the section owns: the component
 * tag its subtree carries, the children it places at fixed ids (their paths are part of every
 * resource's logical ID, so a rename replaces deployed resources), and the two children it adds on
 * request because their inputs exist only after the UIs and the APIs.
 */
import { ServerlessInboxTagKeys }                            from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                          from 'aws-cdk-lib/assertions';
import * as acm                                              from 'aws-cdk-lib/aws-certificatemanager';
import { Table }                                             from 'aws-cdk-lib/aws-dynamodb';
import * as route53                                          from 'aws-cdk-lib/aws-route53';
import { Bucket }                                            from 'aws-cdk-lib/aws-s3';
import { CfnResource, TagManager }                           from 'aws-cdk-lib';
import type { Stack }                                        from 'aws-cdk-lib';

import { newDeployerTestStack }                              from '../../../__tests__/deployer-test-helpers';
import { DataTable }                                         from '../../../resources/tables/data-tables';
import { MailboxDomains }                                    from '../../domains/mailbox-domains';
import { EdgeSection }                                       from '../edge-section';
import type { BlobCdnProps, EdgeDnsProps, EdgeSectionProps } from '../edge-section';

function dataTable(stack: Stack, id: string): DataTable {
  return new DataTable(Table.fromTableArn(stack, id, `arn:aws:dynamodb:us-west-2:111122223333:table/${id}`));
}

function newSection(overrides: Partial<EdgeSectionProps> = {}): { stack: Stack; section: EdgeSection } {
  const { stack, artifactResolver } = newDeployerTestStack();
  const section                     = new EdgeSection(stack, 'edge', {
    artifactResolver,
    deployerType:   'cfn',
    productVersion: '1.2.3',
    data:           {
      configTable:       dataTable(stack, 'config-table'),
      itemTable:         dataTable(stack, 'item-table'),
      derivedDomainName: 'example.com',
      blobStoreBucket:   new Bucket(stack, 'blob-store'),
    },
    auth:           { authKeyStoreTable: dataTable(stack, 'auth-key-store-table') },
    addressing:     {
      domains:    new MailboxDomains({ domainName: 'example.com' }),
      edgePrefix: 'mail',
      zone:       route53.HostedZone.fromHostedZoneAttributes(stack, 'zone', { hostedZoneId: 'Z0TESTZONE', zoneName: 'example.com' }),
    },
    hostedZoneId:   'Z0TESTZONE',
    ...overrides,
  });
  return { stack, section };
}

const BLOB_CDN_PROPS: BlobCdnProps = { ui: { adminUiOrigins: [], webmailUiOrigins: [] }, extraAllowedOrigins: [] };

const DNS_PROPS: EdgeDnsProps = {
  ui:      {},
  blobCdn: { host: 'https://cdn.example.com', distributionDomainName: 'd111111abcdef8.cloudfront.net' },
  apis:    {},
};

function componentTagsUnder(section: EdgeSection): string[] {
  return section.node.findAll()
    .filter((child): child is CfnResource => CfnResource.isCfnResource(child) && TagManager.isTaggable(child))
    .map((resource) => TagManager.isTaggable(resource) ? resource.tags.tagValues()[ServerlessInboxTagKeys.component] : '');
}

describe('EdgeSection', () => {
  it('tags every taggable resource under it with the edge component', () => {
    const { stack, section } = newSection();
    section.addBlobCdn(BLOB_CDN_PROPS);

    Template.fromStack(stack);

    const tags = componentTagsUnder(section);
    expect(tags.length).toBeGreaterThan(0);
    expect(new Set(tags)).toEqual(new Set(['edge']));
  });

  it('keeps its children at the ids the group node used', () => {
    const { section } = newSection();

    for (const childId of ['stack-deployer', 'regional-api-certificate', 'regional-api-certificate-ref']) {
      expect(section.node.tryFindChild(childId)).toBeDefined();
    }
    expect(section.regionalCertificate).toBeDefined();
  });

  it('builds no regional certificate when the operator provides both API certificates', () => {
    const provided         = (stack: Stack, id: string): acm.ICertificate => acm.Certificate.fromCertificateArn(stack, id, 'arn:aws:acm:us-west-2:111122223333:certificate/provided');
    const { stack: probe } = newDeployerTestStack();
    const { section }      = newSection({ certificateOverrides: { api: provided(probe, 'api'), jmap: provided(probe, 'jmap') } });

    expect(section.node.tryFindChild('regional-api-certificate')).toBeUndefined();
    expect(section.regionalCertificate).toBeUndefined();
  });

  it('addBlobCdn creates blob-cdn under the section and returns the endpoint the APIs read', () => {
    const { section } = newSection();

    const endpoint = section.addBlobCdn(BLOB_CDN_PROPS);

    expect(section.node.tryFindChild('blob-cdn')).toBeDefined();
    expect(endpoint.host).toMatch(/^https:\/\//);
  });

  it('serves the UIs with the edge certificate when the mailbox has a hosted zone and with none otherwise', () => {
    const { section: withZone }    = newSection();
    const { section: withoutZone } = newSection({ hostedZoneId: undefined });

    expect(withZone.edgeCertificate).toBeDefined();
    expect(withZone.uiCertificate).toBe(withZone.edgeCertificate);
    expect(withoutZone.uiCertificate).toBeUndefined();
  });

  it('gives each regional API the operator certificate, else the regional SAN certificate', () => {
    const { stack: probe } = newDeployerTestStack();
    const jmap             = acm.Certificate.fromCertificateArn(probe, 'jmap', 'arn:aws:acm:us-west-2:111122223333:certificate/jmap');
    const ws               = acm.Certificate.fromCertificateArn(probe, 'ws', 'arn:aws:acm:us-west-2:111122223333:certificate/ws');
    const { section }      = newSection({ certificateOverrides: { jmap, ws } });

    expect(section.apiCertificate).toBe(section.regionalCertificate);
    expect(section.jmapCertificate).toBe(jmap);
    expect(section.wsCertificate).toBe(ws);
  });

  it('addBlobCdn serves the CDN on the cdn domain with the edge certificate when the mailbox has a hosted zone', () => {
    const { stack, section } = newSection();

    section.addBlobCdn(BLOB_CDN_PROPS);

    Template.fromStack(stack).hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: { Aliases: ['cdn.example.com'] },
    });
  });

  it('addBlobCdn serves the CDN on the cdn domain with the operator CloudFront certificate when there is no hosted zone', () => {
    const { stack: probe }   = newDeployerTestStack();
    const cloudFront         = acm.Certificate.fromCertificateArn(probe, 'cloudfront', 'arn:aws:acm:us-east-1:111122223333:certificate/cloudfront');
    const { stack, section } = newSection({ hostedZoneId: undefined, certificateOverrides: { cloudFront } });

    section.addBlobCdn(BLOB_CDN_PROPS);

    Template.fromStack(stack).hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: { Aliases: ['cdn.example.com'], ViewerCertificate: { AcmCertificateArn: cloudFront.certificateArn } },
    });
  });

  it('addDns creates dns under the section', () => {
    const { section } = newSection();

    section.addDns(DNS_PROPS);

    expect(section.node.tryFindChild('dns')).toBeDefined();
  });

  it('addDns creates no records when the mailbox has no hosted zone', () => {
    const { section } = newSection({ hostedZoneId: undefined });

    section.addDns(DNS_PROPS);

    expect(section.node.tryFindChild('dns')).toBeUndefined();
  });
});
