/// <reference types="jest" />

/**
 * AuthKeyStoreUpdaterLambda auth-key-store grant tests (grant-concept unit A).
 *
 * Verifies AuthKeyStoreUpdaterLambda.grantReadWrite grants exactly DynamoDbActions.readWrite on
 * the auth-key-store table (and nothing broader, e.g. no Scan/PartiQL), and that the table-name
 * env var is present.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf, statementsForResource }     from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { PolicyStatementJson }             from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { DynamoDbActions }                      from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { AuthKeyStoreTable }                    from '../../tables/auth-key-store-table';
import { AuthKeyStoreUpdaterLambda }            from '../auth-key-store-updater-lambda';

describe('AuthKeyStoreUpdaterLambda auth-key-store grant', () => {
  let stack: cdk.Stack;
  let template: Template;
  let authKeyStoreTable: AuthKeyStoreTable;

  beforeEach(() => {
    const app = new App();

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactPin> = {
      'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    const artifactResolver: IArtifactResolver   = new PinnedArtifactResolver({
      packages,
      location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    authKeyStoreTable = new AuthKeyStoreTable(stack, 'auth-key-store');

    new AuthKeyStoreUpdaterLambda(stack, 'auth-key-store-updater', {
      issuers: ['https://issuer.example.com'],
      authKeyStoreTable,
      artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  function authKeyStoreStatements(): PolicyStatementJson[] {
    const expectedResource = stack.resolve([
      authKeyStoreTable.tableArn,
      `${authKeyStoreTable.tableArn}/index/*`,
    ]);

    return statementsForResource(template, expectedResource);
  }

  it('grants exactly DynamoDbActions.readWrite, Allow, on the table + index resources', () => {
    const expectedResource = stack.resolve([
      authKeyStoreTable.tableArn,
      `${authKeyStoreTable.tableArn}/index/*`,
    ]);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectEquals({
            Action: Match.arrayEquals([...DynamoDbActions.readWrite]),
            Effect: 'Allow',
            Resource: expectedResource,
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

  it('is invoked by the 6-hourly refresh and by the stack-deployed event', () => {
    const targets = [{ Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^authkeystoreupdater'), 'Arn'] }, Id: 'Target0' }];

    template.resourceCountIs('AWS::Events::Rule', 2);
    template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(6 hours)', Targets: targets });
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({ source: ['aws.cloudformation'] }),
      Targets: targets,
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
});
