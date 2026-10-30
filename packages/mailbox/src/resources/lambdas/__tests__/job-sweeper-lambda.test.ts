/// <reference types="jest" />

/**
 * JobSweeperLambda tests: the environment the sweeper is given, the item-table grant it gives itself, its memory and
 * timeout, and the schedule it registers. Read from the synthesized template with a real item table.
 */

import { ArtifactZone, PinnedArtifactResolver }    from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                         from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                    from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                    from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, Duration } from 'aws-cdk-lib';

import { resourcesOfType }                         from '../../../__tests__/iam-test-helpers';
import { DataTable }                               from '../../tables/data-tables';
import { JobSweeperLambda }                        from '../job-sweeper-lambda';

const SWEEPER_ENVIRONMENT_NAMES = ['ITEM_TABLE_NAME', 'JOB_STALE_AFTER', 'SERVICE_NAME', 'SWEEP_INTERVAL'];
const ITEM_TABLE_ACTIONS        = ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'];

interface FunctionProperties {
  readonly Environment: { readonly Variables: Record<string, string> };
  readonly Timeout:     number;
  readonly MemorySize:  number;
}

function arrangeSweeper() {
  const stack     = new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const itemTable = new DataTable(new Table(stack, 'item-table', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
    sortKey:      { name: 'sk', type: AttributeType.STRING },
  }));
  new JobSweeperLambda(stack, 'job-sweeper', {
    artifactResolver: new PinnedArtifactResolver({
      packages:         {
        'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        'mailbox-go':  { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      },
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    }),
    itemTable,
    sweepInterval: Duration.minutes(15),
    staleAfter:    Duration.hours(2),
  });

  return { stack, template: Template.fromStack(stack), itemTable };
}

function sweeperProperties(template: Template): FunctionProperties {
  const sweepers = resourcesOfType<FunctionProperties>(template, 'AWS::Lambda::Function')
    .filter((properties) => 'JOB_STALE_AFTER' in properties.Environment.Variables);
  expect(sweepers).toHaveLength(1);
  return sweepers[0];
}

describe('JobSweeperLambda', () => {
  it('gives the function exactly the environment names its Go config reads, with both periods in seconds', () => {
    const { template } = arrangeSweeper();

    const variables = sweeperProperties(template).Environment.Variables;
    expect(Object.keys(variables).sort()).toEqual([...SWEEPER_ENVIRONMENT_NAMES].sort());
    expect(variables.JOB_STALE_AFTER).toBe('7200s');
    expect(variables.SWEEP_INTERVAL).toBe('900s');
  });

  it('runs with 256 MB of memory and a 5 minute timeout', () => {
    const { template } = arrangeSweeper();

    const sweeper = sweeperProperties(template);
    expect(sweeper.MemorySize).toBe(256);
    expect(sweeper.Timeout).toBe(300);
  });

  it('grants the item table read and write with the actions the sweeper calls', () => {
    const { template, stack, itemTable } = arrangeSweeper();
    const itemTableArn: unknown          = stack.resolve(itemTable.tableArn);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: ITEM_TABLE_ACTIONS, Resource: Match.arrayWith([itemTableArn]) })]),
      },
    });
  });

  it('registers a schedule that invokes it every 15 minutes', () => {
    const { template } = arrangeSweeper();

    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(15 minutes)',
    });
  });
});
