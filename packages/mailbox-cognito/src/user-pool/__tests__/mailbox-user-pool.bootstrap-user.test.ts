/// <reference types="jest" />

/**
 * Pins the properties `addBootstrapUser` hands to the bootstrap user Lambda. The Lambda reads them through the
 * type the construct also writes them with; this suite checks the template carries the keys the Lambda is
 * tested with, so a key renamed on one side is caught. A key the Lambda does not read is ignored silently, which
 * would leave the user created with the wrong name, groups or password.
 */

import { MailboxArtifactResolverFactory }       from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                             from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import * as t                                   from 'typanion';

import { loadMailboxCognitoArtifactVersions }   from '../../mailbox-cognito-artifact-versions';
import { loadMailboxCognitoRegistryRecord }     from '../../mailbox-cognito-registry-record';
import { templateProperties }                   from '../../runtime/bootstrap-user/__tests__/bootstrap-user-helpers';
import { MailboxUserPool }                      from '../mailbox-user-pool';

const BOOTSTRAP_USER_TYPE = 'Custom::CognitoBootstrapUser';

const isPropertyValue = t.isOneOf([t.isString(), t.isNumber(), t.isBoolean(), t.isArray(t.isString()), t.isPartial({})]);

const isBootstrapUserResource = t.isPartial({ Properties: t.isRecord(isPropertyValue) });

function synthesizeBootstrapUser(passwordMinLength?: number): Record<string, t.InferType<typeof isPropertyValue>> {
  const app   = new App({
    context: {
      'serverlessinbox:artifacts':         {
        bucketBase: 'test-artifacts',
        packages:   {
          'mailbox-cognito':    { zone: 'regional', version: '0.0.1-test' },
          'mailbox-cdk':        { zone: 'regional', version: '0.0.1-test' },
          'mailbox':            { zone: 'regional', version: '0.0.1-test' },
          'mailbox-cdk-shared': { zone: 'regional', version: '0.0.1-test' },
        },
      },
      'serverlessinbox:artifact_versions': {},
    },
  });
  const stack = new Stack(app, 'TestBootstrapUser', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const pool  = new MailboxUserPool(stack, 'user-pool', {
    domain:           { kind: 'cognito', cognitoDomainPrefix: 'test-bootstrap' },
    artifactResolver: MailboxArtifactResolverFactory.fromContext(stack, loadMailboxCognitoRegistryRecord(), loadMailboxCognitoArtifactVersions()),
    ...(passwordMinLength !== undefined ? { passwordMinLength } : {}),
  });

  pool.addBootstrapUser({ username: 'admin', groups: ['admin'], temporaryPassword: 'Temp1Password' });

  const resources  = Template.fromStack(stack).findResources(BOOTSTRAP_USER_TYPE);
  const [resource] = Object.values(resources);

  const errors: string[] = [];
  if (!isBootstrapUserResource(resource, { errors })) {
    throw new Error(`The ${BOOTSTRAP_USER_TYPE} resource has an unexpected shape: ${errors.join('; ')}`);
  }
  return resource.Properties;
}

describe('MailboxUserPool.addBootstrapUser', () => {
  it('writes the keys the bootstrap user Lambda is tested with, and the service timeout of four minutes', () => {
    const properties = synthesizeBootstrapUser();

    const lambdaKeys = Object.keys(templateProperties({ username: 'admin', groups: ['admin'], temporaryPassword: 'Temp1Password' }));
    expect(Object.keys(properties).sort()).toEqual(lambdaKeys.sort());
    expect(properties.ServiceTimeout).toBe(templateProperties().ServiceTimeout);
  });

  it('writes the pool default minimum length as the password length the Lambda reads', () => {
    expect(synthesizeBootstrapUser().passwordMinLength).toBe('8');
  });

  it('writes the pool minimum length it was configured with, so a generated password meets it', () => {
    expect(synthesizeBootstrapUser(20).passwordMinLength).toBe('20');
  });
});
