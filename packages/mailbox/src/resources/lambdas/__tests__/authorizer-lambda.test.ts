/// <reference types="jest" />

/**
 * AuthorizerLambda auth-key-store grant tests (grant-concept unit A).
 *
 * Verifies AuthorizerLambda.grantRead grants exactly the read actions on the auth-key-store
 * table (and nothing broader, e.g. no Scan/PartiQL), and that the table-name env var is present.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf, statementsForResource }     from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { PolicyStatementJson }             from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { AuthKeyStoreTable }                    from '../../tables/auth-key-store-table';
import { DataTable }                            from '../../tables/data-tables';
import { AuthorizerLambda }                     from '../authorizer-lambda';

describe('AuthorizerLambda auth-key-store grant', () => {
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

    const configTable = new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    });
    authKeyStoreTable = new AuthKeyStoreTable(stack, 'auth-key-store');

    new AuthorizerLambda(stack, 'authorizer', {
      authKeyStoreTable,
      configTable: new DataTable(configTable),
      artifactResolver,
      authPolicyName:  'ADMIN_API',
      anonymousRoutes: ['GET /first', 'GET /second'],
      serviceName:     'jmap',
      pipeline:        'jmap',
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

  it('passes the auth policy name and the anonymous routes on as given', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          AUTH_POLICY_NAME:       'ADMIN_API',
          ALLOW_ANONYMOUS_ROUTES: 'GET /first,GET /second',
        }),
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
});
