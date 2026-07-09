// TEMPORARY audit harness (not part of the build): renders the edge-deployer worker policy and
// sweeper worker policy so the generated IAM can be re-audited without a full app build.
import { App, Stack } from 'aws-cdk-lib';
import { Code } from 'aws-cdk-lib/aws-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { MailboxEdgeDeployer } from '../src/edge/mailbox-edge-deployer';
import { SweeperInfra } from '../src/features/sweeper/sweeper-infra';

const stubResolver: ICdkArtifactEngine = {
  getCode: (_p: string, _o: string, _r?: string) => Code.fromInline('exports.handler=()=>{};'),
  getUrl: (p: string, o: string, _r?: string) => `https://stub-bucket.s3.amazonaws.com/${p}/${o}`,
  getArn: (p: string, o: string, _r?: string) => `arn:aws:s3:::stub-bucket/${p}/${o}`,
  getVersion: (_p: string) => '0.0.0',
  getBucketBase: () => 'stub-bucket',
  resolve: (p: string, o: string, _r?: string) => ({ bucket: 'stub-bucket', key: `${p}/${o}`, versionId: 'v1' }),
};

const app = new App();
const stack = new Stack(app, 'synth-check');

new MailboxEdgeDeployer(stack, 'edge-deployer', {
  artifactResolver: stubResolver,
  domainName: 'example.com',
  hostedZoneId: 'Z0000000000000',
  hostedZoneName: 'example.com',
  itemTableArn: 'arn:aws:dynamodb:eu-west-1:111111111111:table/items',
  configTableArn: 'arn:aws:dynamodb:eu-west-1:111111111111:table/config',
  authKeyStoreTableArn: 'arn:aws:dynamodb:eu-west-1:111111111111:table/authkeys',
  productVersion: '0.0.0',
});

new SweeperInfra(stack, 'sweeper', { artifactResolver: stubResolver });

const template = app.synth().getStackByName('synth-check').template;

for (const [lid, res] of Object.entries<any>(template.Resources)) {
  if (res.Type === 'AWS::IAM::Policy' || res.Type === 'AWS::IAM::ManagedPolicy') {
    console.log(`\n===== ${res.Type} ${lid} =====`);
    console.log(JSON.stringify(res.Properties.PolicyDocument.Statement, null, 1));
  }
}
