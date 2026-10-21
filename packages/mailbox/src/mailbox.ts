import type { IArtifactResolver }                                                                              from '@serverlessinbox/artifact-registry-cdk';
import { PipelineLogGroup, applyServerlessInboxComponentTag, setStackNameBase }                                from '@serverlessinbox/mailbox-cdk-shared';
import { addServerlessInboxResourceGroup, StackHelpers }                                                       from '@serverlessinbox/mailbox-cdk-shared';
import * as acm                                                                                                from 'aws-cdk-lib/aws-certificatemanager';
import type { IGrantable }                                                                                     from 'aws-cdk-lib/aws-iam';
import * as awslambda                                                                                          from 'aws-cdk-lib/aws-lambda';
import { IBucket }                                                                                             from 'aws-cdk-lib/aws-s3';
import { Fn }                                                                                                  from 'aws-cdk-lib';
import * as cdk                                                                                                from 'aws-cdk-lib';
import { Aws }                                                                                                 from 'aws-cdk-lib';
import { Construct, DependencyGroup }                                                                          from 'constructs';

import { AdminApi }                                                                                            from './api/admin/admin-api';
import { JMapApi }                                                                                             from './api/jmap/jmap-api';
import { McpApi }                                                                                              from './api/mcp/mcp-api';
import { WebSocketPush }                                                                                       from './api/websocket/websocket';
import type { IAdminApiAddon, AdminApiAddonContext, IJmapApiAddon, JmapApiAddonContext }                       from './api';
import type { IMailboxAuthProvider }                                                                           from './auth/types';
import { MailboxAddressing }                                                                                   from './core/domains/mailbox-addressing';
import type { IDataBlobStore }                                                                                 from './data/data-blob-store';
import type { IDataTable }                                                                                     from './data/data-tables';
import { MailboxDataDeployer }                                                                                 from './data';
import { MailboxDns }                                                                                          from './domains';
import { MailboxEdgeDeployer }                                                                                 from './edge';
import { SesRules }                                                                                            from './email/receiving/ses-rules';
import { EmailSending, SESEventProcessing }                                                                    from './email';
import { AuditWriting }                                                                                        from './features/audit-writing/audit-writing';
import { AuthKeyStore }                                                                                        from './features/auth-key-store/auth-key-store';
import { Bootstrap }                                                                                           from './features/bootstrap/bootstrap';
import { Cdn, type CdnCustomDomain }                                                                           from './features/cdn/cdn-construct';
import { LicenseRefresh }                                                                                      from './platform/ops/license-refresh';
import { StackFailureDetection, SendStackFailuresMode }                                                        from './platform/ops/stack-failure-detection';
import { DeferredRemoval }                                                                                  from './platform/ops/sweeper/deferred-removal';
import { SweeperInfra }                                                                                        from './platform/ops/sweeper/sweeper-infra';
import { CertificateRemoval }                                                                                  from './platform/ops/sweeper/certificate-removal';
import { EdgeFunctionRemoval }                                                                                 from './platform/ops/sweeper/edge-function-removal';
import { StackFailureDetectorRemoval }                                                                         from './platform/ops/sweeper/stack-failure-detector-removal';
import type { IResourceRemoval }                                                                               from './platform/ops/sweeper/removal';
import { EmailProcessorLambda }                                                                                from './resources/lambdas/email-processor-lambda';
import { IdentityProvisionerLambda }                                                                           from './resources/lambdas/identity-provisioner-lambda';
import { MailboxContext }                                                                                      from './mailbox-context';
import type { MailboxUrls, MailboxCertificates, MailboxOAuthClients }                                          from './mailbox-outputs';
import type { MailboxProps }                                                                                   from './mailbox-props';
import { TantivySearch }                                                                                       from './search';
import { AdminUi }                                                                                             from './ui/admin-ui';
import type { MailboxUi }                                                                                      from './ui/mailbox-ui';
import { WebmailUi }                                                                                           from './ui/webmail-ui';
import { resolveMailboxEncryptionPlan }                                                                        from './utils/mailbox-encryption';
import { MailboxResourceDescriptions }                                                                         from './utils/resource-descriptions';

/**
 * The complete Serverless Inbox mail server as one construct: data stack, email receiving and
 * sending, the Admin and JMAP APIs, WebSocket push, the Admin and Webmail UIs, the CDN and edge
 * stack, DNS, and the operational pieces around them (audit, license refresh, cleanup).
 *
 * Add it to your own stack and pass an `authProvider`. Optional capabilities are not built in:
 * you opt in through the props, for example `adminApiAddonProviders` and `artifactResolver`.
 */
export class Mailbox extends Construct {
  /** Grant-scoped handle to `blobStoreBucket`, for every consumer that only needs least-privilege object actions. */
  private readonly blobStoreHandle: IDataBlobStore;
  /**
   * The raw blob-store bucket, for call sites that need an actual `IBucket` (the CDN's CloudFront
   * S3 origin and the SES receipt rule's S3 delivery action), which `IDataBlobStore`'s grant-only
   * surface cannot provide.
   */
  private readonly blobStoreBucket: IBucket;
  private readonly emailProcessorLambda: EmailProcessorLambda;
  private readonly configTable: IDataTable;
  private readonly emailQueueProps: ReturnType<typeof resolveMailboxEncryptionPlan>['queues'];

  private readonly jmapApi: JMapApi;

  /**
   * The OAuth clients this Mailbox created for its UIs. A client is present only when its UI is
   * enabled.
   */
  public readonly oauthClients: MailboxOAuthClients;

  /** The public URLs of the endpoints this Mailbox serves. */
  public readonly urls: MailboxUrls;

  /** The ACM certificates this Mailbox created for itself. */
  public readonly certificates: MailboxCertificates;

  constructor(scope: Construct, id: string, props: MailboxProps) {
    super(scope, id);

    const authProvider: IMailboxAuthProvider = props.authProvider;

    // Resolved once here, as the composition root, and threaded down as props.
    const context                                                                                                 = MailboxContext.resolve(this, props);
    const { artifactResolver, stackVersion, deployerType, vendorAccountIds, stackIdentityTagKey, encryptionPlan } = context;

    // --- Group nodes (8 intermediate constructs for construct-tree grouping) ---
    const groups = {
      data:   new Construct(this, 'data'),
      auth:   new Construct(this, 'auth'),
      edge:   new Construct(this, 'edge'),
      ui:     new Construct(this, 'ui'),
      email:  new Construct(this, 'email'),
      apis:   new Construct(this, 'apis'),
      search: new Construct(this, 'search'),
      ops:    new Construct(this, 'ops'),
    };

    // Component tags on each group — CDK propagates to the whole subtree.
    applyServerlessInboxComponentTag(groups.data,   'data');
    applyServerlessInboxComponentTag(groups.auth,   'auth');
    applyServerlessInboxComponentTag(groups.edge,   'edge');
    applyServerlessInboxComponentTag(groups.ui,     'ui');
    applyServerlessInboxComponentTag(groups.email,  'email');
    applyServerlessInboxComponentTag(groups.apis,   'api');
    applyServerlessInboxComponentTag(groups.search, 'search');
    applyServerlessInboxComponentTag(groups.ops,    'ops');

    // Derive domain name and S3-safe stack name from hosted zone at deploy time.
    const effectiveDataStackName = cdk.Fn.join('', [cdk.Aws.STACK_NAME, '-data']);

    const stackHelpers                                      = StackHelpers.getOrCreate(this, artifactResolver);
    const { derivedDomainName, derivedS3SafeDataStackName } = stackHelpers.resolveMailboxData(
      groups.data, 'stack-helpers', { hostedZoneId: props.hostedZoneId ?? '', dataStackName: effectiveDataStackName },
    );

    // Derive S3-safe main stack name (no domain lookup needed, so hostedZoneId is empty)
    const { derivedS3SafeDataStackName: mainStackNameBase } = stackHelpers.resolveMailboxData(
      groups.data, 'stack-helpers-main-stack', { hostedZoneId: '', dataStackName: Aws.STACK_NAME },
    );

    setStackNameBase(this, mainStackNameBase);

    const domainName: string = derivedDomainName;
    const nameBase: string   = derivedS3SafeDataStackName;

    const enableAdminUi   = props.enableAdminUi ?? true;
    const enableWebmailUi = props.enableWebmailUi ?? true;

    const addressing                                                = MailboxAddressing.resolve(this, props, domainName, { adminUi: enableAdminUi, webmailUi: enableWebmailUi });
    const { zone: hostedZone, domains: mailboxDomains, edgePrefix } = addressing;
    this.urls                                                       = addressing.urls;

    this.emailQueueProps = encryptionPlan.queues;

    // Retained data resources come from the auto-deployed data stack. Every field on `dataRef` is
    // an `IDataTable` grant interface; no raw `ITable` reaches this scope.
    const dataRef = new MailboxDataDeployer(groups.data, 'data-deployer', {
      artifactResolver,
      nameBase,
      deployerType,
    });

    this.blobStoreBucket = dataRef.blobStoreBucket;
    this.blobStoreHandle = dataRef.blobStore;

    const { configTable, itemTable, changelogTable, auditLogTable, mailFeedbackTable } = dataRef;
    this.configTable                                                                   = configTable;

    const auditWriting = new AuditWriting(groups.data, 'audit-writing', {
      auditLogTable,
      artifactResolver,
      queueProps: encryptionPlan.queues,
    });

    const authKeyStore = new AuthKeyStore(groups.auth, 'auth-key-store', {
      issuers: [authProvider.issuer],
      artifactResolver,
    });

    const edgeStack = new MailboxEdgeDeployer(groups.edge, 'stack-deployer', {
      domainName,
      artifactResolver,
      prefix: edgePrefix,
      hostedZone: props.hostedZoneId ? hostedZone : undefined,
      itemTable: dataRef.itemTable,
      configTable: dataRef.configTable,
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
      productVersion: stackVersion,
      deployerType,
      logGroupName: PipelineLogGroup.getOrCreate(groups.edge, 'jmap').logGroupName,
    });

    const edgeCertificate = edgeStack.edgeCertificate;

    const hasHostedZone      = Boolean(props.hostedZoneId);
    const useCustomCdnDomain = Boolean(props.overrides?.certificates?.cloudFront || hasHostedZone);

    const defaultUiCertificate = hasHostedZone ? edgeCertificate : undefined;
    if (hasHostedZone && !defaultUiCertificate) {
      throw new Error('hostedZone was provided but edge certificate was not created');
    }

    // Regional ACM certificates for regional services (API Gateway).
    // These must live in the same region as this stack (unlike CloudFront certs in us-east-1).
    const providedApiCertificate  = props.overrides?.certificates?.api;
    const providedJmapCertificate = props.overrides?.certificates?.jmap;
    const providedWsCertificate   = props.overrides?.certificates?.ws;

    // If either API certificate is missing and there is a hosted zone, one SAN certificate covers
    // the api, jmap, ws and mcp names and fills the gaps.
    let regionalSanCertificate: acm.ICertificate | undefined;
    let cfnCert: acm.CfnCertificate | undefined;
    if (hasHostedZone && (!providedApiCertificate || !providedJmapCertificate)) {
      cfnCert = new acm.CfnCertificate(groups.edge, 'regional-api-certificate', {
        domainName: mailboxDomains.api,
        subjectAlternativeNames: [mailboxDomains.jmap, mailboxDomains.ws, `mcp.${domainName}`],
        validationMethod: 'DNS',
        domainValidationOptions: [
          { domainName: mailboxDomains.api, hostedZoneId: props.hostedZoneId! },
          { domainName: mailboxDomains.jmap, hostedZoneId: props.hostedZoneId! },
          { domainName: mailboxDomains.ws, hostedZoneId: props.hostedZoneId! },
          { domainName: `mcp.${domainName}`, hostedZoneId: props.hostedZoneId! },
        ],
      });
      cfnCert.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
      regionalSanCertificate = acm.Certificate.fromCertificateArn(groups.edge, 'regional-api-certificate-ref', cfnCert.ref);
    }

    const regionalCertificate = regionalSanCertificate;

    this.certificates = {
      edge:     edgeCertificate,
      regional: regionalCertificate,
    };

    const apiCertificate = providedApiCertificate
      ?? regionalSanCertificate;

    const jmapCertificate = providedJmapCertificate
      ?? regionalSanCertificate;

    // WebSocket push uses the explicit override or else the regional SAN cert; it never creates its own.
    const wsCertificate = providedWsCertificate
      ?? regionalSanCertificate;

    const adminUiOrigins: string[]   = [];
    const webmailUiOrigins: string[] = [];

    let adminUi: AdminUi | undefined;
    let webmailUi: WebmailUi | undefined;

    let adminUiCnameTarget: string | undefined;
    let webmailUiCnameTarget: string | undefined;

    // The webmail token exchange waits on this group; the bootstrap resource joins it once built.
    const oauthClientsProvisioned = new DependencyGroup();

    const sesEventProcessing = new SESEventProcessing(groups.email, 'ses-event-processing', {
      itemTable,
      mailFeedbackTable,
      changelogTable,
      configTable,
      blobStore: this.blobStoreHandle,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver,
      queueProps: encryptionPlan.queues,
    });

    const emailSending = new EmailSending(groups.email, 'email-sending', {
      configTable,
      itemTable,
      changelogTable,
      blobStore: this.blobStoreHandle,
      artifactResolver,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
      queueProps: encryptionPlan.queues,
    });

    const identityProvisioner = new IdentityProvisionerLambda(groups.auth, 'identity-provisioner', {
      configTable,
      itemTable,
      changelogTable,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver,
      adminUIURL: this.urls.adminUi,
      blobStore: this.blobStoreHandle,
      emailSubmissionQueue: emailSending.submissionQueue,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
      systemSenderAddress: `noreply@${domainName}`,
      vendorAccountIds,
    });

    // Build admin API addons early from all providers (auth provider + optional additional providers).
    // All addons are known at construction time, so uiConfig merge is eager.
    const adminApiAddons: IAdminApiAddon[] = (() => {
      const addons: IAdminApiAddon[] = [];

      const ctx: AdminApiAddonContext = {
        auditEventsQueue: auditWriting.auditEventsQueue,
        configTable,
        auditLogTable,
        identityProvisioner,
        artifactResolver,
      };

      addons.push(...authProvider.createAdminApiAddons(groups.apis, ctx));

      for (const provider of props.adminApiAddonProviders ?? []) {
        addons.push(...provider.createAdminApiAddons(groups.apis, ctx));
      }

      return addons;
    })();

    const jmapApiAddonContext: JmapApiAddonContext = {
      apiBaseUrl: this.urls.jmapApi,
      identityProvisioner,
    };

    const jmapApiAddons: IJmapApiAddon[] = (() => {
      if (typeof authProvider.createJmapApiAddons !== 'function') {return [];}
      return authProvider.createJmapApiAddons(groups.apis, jmapApiAddonContext);
    })();

    const jmapOAuthIssuerUrl = authProvider.jmapOAuthIssuerUrl?.();

    if (enableAdminUi) {
      const providerAuthz = authProvider.authorizationConfig?.();

      // Build admin UI config eagerly by merging authz and all addon configs.
      const mergedAdminUiConfig: Record<string, unknown> = {
        ...(providerAuthz
          ? {
            authorization: {
              roles: {
                adminGroups: providerAuthz.adminGroups,
                userGroups: providerAuthz.userGroups,
              },
            },
          }
          : {}),
      };

      for (const addon of adminApiAddons) {
        if (addon.uiConfig) {
          Object.assign(mergedAdminUiConfig, addon.uiConfig);
        }
      }

      adminUi = new AdminUi(groups.ui, 'admin-ui', {
        domainName: mailboxDomains.admin,
        certificate: props.overrides?.certificates?.adminUi ?? defaultUiCertificate,
        configTable: this.configTable,
        auditEventsQueue: auditWriting.auditEventsQueue,
        authProvider,
        apiUrl: apiCertificate ? `https://${mailboxDomains.api}` : undefined,
        webmailUrl: enableWebmailUi && (props.overrides?.certificates?.webmailUi ?? defaultUiCertificate)
          ? `https://${mailboxDomains.webmail}`
          : undefined,
        uiConfig: Object.keys(mergedAdminUiConfig).length > 0 ? mergedAdminUiConfig : undefined,
        artifactResolver,
      });

      adminUiOrigins.push(`https://${adminUi.distributionDomainName}`);
      adminUiCnameTarget = adminUi.distribution.distributionDomainName;

      grantUiContentDeployIfGrantable(adminUi, artifactResolver);
    }

    if (enableWebmailUi) {
      webmailUi = new WebmailUi(groups.ui, 'webmail-ui', {
        domainName: mailboxDomains.webmail,
        certificate: props.overrides?.certificates?.webmailUi ?? defaultUiCertificate,
        configTable: this.configTable,
        auditEventsQueue: auditWriting.auditEventsQueue,
        authProvider,
        apiUrl: jmapCertificate ? `https://${mailboxDomains.jmap}` : undefined,
        uiBundle: { packageName: 'mailbox-webmail-ui', objectPath: 'webmail-ui.zip' },
        artifactResolver,
        dependsOn: [oauthClientsProvisioned],
      });

      webmailUiOrigins.push(`https://${webmailUi.distributionDomainName}`);
      webmailUiCnameTarget = webmailUi.distribution.distributionDomainName;

      grantUiContentDeployIfGrantable(webmailUi, artifactResolver);
    }

    this.oauthClients = {
      ...(adminUi ? { adminUi: adminUi.oauthClient } : {}),
      ...(webmailUi ? { webmailUi: webmailUi.oauthClient } : {}),
    };

    const extraOrigins              = props.extraAllowedOrigins ?? [];
    const allowedOriginsForAdminApi = [...adminUiOrigins, ...extraOrigins];
    const allowedOriginsForJmapApi  = [...webmailUiOrigins, ...extraOrigins];
    const allowedOriginsForCdn      = [...adminUiOrigins, ...webmailUiOrigins, ...extraOrigins];

    const adminRequiredGroups = authProvider.policies.adminApi.requireAnyOfGroups
      ?? this.oauthClients.adminUi?.groups
      ?? undefined;

    new LicenseRefresh(groups.ops, 'license-refresh', {
      configTable,
      artifactResolver,
      coreDomain: domainName,
      vendorAccountIds,
    });

    // SES receipt rules and the email-processing queue they feed. Built before the email-processor
    // Lambda so its own event source mapping can reference the queue at construction time.
    const sesRules = new SesRules(groups.email, 'ses-rules', {
      delivery: {
        blobStore: this.blobStoreBucket,
        artifactResolver,
        queueProps: this.emailQueueProps,
      },
    });

    this.emailProcessorLambda = new EmailProcessorLambda(groups.email, 'email-processor-lambda', {
      configTable,
      itemTable,
      changelogTable,
      blobStore: this.blobStoreHandle,
      emailProcessingQueue: sesRules.emailProcessingQueue,
      artifactResolver,
    });

    const bootstrap = new Bootstrap(groups.auth, 'bootstrap', {
      domain: domainName,
      oidcIssuer: authProvider.issuer,
      configTable,
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
      artifactResolver,
      sesRuleSet: sesRules.ruleSet,
      sesReceivingMode: props.enableReceiving,
      sesSendEnabled: true,
      hostedZone: hasHostedZone ? hostedZone : undefined,
      vendorAccountIds,
      stackIdentityTagKey,

      oidcProvider: {
        tokenEndpoint: authProvider.tokenEndpoint,
        authorizationEndpoint: authProvider.authorizationEndpoint,
        authMethod: authProvider.authMethod,
        usePkce: authProvider.usePkce,
      },
      authPolicies: {
        adminApi: {
          audiences: authProvider.policies.adminApi.audiences,
          requireAnyOfGroups: adminRequiredGroups,
          requireAllScopes: authProvider.policies.adminApi.requireAllScopes,
        },
        jmapApi: {
          audiences: authProvider.policies.jmapApi.audiences,
          requireAllScopes: authProvider.policies.jmapApi.requireAllScopes,
        },
      },
      oauthClients: (adminUi || webmailUi)
        ? {
          adminUi: adminUi
            ? {
              flow: 'authorization_code',
              clientId: adminUi.oauthClient.clientId,
              clientSecret: adminUi.oauthClient.clientSecret,
              scopes: ['openid', 'email', 'profile', ...adminUi.oauthClient.requestScopeList],
              redirectUri: adminUi.oauthRedirectUri,
            }
            : undefined,
          webmailUi: webmailUi
            ? {
              flow: 'authorization_code',
              clientId: webmailUi.oauthClient.clientId,
              clientSecret: webmailUi.oauthClient.clientSecret,
              scopes: ['openid', 'email', 'profile', ...webmailUi.oauthClient.requestScopeList],
              redirectUri: webmailUi.oauthRedirectUri,
            }
            : undefined,
        }
        : undefined,
    });
    oauthClientsProvisioned.add(bootstrap.oauthClientsProvisioned);

    // Stack-failure detector: watches the root stack's own terminal `CloudFormation Stack
    // Status Change` events. A terminal stack status is emitted only after the whole operation
    // concludes, so the detector has no ordering requirement relative to its ops-group siblings.
    // Consent defaults to ENABLED; `disabled` synthesizes zero detector resources (see
    // StackFailureDetection for the CfnCondition gating). Built before SweeperInfra: its retained
    // rule/function/role are registered below as one removal, and the sweeper's worker IAM policy
    // is assembled from the registered removals.
    const stackFailureDetection = new StackFailureDetection(groups.ops, 'stack-failure-detection', {
      mode: props.sendStackFailures ?? SendStackFailuresMode.ENABLED,
      artifactResolver,
      vendorAccountIds,
    });

    // Extract the edge jmap-blob-download Lambda ARN (strip version qualifier).
    // Version ARN:  arn:aws:lambda:us-east-1:<acct>:function:<name>:<version>
    // Function ARN: arn:aws:lambda:us-east-1:<acct>:function:<name>
    const versionArn      = edgeStack.getOutput('jmapBlobDownloadVersionArn');
    const fnArnParts      = Fn.split(':', versionArn);
    const edgeFunctionArn = Fn.join(':', [
      Fn.select(0, fnArnParts), // arn
      Fn.select(1, fnArnParts), // aws
      Fn.select(2, fnArnParts), // lambda
      Fn.select(3, fnArnParts), // us-east-1
      Fn.select(4, fnArnParts), // account
      Fn.select(5, fnArnParts), // function
      Fn.select(6, fnArnParts), // <function-name>
      // Fn.select(7, ...) is the version number — intentionally dropped
    ]);
    // Imported by ARN: the JMAP blob download function lives in the separate edge sub-stack, so there is no
    // construct reference to it.
    const edgeFunction = awslambda.Function.fromFunctionArn(groups.ops, 'edge-fn-removal-target', edgeFunctionArn);

    // Each retained resource is registered as its own removal.
    const removals: IResourceRemoval[] = [];
    if (regionalSanCertificate) {
      removals.push(new CertificateRemoval(groups.ops, 'cert-removal', { certificate: regionalSanCertificate }));
    }
    removals.push(new EdgeFunctionRemoval(groups.ops, 'edge-fn-removal', { function: edgeFunction }));
    if (stackFailureDetection.sweepTargets) {
      removals.push(new StackFailureDetectorRemoval(groups.ops, 'stack-failure-detector-removal', stackFailureDetection.sweepTargets));
    }

    // Resource sweeper (Step Functions + worker Lambda): asynchronous cleanup of the retained
    // resources after stack deletion.
    const sweeperInfra = new SweeperInfra(groups.ops, 'sweeper-infra', {
      artifactResolver,
      removals,
    });

    // Fires the sweeper's starter Lambda on stack Delete or Update. CloudFormation supplies
    // `OldResourceProperties` on Update, so the starter can sweep only what changed; on Delete it
    // sweeps everything present.
    new DeferredRemoval(groups.ops, 'deferred-removal', {
      sweeperStarter: sweeperInfra.starter,
      removals,
    });

    const cdnCertificate                               = hasHostedZone ? edgeCertificate : props.overrides?.certificates?.cloudFront;
    const cdnCustomDomain: CdnCustomDomain | undefined =
      useCustomCdnDomain && cdnCertificate ? { name: mailboxDomains.cdn, certificate: cdnCertificate } : undefined;

    const cdnConstruct = new Cdn(groups.ui, 'blob-cdn', {
      blobStore: this.blobStoreBucket,
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
      allowedOrigins: allowedOriginsForCdn.length > 0 ? allowedOriginsForCdn : undefined,
      jmapBlobDownloadVersion: edgeStack.jmapBlobDownloadVersion,
      customDomain: cdnCustomDomain,
    });

    // DNS is created later, once all endpoint targets are known.

    const tantivySearch = new TantivySearch(groups.search, 'tantivy-search', {
      indexBucket: this.blobStoreHandle,
      itemTable,
      configTable,
      changelogTable,
      artifactResolver,
      queueProps: encryptionPlan.queues,
    });
    // tantivySearch is used for side-effects only at this level.
    void tantivySearch;

    this.jmapApi  = new JMapApi(groups.apis, 'jmap-api', {
      configTable,
      itemTable,
      changelogTable,
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
      cdnHost: cdnConstruct.host,
      allowedOrigins: allowedOriginsForJmapApi.length > 0 ? allowedOriginsForJmapApi : undefined,
      blobStore: this.blobStoreHandle,
      emailSubmissionQueue: emailSending.submissionQueue,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver,
      authProvider,
      identityProvisioner,

      domainName: jmapCertificate ? mailboxDomains.jmap : undefined,
      certificate: jmapCertificate,

      jmapApiAddons,
      oauthIssuerUrl: jmapOAuthIssuerUrl,
      vendorAccountIds,

      // WebSocket URL will be passed via environment variable, not here
    });
    const jmapApi = this.jmapApi;

    // Created after the JMAP API because it reuses that API's authorizer Lambda.
    const webSocketPush = new WebSocketPush(groups.apis, 'websocket-push', {
      configTable,
      itemTable,
      changelogTable,
      authorizerLambda: jmapApi.authorizerLambda, // Reuse HTTP API authorizer
      artifactResolver,
      maxSubscriptions: 10,

      domainName: (hasHostedZone && wsCertificate) ? mailboxDomains.ws : undefined,
      certificate: hasHostedZone ? wsCertificate : undefined,
    });
    // Keep a deeper messaging override — websocket-push overrides the apis group tag.
    applyServerlessInboxComponentTag(webSocketPush, 'messaging');
    const adminApi = new AdminApi(groups.apis, 'admin-api', {
      configTable,
      itemTable,
      auditLogTable,
      changelogTable,
      mailFeedbackTable,
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
      blobStore: this.blobStoreHandle,
      emailSubmissionQueue: emailSending.submissionQueue,
      auditEventsQueue: auditWriting.auditEventsQueue,
      allowedOrigins: allowedOriginsForAdminApi.length > 0 ? allowedOriginsForAdminApi : undefined,
      artifactResolver,
      identityProvisioner,
      vendorAccountIds,
      stackIdentityTagKey,

      addons: adminApiAddons,

      domainName: apiCertificate ? mailboxDomains.api : undefined,
      certificate: apiCertificate,

      sesRuleSetName: sesRules.ruleSetName,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
      systemSenderAddress: `noreply@${domainName}`,
    });

    const mcpApi = props.enableMcp ? new McpApi(groups.apis, 'mcp-api', {
      jmapApiGateway: this.jmapApi.httpApi,
      authorizerLambda: this.jmapApi.authorizerLambda,
      certificate: this.certificates.regional!,
      domainName: domainName,
      scopeMap: props.authProvider.scopeMap as Record<string, string[]>,
      artifactResolver,
    }) : undefined;

    jmapApi.enableWebSocketPublishing(webSocketPush.webSocketUrl, webSocketPush.broadcaster);
    adminApi.enableWebSocketPublishing(webSocketPush.broadcaster);

    // Enable WebSocket push emission from the ChangeTracker in each Lambda that records changelog state.
    this.emailProcessorLambda.enableWebSocketPublishing(webSocketPush.broadcaster);
    emailSending.enableWebSocketPublishing(webSocketPush.broadcaster);
    sesEventProcessing.enableWebSocketPublishing(webSocketPush.broadcaster);

    // --- Pin logical IDs to survive reparenting ---
    // API Gateway custom domain names are globally unique per account/region; a reparented
    // construct cannot create the replacement alongside the still-existing original, so
    // create-before-delete would fail on a name collision. Pinning the logical ID keeps
    // CloudFormation updating the same domain name in place instead of replacing it.
    adminApi.domainCfnResource?.overrideLogicalId('Mailboxadminapidomain8793AE5D');
    jmapApi.domainCfnResource?.overrideLogicalId('Mailboxjmapapidomain47B62A36');
    webSocketPush.domainCfnResource?.overrideLogicalId('MailboxwebsocketpushdomainCACDAF3B');

    if (hasHostedZone) {
      const dns = new MailboxDns(groups.edge, 'dns', {
        names: mailboxDomains,
        hostedZone: hostedZone,
        cnameTargets: {
          admin: adminUiCnameTarget,
          webmail: webmailUiCnameTarget,
          cdn: cdnConstruct.distribution.distributionDomainName,
          api: adminApi.domainTarget,
          jmap: jmapApi.domainTarget,
          ws: webSocketPush.domainTarget,
          mcp: mcpApi?.domainTarget,
        },
      });
      // dns is used for side-effects only at this level.
      void dns;
    }

    // Adds Name tags and native descriptions to every L1 resource under this construct.
    cdk.Aspects.of(this).add(new MailboxResourceDescriptions(id));

    // Per-region AWS Resource Group collecting all resources tagged with this deployment's
    // root-stack (this is the main stack, so root-stack = AWS::StackName).
    addServerlessInboxResourceGroup(this, 'resource-group');

  }

}

/**
 * Grants `resolver` write access to `ui`'s own content bucket, when `resolver` is capable of
 * being granted at all. `resolver` is typed `IArtifactResolver`, which carries no IAM principal,
 * so grantability is a runtime capability: a resolver without a principal needs no grant and is
 * skipped rather than erroring.
 */
function grantUiContentDeployIfGrantable(ui: MailboxUi, resolver: IArtifactResolver): void {
  if (isGrantable(resolver)) {
    ui.grantContentDeploy(resolver);
  }
}

function isGrantable(resolver: IArtifactResolver): resolver is IArtifactResolver & IGrantable {
  return 'grantPrincipal' in resolver;
}
