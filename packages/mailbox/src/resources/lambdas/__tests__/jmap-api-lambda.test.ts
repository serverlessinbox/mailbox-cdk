/// <reference types="jest" />

/**
 * JmapApiLambda (jmap-api) auth-key-store grant and OAuth config tests.
 *
 * Verifies JmapApiLambda.grantRead grants exactly DynamoDbActions.read on the auth-key-store
 * table (and nothing broader, e.g. no Scan/PartiQL), that the table-name env var is present, and
 * that OAUTH_HANDLER_CONFIG carries the scope map the Go handler reads and no other field.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf, statementsForResource }     from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { PolicyStatementJson }             from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { DynamoDbActions, VENDOR_ACCOUNT_ID }   from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import { Function as LambdaFunction }           from 'aws-cdk-lib/aws-lambda';
import { Bucket }                               from 'aws-cdk-lib/aws-s3';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { Permission }                           from '../../../core/auth/jmap-scopes';
import { DataBlobStore }                        from '../../buckets/data-blob-store';
import { AuditEventsQueue }                     from '../../queues/audit-events-queue';
import { EmailSendingQueue }                    from '../../queues/email-sending-queue';
import { AuthKeyStoreTable }                    from '../../tables/auth-key-store-table';
import { DataTable }                            from '../../tables/data-tables';
import { JmapApiLambda }                        from '../jmap-api-lambda';

describe('JmapApiLambda', () => {
  let stack: cdk.Stack;
  let template: Template;
  let authKeyStoreTable: AuthKeyStoreTable;

  beforeEach(() => {
    const app = new App();

    stack = new cdk.Stack(app, 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactPin> = {
      'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    const artifactResolver: IArtifactResolver   = new PinnedArtifactResolver({
      packages,
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    const configTable                 = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const itemTable                   = new DataTable(new Table(stack, 'item-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const changelogTable              = new DataTable(new Table(stack, 'changelog-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    authKeyStoreTable                 = new AuthKeyStoreTable(stack, 'auth-key-store');
    const blobStore                   = new DataBlobStore(new Bucket(stack, 'blob-store'));
    const emailSubmissionQueue        = new EmailSendingQueue(stack, 'email-submission-queue');
    const auditEventsQueue            = new AuditEventsQueue(stack, 'audit-events-queue');
    const identityProvisionerFunction = LambdaFunction.fromFunctionArn(
      stack,
      'identity-provisioner-ref',
      'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
    );

    new JmapApiLambda(stack, 'jmap-api', {
      configTable,
      itemTable,
      changelogTable,
      authKeyStoreTable,
      blobStore,
      emailSubmissionQueue,
      auditEventsQueue,
      cdnHost:    'cdn.example.com',
      apiBaseUrl: 'https://jmap.example.com',
      artifactResolver,
      identityProvisioner: identityProvisionerFunction,
      scopeMap:            { 'mail.read': [Permission.MAIL_READ] },
      vendorAccountIds:    [VENDOR_ACCOUNT_ID],
    });

    template = Template.fromStack(stack);
  });

  function authKeyStoreResources(): unknown {
    return stack.resolve([
      authKeyStoreTable.tableArn,
      `${authKeyStoreTable.tableArn}/index/*`,
    ]);
  }

  function authKeyStoreStatements(): PolicyStatementJson[] {
    return statementsForResource(template, authKeyStoreResources());
  }

  it('grants exactly DynamoDbActions.read, Allow, on the table + index resources', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectEquals({
            Action:   Match.arrayEquals([...DynamoDbActions.read]),
            Effect:   'Allow',
            Resource: Match.exact(authKeyStoreResources()),
          }),
        ]),
      },
    });
  });

  it('grants no Scan/PartiQL and no Deny on the auth-key-store table', () => {
    const statements  = authKeyStoreStatements();
    const actionsFlat = statements.flatMap(actionsOf);

    expect(actionsFlat).not.toContain('dynamodb:Scan');
    expect(actionsFlat.some((action) => typeof action === 'string' && action.startsWith('dynamodb:PartiQL'))).toBe(false);
    expect(statements.some((statement) => statement.Effect === 'Deny')).toBe(false);
  });

  it('sets AUTH_KEY_STORE_TABLE_NAME on the function environment', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          AUTH_KEY_STORE_TABLE_NAME: Match.anyValue(),
        }),
      },
    });
  });

  it('sets OAUTH_HANDLER_CONFIG to the scope map and nothing else, the only field the Go handler uses', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          OAUTH_HANDLER_CONFIG: JSON.stringify({ scopeMap: { 'mail.read': [Permission.MAIL_READ] } }),
        }),
      },
    });
  });
});
