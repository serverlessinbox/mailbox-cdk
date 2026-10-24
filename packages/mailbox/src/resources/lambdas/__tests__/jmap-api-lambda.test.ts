/// <reference types="jest" />

/**
 * JmapApiLambda: the read-only grant on the auth-key-store table, the table-name environment variable, the
 * OAUTH_HANDLER_CONFIG value, which carries the scope map the Go handler reads and no other field, and the
 * OAUTH_PROTECTED_RESOURCE_URL variable, which is set only when the caller supplies the URL.
 */

import { VENDOR_ACCOUNT_ID }                    from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import { Function as LambdaFunction }           from 'aws-cdk-lib/aws-lambda';
import { Bucket }                               from 'aws-cdk-lib/aws-s3';
import type * as cdk                            from 'aws-cdk-lib';

import { Permission }                           from '../../../core/auth/jmap-scopes';
import { DataBlobStore }                        from '../../buckets/data-blob-store';
import { AuditEventsQueue }                     from '../../queues/audit-events-queue';
import { EmailSendingQueue }                    from '../../queues/email-sending-queue';
import { AuthKeyStoreTable }                    from '../../tables/auth-key-store-table';
import { DataTable }                            from '../../tables/data-tables';
import { JmapApiLambda }                        from '../jmap-api-lambda';

import { arrangeWrapperStack }                  from './lambda-wrapper-helpers';

describe('JmapApiLambda', () => {
  let stack: cdk.Stack;
  let template: Template;
  let authKeyStoreTable: AuthKeyStoreTable;

  function buildTemplate(oauthProtectedResourceUrl?: string): Template {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;

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
      cdnHost:             'cdn.example.com',
      apiBaseUrl:          'https://jmap.example.com',
      artifactResolver:    arrangement.artifactResolver,
      identityProvisioner: identityProvisionerFunction,
      scopeMap:            { 'mail.read': [Permission.MAIL_READ] },
      vendorAccountIds:    [VENDOR_ACCOUNT_ID],
      oauthProtectedResourceUrl,
    });

    return Template.fromStack(stack);
  }

  beforeEach(() => {
    template = buildTemplate();
  });

  function authKeyStoreResources(): unknown {
    return stack.resolve([
      authKeyStoreTable.tableArn,
      `${authKeyStoreTable.tableArn}/index/*`,
    ]);
  }

  it('grants exactly the read actions, Allow, on the table + index resources', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectEquals({
            Action:   Match.arrayEquals(['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query']),
            Effect:   'Allow',
            Resource: Match.exact(authKeyStoreResources()),
          }),
        ]),
      },
    });
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

  it('omits OAUTH_PROTECTED_RESOURCE_URL from the function environment when no URL is supplied', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.not(Match.objectLike({
          OAUTH_PROTECTED_RESOURCE_URL: Match.anyValue(),
        })),
      },
    });
  });

  it('sets OAUTH_PROTECTED_RESOURCE_URL to the supplied URL', () => {
    const withUrl = buildTemplate('https://jmap.example.com/.well-known/oauth-protected-resource');

    withUrl.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          OAUTH_PROTECTED_RESOURCE_URL: 'https://jmap.example.com/.well-known/oauth-protected-resource',
        }),
      },
    });
  });
});
