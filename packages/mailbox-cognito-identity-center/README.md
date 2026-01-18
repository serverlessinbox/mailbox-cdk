# @sipkg/mailbox-cognito-identity-center

Addon package to attach AWS IAM Identity Center (SAML) as a federated identity provider to a Cognito User Pool created by `@sipkg/mailbox-cognito`.

## Usage

- Create `MailboxUserPool` from `@sipkg/mailbox-cognito`
- Attach Identity Center federation with `IdentityCenterSamlFederation`
- Provide SAML metadata via URL or local metadata XML file path
- Cognito remains the OIDC issuer; Identity Center is used for Hosted UI login.

### Example (metadata URL)

```ts
import { MailboxUserPool } from '@sipkg/mailbox-cognito';
import { IdentityCenterSamlFederation } from '@sipkg/mailbox-cognito-identity-center';

const userPool = new MailboxUserPool(this, 'auth', {
	domain: { type: 'cognito', cognitoDomainPrefix: 'my-auth-domain' },
});

new IdentityCenterSamlFederation(this, 'identity-center', {
	mailboxUserPool: userPool,
	providerName: 'IdentityCenter',
	metadata: {
		type: 'url',
		url: 'https://example.identitycenter.awsapps.com/start/#/saml/metadata',
	},
});
```

### Example (metadata XML file)

```ts
new IdentityCenterSamlFederation(this, 'identity-center', {
	mailboxUserPool: userPool,
	providerName: 'IdentityCenter',
	metadata: {
		type: 'file',
		filePath: './identity-center-metadata.xml',
	},
});
```

## Tutorial: Create the IAM Identity Center SAML app

This configures IAM Identity Center as the IdP and Cognito Hosted UI as the SAML service provider (SP).

1. In the AWS console, go to **IAM Identity Center** → **Applications** → **Add application**.
2. Choose **Custom SAML 2.0 application**.
3. In the application configuration, set:
	 - **Application ACS URL**: `https://<your-cognito-domain>/saml2/idpresponse`
		 - Use your Cognito Hosted UI domain (custom domain or `*.auth.<region>.amazoncognito.com`).
	 - **Application SAML audience** (Entity ID): `urn:amazon:cognito:sp:<userPoolId>`
4. Download the **IAM Identity Center SAML metadata file** (XML) for this application (or copy its metadata URL if offered).
5. Plug that metadata into `IdentityCenterSamlFederation` (`metadata.type: 'file'` or `'url'`).

Optional:
- Configure **attribute mappings** in IAM Identity Center so the assertion includes email/name claims, then pass a matching `attributeMapping` to the construct.

Notes:
- The SAML metadata is application-specific (each Identity Center SAML app has its own metadata).
- Cognito still issues OIDC tokens for Mailbox; Identity Center is used for interactive login via Hosted UI.
