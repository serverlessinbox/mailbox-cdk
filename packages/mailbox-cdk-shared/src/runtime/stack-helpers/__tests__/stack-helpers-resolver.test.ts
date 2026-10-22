/// <reference types="jest" />

/**
 * Pins what the stack-helpers Lambda answers for the properties of a Custom::StackHelpers resource.
 * The values it returns feed S3 bucket names, the Cognito hosted-UI domain and schedules, so a wrong
 * hosted-zone name, a stack name S3 rejects, or a Cognito prefix with a reserved word, a double or
 * trailing hyphen or more than 63 characters fails the deploy of the stack that consumes them.
 * Route 53 is faked and supplies the domain name the Cognito prefix is derived from.
 */

import { GetHostedZoneCommand, Route53Client } from '@aws-sdk/client-route-53';
import { mockClient }                          from 'aws-sdk-client-mock';

import { toStackId }                           from '../../handler-kit/custom-resource/custom-resource-identifiers';
import type { StackId }                        from '../../handler-kit/custom-resource/custom-resource-identifiers';
import { ExpectedFailure }                     from '../../handler-kit/errors/expected-failure';
import { LoggerBuffer }                        from '../../handler-kit/logger-buffer';
import type { StackHelpersResourceProperties } from '../resource-properties';
import { StackHelpersResolver }                from '../stack-helpers-resolver';

describe('StackHelpersResolver', () => {
  const route53Mock = mockClient(Route53Client);
  const resolver    = new StackHelpersResolver(new Route53Client({}), new LoggerBuffer());
  const stackId     = toStackId('arn:aws:cloudformation:eu-west-1:123456789012:stack/mailbox/4f1c2a9e-0000-4000-8000-000000000001');

  function resolveFor(properties: unknown, forStackId: StackId = stackId) {
    return resolver.resolve(properties, forStackId);
  }

  function hostedZoneNamed(name: string | undefined) {
    return { HostedZone: { Id: '/hostedzone/Z123', Name: name, CallerReference: 'ref' } };
  }

  async function cognitoPrefixForDomain(domainName: string, extraProperties: StackHelpersResourceProperties = {}) {
    route53Mock.on(GetHostedZoneCommand).resolves(hostedZoneNamed(`${domainName}.`));
    const data = await resolveFor({ HostedZoneId: 'Z123', ...extraProperties });
    return data.cognitoDomainPrefix;
  }

  beforeEach(() => {
    route53Mock.reset();
  });

  describe('domain name', () => {
    it('is the name of the hosted zone without its trailing dot', async () => {
      route53Mock.on(GetHostedZoneCommand).resolves(hostedZoneNamed('mail.example.com.'));

      const data = await resolveFor({ ServiceToken: 'arn:token', HostedZoneId: 'Z123', DataStackName: 'stack' });

      expect(data.domainName).toBe('mail.example.com');
      expect(route53Mock.commandCalls(GetHostedZoneCommand)[0].args[0].input).toEqual({ Id: 'Z123' });
    });

    it('is empty and skips Route 53 when no hosted zone is given', async () => {
      const data = await resolveFor({ HostedZoneId: '', DataStackName: 'stack' });

      expect(data.domainName).toBe('');
      expect(route53Mock.commandCalls(GetHostedZoneCommand)).toHaveLength(0);
    });

    it('is empty when the hosted zone has no name', async () => {
      route53Mock.on(GetHostedZoneCommand).resolves(hostedZoneNamed(undefined));

      const data = await resolveFor({ HostedZoneId: 'Z123', DataStackName: 'stack' });

      expect(data.domainName).toBe('');
    });

    it('lets a Route 53 failure reach the caller', async () => {
      route53Mock.on(GetHostedZoneCommand).rejects(new Error('NoSuchHostedZone'));

      await expect(resolveFor({ HostedZoneId: 'Z123' })).rejects.toThrow('NoSuchHostedZone');
    });
  });

  describe('S3-safe data stack name', () => {
    it('is lowercased with every disallowed character turned into a single hyphen', async () => {
      const data = await resolveFor({ DataStackName: 'My_Data.Stack!!Name' });

      expect(data.s3SafeDataStackName).toBe('my-data-stack-name');
    });

    it('is cut to 40 characters', async () => {
      const data = await resolveFor({ DataStackName: 'a'.repeat(50) });

      expect(data.s3SafeDataStackName).toBe('a'.repeat(40));
    });
  });

  describe('Cognito domain prefix from the domain name', () => {
    it.each([
      ['dots become hyphens', 'mail.example.co.uk', 'mail-example-co-uk'],
      ['upper case is lowered', 'EXAMPLE.COM', 'example-com'],
      ['any other character becomes a hyphen', 'example_com@test', 'example-com-test'],
      ['runs of hyphens collapse', 'my---domain..com', 'my-domain-com'],
      ['leading and trailing hyphens are trimmed', '-example.com-', 'example-com'],
      ['aws is dropped', 'aws.example.com', 'example-com'],
      ['amazon is dropped', 'amazon.example.com', 'example-com'],
      ['cognito is dropped', 'cognito.example.com', 'example-com'],
      ['a reserved word inside a label is dropped', 'awsmail.com', 'mail-com'],
      ['a near miss is left untouched', 'aweso-mail.com', 'aweso-mail-com'],
      ['hyphens left by a dropped word collapse', 'my-aws-backup.com', 'my-backup-com'],
      ['it is cut at 63 characters', 'a'.repeat(70), 'a'.repeat(63)],
      ['the hyphen a cut leaves at the end is dropped', `${'a'.repeat(62)}.com`, 'a'.repeat(62)],
      ['an inner hyphen survives a cut after the next character', `${'a'.repeat(60)}-b.com`, `${'a'.repeat(60)}-b`],
    ])('%s', async (_name, domainName, expected) => {
      expect(await cognitoPrefixForDomain(domainName)).toBe(expected);
    });

    it('wins over the Fallback', async () => {
      expect(await cognitoPrefixForDomain('example.com', { Fallback: 'my-stack' })).toBe('example-com');
    });
  });

  describe('Cognito domain prefix fallback', () => {
    it('is used when the domain name is made only of reserved words', async () => {
      expect(await cognitoPrefixForDomain('aws.amazon.cognito', { Fallback: 'my-stack' })).toBe('my-stack');
    });

    it('is used when there is no domain name, and is derived like one', async () => {
      const data = await resolveFor({ Fallback: 'AWS-Backup' });

      expect(data.cognitoDomainPrefix).toBe('backup');
    });

    it.each([
      ['empty', { Fallback: '' }],
      ['absent', {}],
    ])('is the S3-safe data stack name when Fallback is %s', async (_name, fallback) => {
      const data = await resolveFor({ DataStackName: 'My_Data_Stack', ...fallback });

      expect(data.cognitoDomainPrefix).toBe('my-data-stack');
    });

    it('is "installer" when nothing yields a prefix', async () => {
      const data = await resolveFor({});

      expect(data).toMatchObject({ domainName: '', s3SafeDataStackName: '', cognitoDomainPrefix: 'installer' });
    });
  });

  describe('seeded number', () => {
    const otherStackId = toStackId('arn:aws:cloudformation:eu-west-1:123456789012:stack/mailbox/4f1c2a9e-0000-4000-8000-000000000002');
    const seeded       = { Salt: 'first-purpose', Range: '1000' };

    it('is the same for the same stack id and salt', async () => {
      const first  = await resolveFor(seeded);
      const second = await resolveFor(seeded);

      expect(first.seededNumber).toBe(second.seededNumber);
    });

    it('differs between salts of one stack id', async () => {
      const first = await resolveFor(seeded);
      const other = await resolveFor({ ...seeded, Salt: 'second-purpose' });

      expect(first.seededNumber).not.toBe(other.seededNumber);
    });

    it('differs between stack ids', async () => {
      const first = await resolveFor(seeded, stackId);
      const other = await resolveFor(seeded, otherStackId);

      expect(first.seededNumber).not.toBe(other.seededNumber);
    });

    it('is a plain-digit number from 0 up to but excluding the range', async () => {
      const stackIds = Array.from({ length: 200 }, (_element, index) => toStackId(`arn:aws:cloudformation:eu-west-1:123456789012:stack/mailbox/${index}`));

      const results = await Promise.all(stackIds.map((id) => resolveFor({ Salt: 'any', Range: '24' }, id)));

      for (const { seededNumber } of results) {
        expect(seededNumber).toMatch(/^([0-9]|1[0-9]|2[0-3])$/);
      }
    });

    it('is always 0 for a range of 1', async () => {
      const data = await resolveFor({ Salt: 'any', Range: '1' });

      expect(data.seededNumber).toBe('0');
    });

    it('is absent when the properties carry no Range', async () => {
      const data = await resolveFor({ Salt: 'any' });

      expect(data).not.toHaveProperty('seededNumber');
    });

    it('is present when the properties carry a Range', async () => {
      const data = await resolveFor({ Salt: 'any', Range: '24' });

      expect(data).toHaveProperty('seededNumber', expect.stringMatching(/^\d+$/));
    });

    it.each(['0', '-5', '2.5', 'ten', '', '010'])('rejects the Range "%s"', async (range) => {
      await expect(resolveFor({ Salt: 'any', Range: range })).rejects.toThrow(/Invalid ResourceProperties.*Range/);
    });
  });

  describe('invalid properties', () => {
    it('are rejected naming the property that has the wrong type', async () => {
      await expect(resolveFor({ HostedZoneId: 5 })).rejects.toThrow(/Invalid ResourceProperties.*HostedZoneId/);
    });

    it('are rejected when the resource properties are missing altogether', async () => {
      await expect(resolveFor(undefined)).rejects.toThrow('Invalid ResourceProperties');
    });

    it('are rejected as an expected failure, which the handler answers without flushing the trace', async () => {
      await expect(resolveFor({ HostedZoneId: 5 })).rejects.toBeInstanceOf(ExpectedFailure);
    });
  });
});
