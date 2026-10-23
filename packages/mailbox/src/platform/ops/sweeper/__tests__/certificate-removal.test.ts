/// <reference types="jest" />

/**
 * CertificateRemoval: the grants, `ResourceProperties` entry and state-machine steps for sweeping an
 * ACM certificate. Deleting a certificate is gated on the root-stack tag, so a dropped condition
 * lets the sweeper delete a certificate another stack owns; reads stay unconditioned because
 * the worker has to look at a certificate before it can tell whether this stack owns it.
 */

import { stateBodyOf } from '../../../../__tests__/state-machine-helpers';

import {
  newCertificateRemoval,
  newTestStack,
  OWNED_BY_STACK_ID,
  OWNED_BY_STACK_NAME_WITHOUT_ID,
  nameOfStateWhere,
  renderRemovalChain,
  resolveStatements,
  startStateOf,
  stateOf,
} from './sweeper-helpers';

describe('CertificateRemoval', () => {
  const anyCertificate = {
    'Fn::Join': [
      '',
      ['arn:', { Ref: 'AWS::Partition' }, ':acm:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':certificate/*'],
    ],
  };

  it('reads certificates unconditioned and deletes them only when the root stack owns them, by id or by name without an id tag', () => {
    const stack = newTestStack('CertificateGrantsStack');

    const statements = resolveStatements(stack, newCertificateRemoval(stack).grantStatements());

    expect(statements).toEqual([
      {
        Action:   ['acm:DescribeCertificate', 'acm:ListTagsForCertificate'],
        Effect:   'Allow',
        Resource: anyCertificate,
      },
      { Action: 'acm:DeleteCertificate', Effect: 'Allow', Resource: anyCertificate, Condition: OWNED_BY_STACK_ID },
      { Action: 'acm:DeleteCertificate', Effect: 'Allow', Resource: anyCertificate, Condition: OWNED_BY_STACK_NAME_WITHOUT_ID },
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
    const guard      = startStateOf(definition);
    const invoke     = nameOfStateWhere(definition, (state) => state.Type === 'Task');

    expect(stateBodyOf(definition, guard)).toContain('"Variable":"$.toSweep.cert"');
    expect(stateOf(definition, guard).Default).toBe('Done');
    expect(stateOf(definition, guard).Choices?.[0]?.Next).toBe(invoke);
    expect(stateBodyOf(definition, invoke)).toContain('"certArn.$":"$.toSweep.cert.certArn"');
    expect(stateBodyOf(definition, invoke)).toContain('"rootStackName":"CertificateChainStack"');
    expect(stateBodyOf(definition, invoke)).toContain('"rootStackId":');
  });
});
