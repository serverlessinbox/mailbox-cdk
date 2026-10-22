/// <reference types="jest" />

/**
 * MailboxDns tests: which records are created for which endpoints, in zone mode and in manual mode.
 *
 * Pins that an endpoint without a target gets no record, that the JMAP SRV record sits at
 * `_jmap._tcp` of the zone root whatever namespace prefix the endpoints carry (RFC 8620 §2.2
 * clients query exactly that name), and that manual mode describes the same records without
 * creating any. A moved SRV name makes JMAP autodiscovery fail silently for clients.
 */

import { Template }             from 'aws-cdk-lib/assertions';
import * as route53             from 'aws-cdk-lib/aws-route53';
import * as cdk                 from 'aws-cdk-lib';
import { App, Duration }        from 'aws-cdk-lib';

import { MailboxDns }           from '../mailbox-dns';
import type { MailboxDnsProps } from '../mailbox-dns';
import { MailboxDomains }       from '../mailbox-domains';

describe('MailboxDns', () => {
  let stack: cdk.Stack;
  let hostedZone: route53.IHostedZone;

  function propsWith(overrides: Partial<MailboxDnsProps>): MailboxDnsProps {
    return {
      names:        new MailboxDomains({ domainName: 'example.com', prefix: 'mail' }),
      cnameTargets: { admin: 'admin.cloudfront.net', jmap: 'jmap.execute-api.example.net' },
      ...overrides,
    };
  }

  beforeEach(() => {
    stack      = new cdk.Stack(new App(), 'TestStack', { env: { account: '123456789012', region: 'us-west-2' } });
    hostedZone = route53.HostedZone.fromHostedZoneAttributes(stack, 'zone', {
      hostedZoneId: 'Z123',
      zoneName:     'example.com',
    });
  });

  describe('with a hosted zone', () => {
    it('creates a CNAME with the zone-relative label for each endpoint that has a target', () => {
      new MailboxDns(stack, 'dns', propsWith({ hostedZone }));

      const template = Template.fromStack(stack);

      template.resourceCountIs('AWS::Route53::RecordSet', 3);
      template.hasResourceProperties('AWS::Route53::RecordSet', {
        Type:            'CNAME',
        Name:            'admin.mail.example.com.',
        ResourceRecords: ['admin.cloudfront.net'],
        TTL:             '300',
      });
      template.hasResourceProperties('AWS::Route53::RecordSet', {
        Type:            'CNAME',
        Name:            'jmap.mail.example.com.',
        ResourceRecords: ['jmap.execute-api.example.net'],
      });
    });

    it('creates the JMAP SRV record at _jmap._tcp of the zone root, without the namespace prefix', () => {
      new MailboxDns(stack, 'dns', propsWith({ hostedZone }));

      Template.fromStack(stack).hasResourceProperties('AWS::Route53::RecordSet', {
        Type:            'SRV',
        Name:            '_jmap._tcp.example.com.',
        ResourceRecords: ['0 1 443 jmap.execute-api.example.net'],
      });
    });

    it('creates no SRV record without a JMAP target', () => {
      new MailboxDns(stack, 'dns', propsWith({ hostedZone, cnameTargets: { admin: 'admin.cloudfront.net' } }));

      const types = Object.values(Template.fromStack(stack).findResources('AWS::Route53::RecordSet'))
        .map((record) => record.Properties.Type);

      expect(types).toEqual(['CNAME']);
    });

    it('uses the given TTL', () => {
      new MailboxDns(stack, 'dns', propsWith({ hostedZone, ttl: Duration.minutes(1) }));

      Template.fromStack(stack).hasResourceProperties('AWS::Route53::RecordSet', { Type: 'CNAME', TTL: '60' });
    });

    it('leaves manualModeRecords empty', () => {
      const sut = new MailboxDns(stack, 'dns', propsWith({ hostedZone }));

      expect(sut.manualModeRecords).toEqual([]);
    });
  });

  describe('without a hosted zone', () => {
    it('describes each CNAME by its fully qualified name and creates no record', () => {
      const sut = new MailboxDns(stack, 'dns', propsWith({}));

      expect(sut.manualModeRecords).toContainEqual({
        name:       'admin.mail.example.com',
        type:       'CNAME',
        value:      'admin.cloudfront.net',
        ttlSeconds: '300',
      });
      Template.fromStack(stack).resourceCountIs('AWS::Route53::RecordSet', 0);
    });

    it('describes the JMAP SRV record at _jmap._tcp of the base domain, without the namespace prefix', () => {
      const sut = new MailboxDns(stack, 'dns', propsWith({}));

      expect(sut.manualModeRecords).toContainEqual({
        name:       '_jmap._tcp.example.com',
        type:       'SRV',
        value:      '0 1 443 jmap.execute-api.example.net',
        ttlSeconds: '300',
      });
    });

    it('describes nothing for an endpoint without a target', () => {
      const sut = new MailboxDns(stack, 'dns', propsWith({ cnameTargets: { admin: 'admin.cloudfront.net' } }));

      expect(sut.manualModeRecords.map((record) => record.type)).toEqual(['CNAME']);
    });

    it('reports the given TTL in seconds', () => {
      const sut = new MailboxDns(stack, 'dns', propsWith({ ttl: Duration.minutes(1) }));

      expect(sut.manualModeRecords.every((record) => record.ttlSeconds === '60')).toBe(true);
    });
  });
});
