/**
 * Coverage for the cert removal sub-handler against its own `CertRemovalInput` type — behaviour is
 * unchanged from before the per-removal-type rework (see `targets/cert.ts`): ownership check via
 * ListTagsForCertificate, InUseBy -> retry, empty InUseBy -> delete, ResourceNotFoundException ->
 * already done, ownership mismatch -> failed.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  ACMClient,
  DescribeCertificateCommand,
  DeleteCertificateCommand,
  ListTagsForCertificateCommand,
} from '@aws-sdk/client-acm';
import { sweepCert } from '../targets/cert';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { CertRemovalInput } from '../targets/types';

const acmMock = mockClient(ACMClient);
const ROOT_STACK_NAME = 'test-stack';
const CERT_ARN = 'arn:aws:acm:us-west-2:123456789012:certificate/abc-123';

function input(overrides: Partial<CertRemovalInput> = {}): CertRemovalInput {
  return { certArn: CERT_ARN, rootStackName: ROOT_STACK_NAME, ...overrides };
}

function logger(): LoggerBuffer {
  return new LoggerBuffer(undefined);
}

beforeEach(() => {
  acmMock.reset();
});

describe('sweepCert', () => {
  it('deletes the certificate and reports done when not in use and ownership matches', async () => {
    acmMock.on(ListTagsForCertificateCommand).resolves({
      Tags: [{ Key: 'serverless-inbox:root-stack', Value: ROOT_STACK_NAME }],
    });
    acmMock.on(DescribeCertificateCommand).resolves({ Certificate: { InUseBy: [] } });
    acmMock.on(DeleteCertificateCommand).resolves({});

    const acmClient = new ACMClient({ region: 'us-west-2' });
    const result = await sweepCert(input(), logger(), acmClient);

    expect(result).toEqual({ target: 'cert', status: 'done' });
    expect(acmMock.commandCalls(DeleteCertificateCommand)[0].args[0].input).toEqual({
      CertificateArn: CERT_ARN,
    });
  });

  it('retries while the certificate is still in use', async () => {
    acmMock.on(ListTagsForCertificateCommand).resolves({
      Tags: [{ Key: 'serverless-inbox:root-stack', Value: ROOT_STACK_NAME }],
    });
    acmMock.on(DescribeCertificateCommand).resolves({
      Certificate: { InUseBy: ['arn:aws:cloudfront::123456789012:distribution/ABC'] },
    });

    const acmClient = new ACMClient({ region: 'us-west-2' });
    const result = await sweepCert(input(), logger(), acmClient);

    expect(result.status).toBe('retry');
    expect(acmMock.commandCalls(DeleteCertificateCommand)).toHaveLength(0);
  });

  it('treats a missing certificate (ResourceNotFoundException) as already deleted', async () => {
    acmMock.on(ListTagsForCertificateCommand).rejects(
      Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }),
    );

    const acmClient = new ACMClient({ region: 'us-west-2' });
    const result = await sweepCert(input(), logger(), acmClient);

    expect(result).toEqual({ target: 'cert', status: 'done' });
  });

  it('fails on ownership mismatch without attempting any delete', async () => {
    acmMock.on(ListTagsForCertificateCommand).resolves({
      Tags: [{ Key: 'serverless-inbox:root-stack', Value: 'someone-elses-stack' }],
    });

    const acmClient = new ACMClient({ region: 'us-west-2' });
    const result = await sweepCert(input(), logger(), acmClient);

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('Ownership mismatch');
    expect(acmMock.commandCalls(DeleteCertificateCommand)).toHaveLength(0);
  });

  it('reports failed on a hard error', async () => {
    acmMock.on(ListTagsForCertificateCommand).rejects(
      Object.assign(new Error('boom'), { name: 'InternalException' }),
    );

    const acmClient = new ACMClient({ region: 'us-west-2' });
    const result = await sweepCert(input(), logger(), acmClient);

    expect(result.status).toBe('failed');
  });
});
