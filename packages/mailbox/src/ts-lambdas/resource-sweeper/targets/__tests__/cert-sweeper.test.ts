/**
 * Coverage for `CertSweeper`: the ownership check via ListTagsForCertificate comes first and gates
 * every delete, InUseBy -> retry, empty InUseBy -> delete, ResourceNotFoundException -> already done,
 * any other error -> failed. Loosening the ownership gate would let a sweep delete a certificate
 * belonging to another stack.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  ACMClient,
  DescribeCertificateCommand,
  DeleteCertificateCommand,
  ListTagsForCertificateCommand,
} from '@aws-sdk/client-acm';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { CertRemovalInput } from '../../removal';
import { StackOwnership } from '../../stack-ownership';
import { CertSweeper } from '../cert-sweeper';

const acmMock = mockClient(ACMClient);
const ROOT_STACK_NAME = 'test-stack';
const CERT_ARN = 'arn:aws:acm:us-west-2:123456789012:certificate/abc-123';

const INPUT: CertRemovalInput = { certArn: CERT_ARN, rootStackName: ROOT_STACK_NAME };

function sweep() {
  const logger = new LoggerBuffer();
  return new CertSweeper(new ACMClient({ region: 'us-west-2' }), new StackOwnership(logger), logger).sweep(INPUT);
}

function ownedByThisStack(): void {
  acmMock.on(ListTagsForCertificateCommand).resolves({
    Tags: [{ Key: 'serverless-inbox:root-stack', Value: ROOT_STACK_NAME }],
  });
}

beforeEach(() => {
  acmMock.reset();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('CertSweeper', () => {
  it('deletes the certificate and reports done when not in use and ownership matches', async () => {
    ownedByThisStack();
    acmMock.on(DescribeCertificateCommand).resolves({ Certificate: { InUseBy: [] } });
    acmMock.on(DeleteCertificateCommand).resolves({});

    const result = await sweep();

    expect(result).toEqual({ target: 'cert', status: 'done' });
    expect(acmMock.commandCalls(DeleteCertificateCommand)[0].args[0].input).toEqual({ CertificateArn: CERT_ARN });
  });

  it('retries, naming what uses it, while the certificate is still in use', async () => {
    ownedByThisStack();
    acmMock.on(DescribeCertificateCommand).resolves({
      Certificate: { InUseBy: ['arn:aws:cloudfront::123456789012:distribution/ABC'] },
    });

    const result = await sweep();

    expect(result).toEqual({
      target: 'cert',
      status: 'retry',
      reason: 'InUseBy: arn:aws:cloudfront::123456789012:distribution/ABC',
    });
    expect(acmMock.commandCalls(DeleteCertificateCommand)).toHaveLength(0);
  });

  it('treats a missing certificate (ResourceNotFoundException) as already deleted', async () => {
    acmMock.on(ListTagsForCertificateCommand).rejects(
      Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }),
    );

    expect(await sweep()).toEqual({ target: 'cert', status: 'done' });
  });

  it('fails on ownership mismatch without checking use or attempting any delete', async () => {
    acmMock.on(ListTagsForCertificateCommand).resolves({
      Tags: [{ Key: 'serverless-inbox:root-stack', Value: 'someone-elses-stack' }],
    });

    const result = await sweep();

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('Ownership mismatch (expected test-stack, got someone-elses-stack)');
    expect(acmMock.commandCalls(DescribeCertificateCommand)).toHaveLength(0);
    expect(acmMock.commandCalls(DeleteCertificateCommand)).toHaveLength(0);
  });

  it('reports failed, naming the error, on any other error', async () => {
    acmMock.on(ListTagsForCertificateCommand).rejects(
      Object.assign(new Error('boom'), { name: 'InternalException' }),
    );

    expect(await sweep()).toEqual({ target: 'cert', status: 'failed', reason: 'InternalException: boom' });
  });
});
