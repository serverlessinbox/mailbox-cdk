import { Template }                      from 'aws-cdk-lib/assertions';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { DynamicClientRegistrationMode } from '../../packages/mailbox-cognito/src/user-pool/dynamic-client-registration-mode';
import { MailboxUserPool }               from '../../packages/mailbox-cognito/src/user-pool/mailbox-user-pool';
import { MailboxCognitoDataStack }       from '../../packages/mailbox-cognito/src/data-stack/mailbox-cognito-data-stack';
import { StackUpdateAddonProvider }      from '../../packages/mailbox/src/platform/update/stack-update-addon';
import { SupportAddonProvider }          from '../../packages/mailbox/src/platform/support/support-addon-provider';
import { SupportMode }                   from '../../packages/mailbox/src/platform/support/support-addon';
import { AutoUpdater }                   from '../../packages/mailbox/src/platform/update/auto-updater';
import { MailboxDataStack }              from '../../packages/mailbox/src/data/mailbox-data-stack';
import { MailboxEdgeStack }              from '../../packages/mailbox/src/edge/mailbox-edge-stack';
import { SendStackFailuresMode }         from '../../packages/mailbox/src/features/stack-failure-detection';
import { Mailbox }                       from '../../packages/mailbox/src/mailbox';

import type { FrozenProcessValues }      from './frozen-process-values';
import type { StackTemplate }            from './stack-template';
import type { TemplateJsonParser }       from './template-json-parser';

const BASELINE_ACCOUNT = '123456789012';
const BASELINE_REGION  = 'us-west-2';
const EDGE_REGION      = 'us-east-1';

/**
 * Synthesizes every stack the product deploys, with fixed props and an explicit environment so no
 * synth needs credentials or an AWS lookup: the main `Mailbox` stack with every optional feature that
 * adds resources switched on, the edge stack, the data stack and the cognito data stack. It does not
 * judge the templates; it only produces them, with the clock and random numbers frozen.
 */
export class BaselineSynthesizer {
  constructor(
    private readonly frozenValues: FrozenProcessValues,
    private readonly parser: TemplateJsonParser,
  ) {}

  synthesize(): StackTemplate[] {
    return this.frozenValues.run(() => [
      this.stackTemplate('mailbox', this.createMailboxStack()),
      this.stackTemplate('edge', this.createEdgeStack()),
      this.stackTemplate('data', this.createDataStack()),
      this.stackTemplate('cognito-data', this.createCognitoDataStack()),
    ]);
  }

  private stackTemplate(stackName: string, stack: cdk.Stack): StackTemplate {
    const template = this.parser.parse(JSON.stringify(Template.fromStack(stack).toJSON()), `Synthesized template of ${stackName}`);
    return { stackName, template };
  }

  /** The main stack with a Cognito user pool as auth provider and every optional feature switched on. */
  private createMailboxStack(): cdk.Stack {
    const app   = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'baseline-artifacts',
          packages: {
            'mailbox-go': { zone: 'regional', version: '1.0.0' },
            'mailbox-cdk': { zone: 'regional', version: '1.0.0' },
            'mailbox-cdk-shared': { zone: 'regional', version: '1.0.0' },
            'mailbox-cdk-edge': { zone: 'edge', version: '1.0.0' },
            'mailbox-admin-ui': { zone: 'regional', version: '1.0.0' },
            'mailbox-webmail-ui': { zone: 'regional', version: '1.0.0' },
            'mailbox-cognito': { zone: 'regional', version: '1.0.0' },
          },
        },
        'serverlessinbox:artifact_versions': {},
      },
    });
    const stack = this.createStack(app, 'BaselineMailbox', BASELINE_REGION);

    const autoUpdater  = new AutoUpdater(stack, 'auto-updater');
    const authProvider = new MailboxUserPool(stack, 'user-pool', {
      domain: { kind: 'cognito', cognitoDomainPrefix: 'baseline-auth' },
      enableJmapOAuthDiscovery: true,
      dynamicClientRegistration: DynamicClientRegistrationMode.ENABLED,
    });
    authProvider.addBootstrapUser({ username: 'baseline-admin', groups: ['admin'] });
    new Mailbox(stack, 'mailbox', {
      authProvider,
      hostedZoneId: 'Z1234567890ABC',
      enableMcp: true,
      enableReceiving: 'on',
      sendStackFailures: SendStackFailuresMode.ENABLED,
      artifactResolver: autoUpdater,
      adminApiAddonProviders: [
        autoUpdater,
        new StackUpdateAddonProvider({ artifactResolver: autoUpdater, templateName: 'mailbox-standard', templateVersion: '1.0.0' }),
        new SupportAddonProvider({ mode: SupportMode.ENABLED }),
      ],
    });
    return stack;
  }

  private createEdgeStack(): cdk.Stack {
    return new MailboxEdgeStack(new App(), 'BaselineEdge', {
      env: { account: BASELINE_ACCOUNT, region: EDGE_REGION },
      synthesizer: new BootstraplessSynthesizer(),
    });
  }

  private createDataStack(): cdk.Stack {
    return new MailboxDataStack(new App(), 'BaselineData', {
      env: { account: BASELINE_ACCOUNT, region: BASELINE_REGION },
      synthesizer: new BootstraplessSynthesizer(),
    });
  }

  private createCognitoDataStack(): cdk.Stack {
    return new MailboxCognitoDataStack(new App(), 'BaselineCognitoData', {
      env: { account: BASELINE_ACCOUNT, region: BASELINE_REGION },
      synthesizer: new BootstraplessSynthesizer(),
    });
  }

  private createStack(app: App, id: string, region: string): cdk.Stack {
    return new cdk.Stack(app, id, {
      env: { account: BASELINE_ACCOUNT, region },
      synthesizer: new BootstraplessSynthesizer(),
    });
  }
}
