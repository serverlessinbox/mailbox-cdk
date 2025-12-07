#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MailboxStack } from './mailbox-stack';
import { LocalLambdaCodeProvider } from './utils/local-lambda-code-provider';
import { UrlLambdaCodeProvider } from './utils/url-lambda-code-provider';

const app = new cdk.App();

const mode = app.node.tryGetContext('lambdaMode') || 'local';
let codeProvider;

if (mode === 'local') {
  const lambdasRepoPath =
    app.node.tryGetContext('lambdasRepoPath') || '../../mailbox-lambdas';

  codeProvider = new LocalLambdaCodeProvider({
    lambdasRepoPath,
    autoBuild: true,
  });
} else if (mode === 'url') {
  const baseUrl = app.node.tryGetContext('lambdasBaseUrl');
  if (!baseUrl) {
    throw new Error(
      'lambdasBaseUrl context required for URL mode. ' +
      'Usage: cdk deploy -c lambdaMode=url -c lambdasBaseUrl=https://...'
    );
  }

  const cacheDir =
    app.node.tryGetContext('lambdasCacheDir') || '.cdk-lambda-cache';

  codeProvider = new UrlLambdaCodeProvider({    
    baseUrl,
    cacheDir,
  });
} else {
  throw new Error(`Unknown lambdaMode: ${mode}. Use 'local' or 'url'.`);
}

new MailboxStack(app, 'jmap-mailbox', {
  codeProvider,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
