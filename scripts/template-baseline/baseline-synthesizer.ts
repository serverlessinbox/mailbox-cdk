import { ArtifactZone, type ArtifactPin }                       from '@serverlessinbox/artifact-registry-cdk';
import { Template }                                             from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, Stack }                 from 'aws-cdk-lib';

import { ARTIFACT_VERSIONS_CONTEXT_KEY, ARTIFACTS_CONTEXT_KEY } from '../../packages/mailbox-cdk-shared/src/context/context-keys';
import { DynamicClientRegistrationMode }                        from '../../packages/mailbox-cognito/src/user-pool/dynamic-client-registration-mode';
import { MailboxUserPool }                                      from '../../packages/mailbox-cognito/src/user-pool/mailbox-user-pool';
import { HostedZoneLookup }                                     from '../../packages/mailbox/src/core/domains/hosted-zone-lookup';
import { Mailbox }                                              from '../../packages/mailbox/src/mailbox';
import { SendStackFailuresMode }                                from '../../packages/mailbox/src/platform/ops/stack-failure-detection';
import { SupportAddonProvider }                                 from '../../packages/mailbox/src/platform/support/support-addon-provider';
import { SupportMode }                                          from '../../packages/mailbox/src/platform/support/support-addon';
import { AutoUpdater }                                          from '../../packages/mailbox/src/platform/update/auto-updater';
import { StackUpdateAddonProvider }                             from '../../packages/mailbox/src/platform/update/stack-update-addon-provider';
import { StandaloneStackFactory }                               from '../stacks/standalone-stack-factory';
import { parseJsonObject }                                      from '../utils/json-value';

import type { FrozenProcessValues }                             from './frozen-process-values';
import type { StackTemplate }                                   from './stack-template';

const BASELINE_ACCOUNT     = '123456789012';
const BASELINE_REGION      = 'us-west-2';
const BASELINE_ENVIRONMENT = { account: BASELINE_ACCOUNT, region: BASELINE_REGION };

/** The packages of the `serverlessinbox:artifacts` context value, keyed by package name. */
interface ArtifactPackagesContext {
  readonly [packageName: string]: ArtifactPin;
}

/** The S3 object-version map of the `serverlessinbox:artifact_versions` context value, keyed by object key. */
interface ArtifactVersionsContext {
  readonly [objectKey: string]: string;
}

/** The app context the baseline stack reads: the artifact bucket and packages, and the pinned versions. */
type BaselineAppContext = {
  readonly [ARTIFACTS_CONTEXT_KEY]:         { readonly bucketBase: string; readonly packages: ArtifactPackagesContext };
  readonly [ARTIFACT_VERSIONS_CONTEXT_KEY]: ArtifactVersionsContext;
};

/**
 * Synthesizes the templates with fixed props and an explicit environment, so no synth needs
 * credentials or an AWS lookup. Every optional feature that adds resources is switched on, so a
 * change to any of them shows in the templates. It does not judge the templates; it only produces
 * them, with the clock and random numbers frozen.
 */
export class BaselineSynthesizer {
  private readonly stackFactory = new StandaloneStackFactory('Baseline', BASELINE_ENVIRONMENT, BASELINE_ENVIRONMENT);

  constructor(private readonly frozenValues: FrozenProcessValues) {}

  synthesize(): StackTemplate[] {
    return this.frozenValues.run(() => [
      this.stackTemplate('mailbox', this.createMailboxStack()),
      this.stackTemplate('edge', this.createEdgeStack()),
      this.stackTemplate('data', this.createDataStack()),
      this.stackTemplate('cognito-data', this.createCognitoDataStack()),
    ]);
  }

  private stackTemplate(stackName: string, stack: Stack): StackTemplate {
    const template = parseJsonObject(JSON.stringify(Template.fromStack(stack).toJSON()), `Synthesized template of ${stackName}`);
    return { stackName, template };
  }

  /** The app context of the main stack: every package resolves from the baseline bucket at version 1.0.0. */
  private artifactContext(): BaselineAppContext {
    return {
      [ARTIFACTS_CONTEXT_KEY]:         {
        bucketBase: 'baseline-artifacts',
        packages:   {
          'mailbox-go':         { zone: ArtifactZone.REGIONAL, version: '1.0.0' },
          'mailbox-cdk':        { zone: ArtifactZone.REGIONAL, version: '1.0.0' },
          'mailbox-cdk-shared': { zone: ArtifactZone.REGIONAL, version: '1.0.0' },
          'mailbox-cdk-edge':   { zone: ArtifactZone.EDGE, version: '1.0.0' },
          'mailbox-admin-ui':   { zone: ArtifactZone.REGIONAL, version: '1.0.0' },
          'mailbox-webmail-ui': { zone: ArtifactZone.REGIONAL, version: '1.0.0' },
          'mailbox-cognito':    { zone: ArtifactZone.REGIONAL, version: '1.0.0' },
        },
      },
      [ARTIFACT_VERSIONS_CONTEXT_KEY]: {},
    };
  }

  /** The main stack with a Cognito user pool as auth provider and every optional feature switched on. */
  private createMailboxStack(): Stack {
    const app   = new App({ context: this.artifactContext() });
    const stack = this.createStack(app, 'BaselineMailbox', BASELINE_REGION);

    const autoUpdater  = new AutoUpdater(stack, 'auto-updater');
    const authProvider = new MailboxUserPool(stack, 'user-pool', {
      domain:                    { kind: 'cognito', cognitoDomainPrefix: 'baseline-auth' },
      enableJmapOAuthDiscovery:  true,
      dynamicClientRegistration: DynamicClientRegistrationMode.ENABLED,
    });
    authProvider.addBootstrapUser({ username: 'baseline-admin', groups: ['admin'] });
    const hostedZone = new HostedZoneLookup(stack, 'hosted-zone-lookup', { hostedZoneId: 'Z1234567890ABC', artifactResolver: autoUpdater }).hostedZone;
    new Mailbox(stack, 'mailbox', {
      authProvider,
      hostedZone,
      enableMcp:              true,
      enableReceiving:        'on',
      sendStackFailures:      SendStackFailuresMode.ENABLED,
      artifactResolver:       autoUpdater,
      adminApiAddonProviders: [
        autoUpdater,
        new StackUpdateAddonProvider({ artifactResolver: autoUpdater, templateName: 'mailbox-standard', templateVersion: '1.0.0' }),
        new SupportAddonProvider({ mode: SupportMode.ENABLED }),
      ],
    });
    return stack;
  }

  private createEdgeStack(): Stack {
    return this.stackFactory.createEdgeStack(new App());
  }

  private createDataStack(): Stack {
    return this.stackFactory.createDataStack(new App());
  }

  private createCognitoDataStack(): Stack {
    return this.stackFactory.createCognitoDataStack(new App());
  }

  private createStack(app: App, id: string, region: string): Stack {
    return new Stack(app, id, {
      env:         { account: BASELINE_ACCOUNT, region },
      synthesizer: new BootstraplessSynthesizer(),
    });
  }
}
