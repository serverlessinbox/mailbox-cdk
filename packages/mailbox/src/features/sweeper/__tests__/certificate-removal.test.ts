/// <reference types="jest" />

/**
 * CertificateRemoval: the grants, `ResourceProperties` entry and state-machine steps for sweeping an
 * ACM certificate. Deleting a certificate is gated on the root-stack tag, so a dropped condition
 * lets the sweeper delete a certificate another stack owns; reads stay unconditioned because
 * the worker has to look at a certificate before it can tell whether this stack owns it.
 */

import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import {
  newCertificateRemoval,
  newTestStack,
  renderRemovalChain,
  resolveStatements,
  stateBodyOf,
} from './sweeper-helpers';

describe('CertificateRemoval', () => {
  const anyCertificate = {
    'Fn::Join': ['', ['arn:aws:acm:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':certificate/*']],
  };

  const stackGuid = { 'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }] };
  const idKey = `aws:ResourceTag/${ServerlessInboxTagKeys.rootStackId}`;
  const ownedById = { StringEquals: { [idKey]: stackGuid } };
  const ownedByNameWithoutId = {
    StringEquals: { [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: { Ref: 'AWS::StackName' } },
    Null: { [idKey]: 'true' },
  };

  it('reads certificates unconditioned and deletes them only when the root stack owns them, by id or by name without an id tag', () => {
    const stack = newTestStack('CertificateGrantsStack');

    const statements = resolveStatements(stack, newCertificateRemoval(stack).grantStatements());

    expect(statements).toEqual([
      {
        Action: ['acm:DescribeCertificate', 'acm:ListTagsForCertificate'],
        Effect: 'Allow',
        Resource: anyCertificate,
      },
      { Action: 'acm:DeleteCertificate', Effect: 'Allow', Resource: anyCertificate, Condition: ownedById },
      { Action: 'acm:DeleteCertificate', Effect: 'Allow', Resource: anyCertificate, Condition: ownedByNameWithoutId },
    ]);
  });

  it('puts the certificate ARN in its ResourceProperties entry', () => {
    const stack = newTestStack('CertificatePropertiesStack');

    expect(newCertificateRemoval(stack).crProperties()).toEqual({
      certArn: 'arn:aws:acm:us-west-2:123456789012:certificate/test-cert',
    });
  });

  it('skips to the next step when no certificate is in the execution input, else sweeps it for the root stack', () => {
    const stack = newTestStack('CertificateChainStack');

    const definition = renderRemovalChain(stack, newCertificateRemoval(stack));

    expect(definition).toContain('"StartAt":"CertHasTarget"');
    expect(stateBodyOf(definition, 'CertHasTarget')).toContain('"Variable":"$.toSweep.cert"');
    expect(stateBodyOf(definition, 'CertHasTarget')).toContain('"Default":"Done"');
    expect(stateBodyOf(definition, 'CertInvoke')).toContain('"certArn.$":"$.toSweep.cert.certArn"');
    expect(stateBodyOf(definition, 'CertInvoke')).toContain('"rootStackName":"CertificateChainStack"');
    expect(stateBodyOf(definition, 'CertInvoke')).toContain('"rootStackId":');
  });
});
