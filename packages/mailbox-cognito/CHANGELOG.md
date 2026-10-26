
# Changelog

All notable changes to this project will be documented in this file


## [0.5.2](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.5.1...v0.5.2) (Mon Oct 26 2026)

### test

* **mailbox-cognito** pin each unit's own statements in the data stack, user pool, addons and runtime handlers ([2b64ea4](https://github.com/serverlessinbox/mailbox-cdk/commit/2b64ea4d745103839f111b1d4bea0780a25123c0))

### fix

* **mailbox-cognito** the custom auth domain passes CertificateArn ([f47bca9](https://github.com/serverlessinbox/mailbox-cdk/commit/f47bca98cd915675aec545115338ce5981305f61))

## [0.5.1](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.5.0...v0.5.1) (Mon Oct 26 2026)



## [0.5.0](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.4.0...v0.5.0) (Mon Oct 26 2026)

### refactor

* **infrastructure** the package Taskfiles build stacks through build-stack ([f97819d](https://github.com/serverlessinbox/mailbox-cdk/commit/f97819dcb79803946a78cfa1f36062447468bdcb))

* **auth** type auth names, flows and methods as enums; split core/auth/types ([e3d4c3d](https://github.com/serverlessinbox/mailbox-cdk/commit/e3d4c3d4a51b389c2cdc12a378a7289065d4e3db))

* **mailbox-cognito** lowercase the mfaMode values and map them to Cognito's spelling ([3c3c8a3](https://github.com/serverlessinbox/mailbox-cdk/commit/3c3c8a3a92545272f1f4a4d54b4c7898300319f8))

* **mailbox-addon-sdk** rename mailbox-admin-api to mailbox-addon-sdk ([c9fa9df](https://github.com/serverlessinbox/mailbox-cdk/commit/c9fa9dfc4693eb65cd16152241bdbf598c83bffe))

* **mailbox-cognito** the IdP users API runs on wrapService ([260aeef](https://github.com/serverlessinbox/mailbox-cdk/commit/260aeefc56cfa769ebe17cdb4b81e1e770e66783))

* **mailbox-cognito** the IdP users API moves to src/runtime ([cf87904](https://github.com/serverlessinbox/mailbox-cdk/commit/cf87904900f6358825cc5f9943e7e3921e5d9f39))

### build

* **mailbox** drop the unused ts-node devDependency ([e0f59d2](https://github.com/serverlessinbox/mailbox-cdk/commit/e0f59d27f5753fd27aaf40749beb9ecb3c1e720f))

* **packaging** check the published declarations in prepack; bundle mailbox-cognito like mailbox ([081bde3](https://github.com/serverlessinbox/mailbox-cdk/commit/081bde37416c444a136789e4874bbedb1ec0d603))

* **packaging** ship .jsii, pin jsii-pacmak, align the package manager, drop a dead exclude ([0d89603](https://github.com/serverlessinbox/mailbox-cdk/commit/0d896037a18e4df815321b8d3b60bf2bcb9bf479))

* **lint** forbid anonymous object types, fs sync calls, require and public writable state ([ff66c5f](https://github.com/serverlessinbox/mailbox-cdk/commit/ff66c5f887f030630ffa6a0e94212dcaceb20db5))

* **packaging** the tarballs ship lib without runtime JS and no src; prepack starts from a clean lib ([8ade3a1](https://github.com/serverlessinbox/mailbox-cdk/commit/8ade3a19ff42d4b0f215fc2d3b13e869234c90bf))

* **packaging** drop files entries that match nothing ([e56cbac](https://github.com/serverlessinbox/mailbox-cdk/commit/e56cbac7f23bc990cef0def5eaae60c608b8fc5f))

### fix

* **mailbox-cognito** fail a bootstrap user when no group can be joined, and require SERVICE_NAME ([0b16562](https://github.com/serverlessinbox/mailbox-cdk/commit/0b16562f2da79d17b18d1caa26d243580c7805d7))

* **mailbox-cognito** the user pool exposes its id only through userPool, and the users API takes the pool ([bc035c1](https://github.com/serverlessinbox/mailbox-cdk/commit/bc035c1a2ebfa0d33dfb8cda7473317ac3bd099f))

* **ci** read the AWS profile from a local .env for task and yarn ([ac5f1ce](https://github.com/serverlessinbox/mailbox-cdk/commit/ac5f1ce078e55dfebba9bdd2902e31161c5563a5))

* **mailbox-cognito** attach the OAuth route settings to the throttled JMAP stage ([40416d8](https://github.com/serverlessinbox/mailbox-cdk/commit/40416d8328757b3693962ab6c2088bcb6c98173f))

### chore

* **packaging** package metadata and licenses for mailbox packages ([6e7128e](https://github.com/serverlessinbox/mailbox-cdk/commit/6e7128e79f11ccb2cc8126877434fc87cc7a2f45))

* **packaging** place LICENSE in mailbox and mailbox-cognito packs ([b726618](https://github.com/serverlessinbox/mailbox-cdk/commit/b726618fb38d71e255d7c0e0787c632608f6e096))

* **packaging** send issues to the front-door repo ([0c6efd8](https://github.com/serverlessinbox/mailbox-cdk/commit/0c6efd8d35fb4e3c391a6bf720b59ff6347215c7))

### ci

* take the deploy role and dev profile from configuration, not the tree ([ea3c608](https://github.com/serverlessinbox/mailbox-cdk/commit/ea3c60896cf070029c72a0b9fbb42daa7ab9a732))

### feat

* **mailbox-addon-sdk** caller, service runtime and error table ([88576a1](https://github.com/serverlessinbox/mailbox-cdk/commit/88576a15b91945991657393c32361d073c90d129))

* **mailbox** the Admin API mounts each addon's route behind its own authorizer ([322feed](https://github.com/serverlessinbox/mailbox-cdk/commit/322feed2817141789a0387b0f9ecf2962fa3940b))

* **mailbox** addon routes sit behind a principal-lookup authorizer ([4083fb6](https://github.com/serverlessinbox/mailbox-cdk/commit/4083fb6f76774c7fabe27dbe6ee9b930a2f85f26))

* **mailbox-addon-sdk** audit sink; errors and json in their own folders ([3828ced](https://github.com/serverlessinbox/mailbox-cdk/commit/3828ceddc346ccae0af1f2b7d23ed696e3a8f493))

* **mailbox-cognito** new users join the pool's user groups by default ([50d0b51](https://github.com/serverlessinbox/mailbox-cdk/commit/50d0b517f3eb20d1592d3ecec7575ccdff75971f))

* **users** no permanent-password option; admin-set passwords are temporary ([96185dc](https://github.com/serverlessinbox/mailbox-cdk/commit/96185dc12fce0018cb0c2886f1a95a7cf7403c3f))

### docs

* **readme** published packages only, a Quick Start that compiles, docs site as homepage ([3367ec7](https://github.com/serverlessinbox/mailbox-cdk/commit/3367ec719b1d7e8c495232c74a1b7ed3ee3a8086))

* a README for every package ([12bfd9d](https://github.com/serverlessinbox/mailbox-cdk/commit/12bfd9d60cb32a74759d833a75e697eb993532e5))

* fixes from the markdown audit ([e56d62a](https://github.com/serverlessinbox/mailbox-cdk/commit/e56d62a27208d74fee38b9014871825fe9b9dbea))

## [0.4.0](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.3.1...v0.4.0) (Fri Oct 23 2026)

### build

* **lint** one ESLint 10 toolchain over every TypeScript file, CI gate over clean packages ([3a38af4](https://github.com/serverlessinbox/mailbox-cdk/commit/3a38af43720e93673e5bf28c79fed9d38a4af699))

### style

* **lint** apply eslint auto-fixes for import order, alignment and curly ([2f268fb](https://github.com/serverlessinbox/mailbox-cdk/commit/2f268fb22f77815172cf0b90c7912a0d46d08d24))

* one local rule aligns = and : in strict line groups ([4898ead](https://github.com/serverlessinbox/mailbox-cdk/commit/4898ead1807348fd39d98263aabae96ea359ed39))

### refactor

* **admin-api** lint-clean, typed boundaries, build and test setup ([805a4b0](https://github.com/serverlessinbox/mailbox-cdk/commit/805a4b0db66ae777f8568e013ee412f3b4001495))

* **kit** shared runtime custom-resource, config and error units move into runtime/handler-kit/ (CS2.1) ([8b079db](https://github.com/serverlessinbox/mailbox-cdk/commit/8b079db7bfee5ebe12a4e739ce936f8a6dadfe59))

* **kit** the rest of the shared runtime moves into runtime/handler-kit/, stack-helpers into runtime/stack-helpers/ (CS2.2) ([da3a8a3](https://github.com/serverlessinbox/mailbox-cdk/commit/da3a8a3c54a581c6da741e47adb92e74fd5c7594))

* **cognito** bootstrap-user and the shared cognito runtime move to src/runtime/ (CS3.1) ([cf73c7e](https://github.com/serverlessinbox/mailbox-cdk/commit/cf73c7e082cca1c3f614473738aba87496e5ae73))

* **cognito** jmap-oauth-dcr runtime moves to src/runtime/ (CS3.2) ([c3a141e](https://github.com/serverlessinbox/mailbox-cdk/commit/c3a141ed40ee915be353b11cddcf9c49082dc5c3))

* **cognito** user-pool/, data-stack/, addons at the root and resources/lambdas/ (CS3.4) ([4cb4062](https://github.com/serverlessinbox/mailbox-cdk/commit/4cb40627c42b47c9f58b89164aefd9d49989a78a))

* **mailbox** the deployer worker wrappers join resources/lambdas/ (CR2.2, CR2.3) ([0fca109](https://github.com/serverlessinbox/mailbox-cdk/commit/0fca1094f7de5c7f27dbad163d6c6a7fef50d3a1))

* **kit** drop the ignored version option from the tag helpers ([e945320](https://github.com/serverlessinbox/mailbox-cdk/commit/e945320fa845f8e8ab0de00ddea71264ef212919))

* **cognito** structure and dead code conform to the skills (CQ-cognito-A) ([b39573e](https://github.com/serverlessinbox/mailbox-cdk/commit/b39573eebd12d155d88db0e8d4f38041a9456645))

* **cognito** typing, lint and small structure conform to the skills (CQ-cognito-B) ([7f54f4a](https://github.com/serverlessinbox/mailbox-cdk/commit/7f54f4a0cd3511f748ebdca2f4b74a4182ce712b))

* **kit** the custom-resource request contract is closed and typed ([f1239ca](https://github.com/serverlessinbox/mailbox-cdk/commit/f1239ca4932407300f78f3cf4030ce068050383b))

* **cognito** grants take narrow interfaces and the worker gets its stack identity as props (CQ-cognito-C) ([acc16a6](https://github.com/serverlessinbox/mailbox-cdk/commit/acc16a6a86931263b62d0d483fba4d28063baccf))

* **cognito** every file conforms to the skills (CQ-cognito-D) ([2e5a5e7](https://github.com/serverlessinbox/mailbox-cdk/commit/2e5a5e769ef7d9cbbece56143e4e8f3962b921e4))

* **kit** constructs take objects instead of ARN strings and resources grant themselves ([7b92ea9](https://github.com/serverlessinbox/mailbox-cdk/commit/7b92ea9b46a04f12cdd3ea84d101d210a51ae742))

* **mailbox** the first ten Lambda wrappers and the email section conform to the skills (K-07) ([fd884e7](https://github.com/serverlessinbox/mailbox-cdk/commit/fd884e796f94e9ff7a488e95e6e48dae338e020d))

* **mailbox** the remaining wrappers conform; one artifact-package constant, a named exported ScopeMap, and only the edge section holds the zone (K-08) ([4032744](https://github.com/serverlessinbox/mailbox-cdk/commit/4032744bb11ccf2eec276b09aea7aaa38d378e14))

### feat

* **kit** version tags only where they are read; other tags unchanged ([928e180](https://github.com/serverlessinbox/mailbox-cdk/commit/928e180138be84a8724cfdbf2887d4a373a5616c))

* **mailbox** the data and cognito data stacks drop their unused productVersion parameter ([73bb807](https://github.com/serverlessinbox/mailbox-cdk/commit/73bb807baa74694d972aa2cd0c8c8a0f73c68061))

* **cognito** the user pool's public API is strongly typed (CQ-cognito-E) ([981bda3](https://github.com/serverlessinbox/mailbox-cdk/commit/981bda35c50783dbea226417a723bd7c8391e3e9))

### fix

* test rows, addon spacing and one source per OAuth scope list side ([be8c583](https://github.com/serverlessinbox/mailbox-cdk/commit/be8c5831aae8f90f2092ba1a8bdd02dd1b6d2336))

* **cognito** the bootstrap password meets the pool minimum length ([1f4b705](https://github.com/serverlessinbox/mailbox-cdk/commit/1f4b7051c2724eaf60bcf8eb3a17e1e7d8a6979e))

* **cognito** the cognito data stack build passes no env, so its template is account- and region-agnostic ([a65d14d](https://github.com/serverlessinbox/mailbox-cdk/commit/a65d14d76643979ea8b2dfd721f0f5f66025f966))

* **cognito** grantAdminAccess grants only the Cognito actions its users Lambda calls ([cce8f38](https://github.com/serverlessinbox/mailbox-cdk/commit/cce8f3872244400f605043c8cf9347f87237574c))

### chore

* **lint** enforce id-length and member-ordering; rename short locals and reorder members ([14a46f0](https://github.com/serverlessinbox/mailbox-cdk/commit/14a46f08010125ce9a0fe2eac062262216680951))

* **lint** finish the id-length rule; rename grantAdminAccess parameter to grantee ([2de17c9](https://github.com/serverlessinbox/mailbox-cdk/commit/2de17c9f2e4c44a8d89187f2eaf3876e857678e5))

## [0.3.1](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.3.0...v0.3.1) (Tue Oct 20 2026)

### refactor

* **mailbox-cognito** the user pool follows the code skills (K) ([0ea873c](https://github.com/serverlessinbox/mailbox-cdk/commit/0ea873cde1f257b9562c2dd4faec422c29d9cc73))

* **mailbox-cognito** the bootstrap-user Lambda grants itself; one authorization-config hook ([d682c9e](https://github.com/serverlessinbox/mailbox-cdk/commit/d682c9e49c9460f47cc36d3e4827ef5f8e05c365))

* **ownership** root-stack IAM conditions admit the stack id, or the name when a resource has no id tag ([45dd890](https://github.com/serverlessinbox/mailbox-cdk/commit/45dd890fbb0ff2b838f427c099a85bd86e657dbe))

### fix

* **mailbox-cognito** the bootstrap-user Lambda drops its unused AdminUpdateUserAttributes grant ([5186fa6](https://github.com/serverlessinbox/mailbox-cdk/commit/5186fa61c8a33c9c6772345b8fa65b1385743b6d))

* **mailbox-cognito** no import cycle in the OAuth addon; group-join and DCR cap failures are logged ([c07741c](https://github.com/serverlessinbox/mailbox-cdk/commit/c07741c33a7e172e3b96ef0210ea062164cd3b68))

* **mailbox-cdk** the stack-deployer starter may read its deployed stack during a parent rollback ([e04ccc5](https://github.com/serverlessinbox/mailbox-cdk/commit/e04ccc5ac2885b5782ac0ceef204d57190d28044))

* **mailbox-cognito** a DCR duplicate always carries its client id ([759c5c3](https://github.com/serverlessinbox/mailbox-cdk/commit/759c5c32ddbdfcbcc39af76bd3c0eb7a34997ba9))

### feat

* **tags** tag resources with the root stack id ([c83fbe1](https://github.com/serverlessinbox/mailbox-cdk/commit/c83fbe1595e21d5c0569682c4b04159cc1700f38))

* **cdk** give the edge stack a position-hashed name ([779e750](https://github.com/serverlessinbox/mailbox-cdk/commit/779e7506ef25c50481e1e9b41594ee7c179daef3))

## [0.3.0](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.9...v0.3.0) (Mon Oct 19 2026)

### refactor

* **shared** the parent-stack detector takes its CloudFormation client and a StackId ([f3c12ce](https://github.com/serverlessinbox/mailbox-cdk/commit/f3c12ce79025498124748f110881d0f1a219d403))

### fix

* **cognito** idp-users-api never leaves a half-created user ([364d11a](https://github.com/serverlessinbox/mailbox-cdk/commit/364d11afe5fc3eab185db23e0e3a41adc4b2d141))

### feat

* **mailbox** OAuth clients are named by API kind and app; both UIs are optional ([326a0eb](https://github.com/serverlessinbox/mailbox-cdk/commit/326a0eb329cbc403281291152f8e74adf68d8fb1))

## [0.2.9](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.8...v0.2.9) (Fri Oct 16 2026)

### ci

* build once in prepack and stage S3 artifacts on gitversion's postPack event ([e5fe7d8](https://github.com/serverlessinbox/mailbox-cdk/commit/e5fe7d837796cd62f73dc72f076087cd1fc796cc))

## [0.2.8](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.7...v0.2.8) (Fri Oct 16 2026)

### revert

* restore the cognito deployer's TagResource grant ([6fa8dd6](https://github.com/serverlessinbox/mailbox-cdk/commit/6fa8dd69cfe0685958356bd8e669bbaef2484a8c))

## [0.2.7](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.6...v0.2.7) (Fri Oct 16 2026)



## [0.2.6](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.5...v0.2.6) (Fri Oct 16 2026)

### feat

* Added an explicit issue in the cognito deployer to test failure sending ([49edcb0](https://github.com/serverlessinbox/mailbox-cdk/commit/49edcb03ee408ec90083851f3839b5b48c0a850d))

## [0.2.5](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.4...v0.2.5) (Fri Oct 16 2026)

### fix

* **cdk** admit CloudFormation tag keys; keep detector grants in its named policy ([02ff44b](https://github.com/serverlessinbox/mailbox-cdk/commit/02ff44b91789b4a89fb1249dac2b9a7ba584c2e1))

## [0.2.4](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.3...v0.2.4) (Fri Oct 16 2026)

### chore

* stop tracking the generated .jsii assemblies ([6d10c3a](https://github.com/serverlessinbox/mailbox-cdk/commit/6d10c3a83ce61f5cacfe8d013984fa01cacf3b52))

## [0.2.3](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.2...v0.2.3) (Fri Oct 16 2026)

### refactor

* **cdk** restructure the stack-deployer constructs to the code skills, with shared worker grants and the runtime-owned payload type ([6b2b85b](https://github.com/serverlessinbox/mailbox-cdk/commit/6b2b85b76cb58b693831371c13b51b43dac3df0a))

* **cognito** split the bootstrap-user Lambda into handler, request handler, answers and user ensurer, on the shared bad-config answer and branded identifiers ([072f18a](https://github.com/serverlessinbox/mailbox-cdk/commit/072f18a2f9e07f12a83430666e8f2d22306d97df))

* **cognito** one identity-provisioner client and the Cognito brands shared within mailbox-cognito ([07b4534](https://github.com/serverlessinbox/mailbox-cdk/commit/07b453455a33d99986edb36cd47cb441ef212c23))

* **cognito** split the idp-users-api Lambda into handler, admin API, service, mapper, validation and audit emitter; typed env contract and branded identifiers ([b568ebb](https://github.com/serverlessinbox/mailbox-cdk/commit/b568ebbfe36105411f62a823a6797c875d28e33b))

* **cognito** brand the identity-provisioner contract and add the Cognito ClientId and identity brands; jmap-oauth-dcr follows ([b32d2f9](https://github.com/serverlessinbox/mailbox-cdk/commit/b32d2f95b0c38c8ae08d00212da5541968ec71b6))

* **cognito** split the jmap-oauth-dcr Lambda into handler, client registration and answers; branded identifiers and a typed env contract ([8b6dea1](https://github.com/serverlessinbox/mailbox-cdk/commit/8b6dea1a4cd6f7ff64facad5776171f6895a4240))

* Lambda wrappers write their environment inline in super() with literal names; the env-name constants and environment types go ([1554635](https://github.com/serverlessinbox/mailbox-cdk/commit/1554635d2c7b0e8873ce91b3d6b720bedc04b5d0))

### test

* **cdk** share the CDK test helpers through a cdk-test-support export of mailbox-cdk-shared ([5479a0a](https://github.com/serverlessinbox/mailbox-cdk/commit/5479a0abec6603db9094052510a4e0cdcb82487c))

* one shared smoke-probe helper; mailbox-cognito enforces that its updater-managed Lambdas answer the probe ([8878aa7](https://github.com/serverlessinbox/mailbox-cdk/commit/8878aa76f64754f3236fc43b983df0fc416bc27b))

* **cognito** bootstrap-user tests per unit with template-key fixtures; the user pool types its custom-resource properties with the runtime payload ([d91cb86](https://github.com/serverlessinbox/mailbox-cdk/commit/d91cb86c13c2cd8e8981393c8451dbe866041e27))

* **cognito** idp-users-api tests per unit on aws-sdk-client-mock; the wrapper builds its typed environment and the addon documents its pool contract ([45eb866](https://github.com/serverlessinbox/mailbox-cdk/commit/45eb8660e9476da20515bdfa9b55d796b16de3c4))

* **cognito** jmap-oauth-dcr tests per unit; the wrapper builds its typed environment and the OAuth addon drops its casts ([edd0d7a](https://github.com/serverlessinbox/mailbox-cdk/commit/edd0d7ab199862b20fbf927fe2c4fe09741290f5))

### fix

* a custom-resource Delete answers SUCCESS on a config error or invalid properties (stack-helpers, data-override-resolver, content-deployer, bootstrap-user) ([e0ea119](https://github.com/serverlessinbox/mailbox-cdk/commit/e0ea119d3087ed53766108926ed9c4a23e7a55a5))

* **shared** deployer workers may write the Name and description tags ([4c1d4ec](https://github.com/serverlessinbox/mailbox-cdk/commit/4c1d4ecc8b6ad2608d424bfeccd29195b1eb8561))

## [0.2.2](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.1...v0.2.2) (Tue Oct 13 2026)

### chore

* remove internal plan references and the CI account ID from source and tests ([152d065](https://github.com/serverlessinbox/mailbox-cdk/commit/152d0658a2e41623f325a41b327d09a3264def1f))

* build Lambda zips into dist/lambdas and drop the retired ui-deployer bundle ([ba87f5d](https://github.com/serverlessinbox/mailbox-cdk/commit/ba87f5d3dab090bdd2f874e9d72e7034fd6c790d))

## [0.2.1](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.0...v0.2.1) (Mon Oct 12 2026)

### chore

* Updated artifact registry to 0.3.0 ([0fe0bc4](https://github.com/serverlessinbox/mailbox-cdk/commit/0fe0bc48854477ed129a75cf81a27d27249c61da))

## [0.2.0](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.19...v0.2.0) (Sun Oct 11 2026)

### feat

* publishable packages ship the registry record; release refreshes it (artifact-registry 0.1.3) ([c143255](https://github.com/serverlessinbox/mailbox-cdk/commit/c1432555e1803fd6dbd8930f9e49d75e95bc1e12))

* publishable packages ship artifact-versions.json in the { version, zone } shape; drop serverlessinbox.components ([d86cdaa](https://github.com/serverlessinbox/mailbox-cdk/commit/d86cdaa724886244fd58ed41d1b0e5fe8918c494))

* Granularity includes 'pinned'; docs per value ([8b6365d](https://github.com/serverlessinbox/mailbox-cdk/commit/8b6365d66833d2a0c2e6e4578f04f3881e76cb4e))

### fix

* migrate workspace configs to artifact-registry 0.1.3 ([6bca5f8](https://github.com/serverlessinbox/mailbox-cdk/commit/6bca5f8f8e762bd6aaa3c924429d76f0485ad717))

### refactor

* artifact resolver reports version and location; addons get it from the context ([1454d82](https://github.com/serverlessinbox/mailbox-cdk/commit/1454d829c07a2269519a18435db1e489bfbdbaee))

* mailbox-cognito takes the artifact-registry-cdk resolver ([cd2ae87](https://github.com/serverlessinbox/mailbox-cdk/commit/cd2ae87781155346699cf64a526a869336813ae3))

### test

* cognito and record-loader tests; drift guard for RegistryLocation ([01f5715](https://github.com/serverlessinbox/mailbox-cdk/commit/01f57152a9c9735e85127f13e62052ec8c365626))

* cognito tests pin with zone and build PinnedArtifactResolver ([7f688c5](https://github.com/serverlessinbox/mailbox-cdk/commit/7f688c5d7f0d06ba3c9bf7624acca22fd00508ce))

* drop the unread old-shape artifacts context from tests ([8ec0c6b](https://github.com/serverlessinbox/mailbox-cdk/commit/8ec0c6bbd2c671d7624b3204501e02ff62ed5610))

### chore

* artifact-versions placeholders follow the 0.1.3 shape and the shared deployer ([877c283](https://github.com/serverlessinbox/mailbox-cdk/commit/877c283013f7dc8fb6be997a14a878ccb21c16d1))

* mailbox-cdk packages on artifact-registry ^0.2.0 ([440f451](https://github.com/serverlessinbox/mailbox-cdk/commit/440f4516489e3577bcd2c5cab2abad69677378dd))

## [0.1.19](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.18...v0.1.19) (Tue Sep 29 2026)



## [0.1.18](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.17...v0.1.18) (Mon Sep 28 2026)

### refactor

* **cdk** deployer takes a bucket, narrow the UI content grant ([da21870](https://github.com/serverlessinbox/mailbox-cdk/commit/da21870806143b971c79fbfbfca8ccbb9363be11))

## [0.1.17](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.16...v0.1.17) (Mon Sep 28 2026)

### refactor

* **cdk** strip -vN replacement-safety suffixes from construct ids ([3b2157f](https://github.com/serverlessinbox/mailbox-cdk/commit/3b2157fec0286b66f01704cad1e95cea30bc9450))

### chore

* **cdk** trim publish manifest and fix clean scripts ([d8d44dd](https://github.com/serverlessinbox/mailbox-cdk/commit/d8d44dd1bf55664eb05314926079dfecda89705d))

## [0.1.16](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.15...v0.1.16) (Sun Sep 27 2026)

### fix

* **cognito** return 400 for Cognito input rejections on IdP user operations ([87a3343](https://github.com/serverlessinbox/mailbox-cdk/commit/87a3343c48d80074b745a011cb334550b7130bd1))

## [0.1.15](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.14...v0.1.15) (Sun Sep 27 2026)

### refactor

* **mailbox** converge auth-provider and addon extension points ([a73ebbd](https://github.com/serverlessinbox/mailbox-cdk/commit/a73ebbd86160152ff11c3861cb0f6b2633e5997d))

### feat

* **cognito** pre-provision the mailbox principal when an IdP user is created ([c460071](https://github.com/serverlessinbox/mailbox-cdk/commit/c4600712e034e56443216ac0ff181b0dedb439cd))

## [0.1.14](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.13...v0.1.14) (Fri Sep 25 2026)

### fix

* Fixed bootstrap user and refactored it ([6426b7c](https://github.com/serverlessinbox/mailbox-cdk/commit/6426b7ca02793b43c9bb1a314d526d485ac1e114))

## [0.1.13](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.12...v0.1.13) (Fri Sep 25 2026)



## [0.1.12](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.11...v0.1.12) (Tue Sep 22 2026)

### fix

* IAM Permission tightening + removal of the guided stack update ([1b6d7ef](https://github.com/serverlessinbox/mailbox-cdk/commit/1b6d7ef0bf3e4f189b890fe0bde06f583c11e571))

## [0.1.11](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.10...v0.1.11) (Sun Sep 20 2026)

### fix

* generate bootstrap password with a CSPRNG ([995c4c7](https://github.com/serverlessinbox/mailbox-cdk/commit/995c4c71b7393e470b2addd50fdded99cc528b2a))

## [0.1.10](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.9...v0.1.10) (Sun Sep 20 2026)



## [0.1.9](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.8...v0.1.9) (Sat Sep 19 2026)

### chore

* Removed temp snapshot tests ([f8503d1](https://github.com/serverlessinbox/mailbox-cdk/commit/f8503d1323ca56cc5c274951b29c7db96250197a))

### feat

* Rollback protection ([abf2772](https://github.com/serverlessinbox/mailbox-cdk/commit/abf2772e83754fcd40ca7525e0681e90ec507436))

## [0.1.8](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.7...v0.1.8) (Fri Sep 18 2026)

### chore

* Fixate baseline for testing ([9a873d0](https://github.com/serverlessinbox/mailbox-cdk/commit/9a873d07309047824fd978dd318704970cffacfb))

* exclude tests and fixtures from published packages. ([02f60a7](https://github.com/serverlessinbox/mailbox-cdk/commit/02f60a7cfd9594c8375b596e3bf83cc68de08008))

* Cleanup underscores ([1e2f0f1](https://github.com/serverlessinbox/mailbox-cdk/commit/1e2f0f101d9d2f78ec2ea8a63ac46f4bf1604582))

* Cleanup ([c48cc88](https://github.com/serverlessinbox/mailbox-cdk/commit/c48cc883c9f72844f0e749a708d5c85958314cc4))

### test

* key named resources by name in the permission gate ([2a5644a](https://github.com/serverlessinbox/mailbox-cdk/commit/2a5644a9278b7aaaa91c108988937a54cf42a045))

### refactor

* Queue handling ([ab76278](https://github.com/serverlessinbox/mailbox-cdk/commit/ab76278ffde4d2f54d9df17d943cae917e56d3f5))

* move StackHelpers to mailbox-cdk-shared ([01642c8](https://github.com/serverlessinbox/mailbox-cdk/commit/01642c8936109a17926c8dc4bd433e10bcfea686))

* Non resource bound grants ([fc42a26](https://github.com/serverlessinbox/mailbox-cdk/commit/fc42a26caf84ec2a7d2c2e4ac302c63255dc4d35))

* Data deployer in shared ([ad077fc](https://github.com/serverlessinbox/mailbox-cdk/commit/ad077fc6b8273ba90f416f7601266c9949ac5c54))

* Tag condition standardization ([418e5ef](https://github.com/serverlessinbox/mailbox-cdk/commit/418e5ef72a36957e521da71f7928061d61256353))

## [0.1.7](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.6...v0.1.7) (Wed Sep 16 2026)



## [0.1.6](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.5...v0.1.6) (Tue Sep 15 2026)

### chore

* Updated and synced deps ([5e67a9c](https://github.com/serverlessinbox/mailbox-cdk/commit/5e67a9ce76211a3671ab2ef9c30bec93570d276b))

### refactor

* **shared** move generic table, queue, Go Lambda, naming and resource-group constructs to mailbox-cdk-shared ([de02b86](https://github.com/serverlessinbox/mailbox-cdk/commit/de02b86e524ca123e61fde66a1e1c4ef675fe1e9))

## [0.1.5](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.4...v0.1.5) (Mon Sep 14 2026)



## [0.1.4](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.3...v0.1.4) (Mon Sep 14 2026)



## [0.1.3](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.2...v0.1.3) (Mon Sep 14 2026)



## [0.1.2](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.1...v0.1.2) (Mon Sep 14 2026)



## [0.1.1](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.0...v0.1.1) (Mon Sep 14 2026)



## [0.1.0](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.82...v0.1.0) (Sun Sep 13 2026)

### feat

* IAM Tightening ([a034cf7](https://github.com/serverlessinbox/mailbox-cdk/commit/a034cf713a7da72d73ada4f0aae6acd0f16e4513))

* Context keys rename ([50b08b0](https://github.com/serverlessinbox/mailbox-cdk/commit/50b08b07e1511df15990a02694e2a529ea6883f7))

* Deployer type changes ([f84580d](https://github.com/serverlessinbox/mailbox-cdk/commit/f84580dadc227612aefb5176bb827e2d9cbbe924))

* Vendor account wiring ([b4715e6](https://github.com/serverlessinbox/mailbox-cdk/commit/b4715e6268ee6fc1653a42e5f83f4750e0b1b6d0))

### chore

* Jsii generation ([c68aaf1](https://github.com/serverlessinbox/mailbox-cdk/commit/c68aaf1f36cc19b30c4ff1ad981f6d99a83997f5))

* Upgrade to node 24 ([3c1cac1](https://github.com/serverlessinbox/mailbox-cdk/commit/3c1cac14023292da0d97dec0d46507014baebd02))

### refactor

* **cognito** Lambdas load config via the shared loader, clients injected ([8699903](https://github.com/serverlessinbox/mailbox-cdk/commit/8699903b6af0b163312ffdc3bc8229d93b49a7c6))

## [0.0.82](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.81...v0.0.82) (Wed Sep 09 2026)

### refactor

* rename minted to issued in DCR docstring ([9340433](https://github.com/serverlessinbox/mailbox-cdk/commit/9340433a451132ef03385a64f53b6be60e03fdf4))

## [0.0.81](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.80...v0.0.81) (Mon Sep 07 2026)



## [0.0.80](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.79...v0.0.80) (Mon Sep 07 2026)



## [0.0.79](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.78...v0.0.79) (Sun Sep 06 2026)



## [0.0.78](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.77...v0.0.78) (Sun Sep 06 2026)

### fix

* Update test caes ([9078e7d](https://github.com/serverlessinbox/mailbox-cdk/commit/9078e7d8d94791273aaef754342a9c06d497a4f9))

* Log and logic fixes ([de65128](https://github.com/serverlessinbox/mailbox-cdk/commit/de65128ad8185a67ceabdf743ccaac7a06773881))

* read custom env vars at the lambda entry point ([01a05ce](https://github.com/serverlessinbox/mailbox-cdk/commit/01a05cec7a5fb22558ef0dea14d90b535f5df7db))

* auditEventsQueue is required, not optional ([da3741b](https://github.com/serverlessinbox/mailbox-cdk/commit/da3741b50d7b57d2e93e182f9f89e4808257850f))

* Updated tags ([5387e42](https://github.com/serverlessinbox/mailbox-cdk/commit/5387e42fd1e64a92bbdfcdf01253fcd73ffee443))

* Extra tag redirect ([d2f28ce](https://github.com/serverlessinbox/mailbox-cdk/commit/d2f28ce1ac726f9f693056f181c6aae45a309a9e))

### feat

* Support access addon ([c1c9138](https://github.com/serverlessinbox/mailbox-cdk/commit/c1c9138b88e4226d1c3e2346e25ecc7ad9e177fd))

* Loggin improvements ([09ae896](https://github.com/serverlessinbox/mailbox-cdk/commit/09ae89639d36aadb6c44cf96e70d2fb96451f0c7))

* Log updates ([b17fcb4](https://github.com/serverlessinbox/mailbox-cdk/commit/b17fcb4c3ea698f75d94c3ea0458b013a8cb8e74))

* every Lambda declares its pipeline ([3e99a99](https://github.com/serverlessinbox/mailbox-cdk/commit/3e99a99e5864074dfe8bcb55f9e3f03442d93432))

### refactor

* Clean interfaces and construc boundaries ([736034c](https://github.com/serverlessinbox/mailbox-cdk/commit/736034cf9b5adc70539945e2d91421924b82932c))

### chore

* Build tweaking ([13bdc02](https://github.com/serverlessinbox/mailbox-cdk/commit/13bdc0265ba088570d44e80f8f3caf76feda5d23))

## [0.0.77](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.76...v0.0.77) (Tue Aug 25 2026)



## [0.0.76](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.75...v0.0.76) (Tue Aug 25 2026)

### feat

* Smoke test ([82c56a9](https://github.com/serverlessinbox/mailbox-cdk/commit/82c56a9048e947facffae977532c30c47632e370))

## [0.0.75](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.74...v0.0.75) (Sun Aug 23 2026)

### chore

* Task state ([ea32721](https://github.com/serverlessinbox/mailbox-cdk/commit/ea327213be609c1b5515781c8308f4dcfae89658))

## [0.0.74](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.73...v0.0.74) (Sun Aug 23 2026)

### fix

* Misc fixes ([bbb273e](https://github.com/serverlessinbox/mailbox-cdk/commit/bbb273e3b5496d09c45ee7a3b16b75fa9e043078))

## [0.0.73](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.72...v0.0.73) (Sat Aug 22 2026)



## [0.0.72](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.71...v0.0.72) (Sat Aug 22 2026)

### feat

* Assets deployer ([9f9a5ee](https://github.com/serverlessinbox/mailbox-cdk/commit/9f9a5ee2494da0d91462910a72a287c729167958))

* JMap addon ([797f91c](https://github.com/serverlessinbox/mailbox-cdk/commit/797f91cc6e87fee0c52ef08a722862ebd96355c2))

* Dynamic client registration for oauth ([83feca3](https://github.com/serverlessinbox/mailbox-cdk/commit/83feca3987185f7d72b9aed4147b6d1066232f91))

* Dynamic client registration with cfn condition ([8f8e6cc](https://github.com/serverlessinbox/mailbox-cdk/commit/8f8e6cca1f9e18a948702a59d8460e7ebf305182))

### fix

* Renamed user provisior to identity provisior ([6653726](https://github.com/serverlessinbox/mailbox-cdk/commit/66537266ef451a44f53ebfcbd7133463b8a776fe))

## [0.0.71](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.70...v0.0.71) (Sat Aug 15 2026)



## [0.0.70](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.69...v0.0.70) (Sat Aug 15 2026)



## [0.0.69](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.68...v0.0.69) (Thu Aug 13 2026)

### fix

* Misc tests ([cf0ad10](https://github.com/serverlessinbox/mailbox-cdk/commit/cf0ad10a9eca7705a0737f3cddae69fd451b28f1))

* Dev publish fix ([e895552](https://github.com/serverlessinbox/mailbox-cdk/commit/e895552081d7dfac5f77dfc5b92a2242066fad19))

* Cognito domain name and kms retry ([7b2aa0e](https://github.com/serverlessinbox/mailbox-cdk/commit/7b2aa0e67ba9c31dc0add0924178a1c1527da500))

* Config for tests ([a255e73](https://github.com/serverlessinbox/mailbox-cdk/commit/a255e73320dc78c822fbfe402242ebdfe146c241))

### feat

* Delete idp user ([417cde3](https://github.com/serverlessinbox/mailbox-cdk/commit/417cde370a5bf8925175a4157ccc3e636e0a8054))

## [0.0.68](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.67...v0.0.68) (Mon Aug 03 2026)



## [0.0.67](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.66...v0.0.67) (Mon Aug 03 2026)



## [0.0.66](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.65...v0.0.66) (Mon Aug 03 2026)



## [0.0.65](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.64...v0.0.65) (Mon Aug 03 2026)



## [0.0.64](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.63...v0.0.64) (Mon Aug 03 2026)



## [0.0.63](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.62...v0.0.63) (Sun Aug 02 2026)



## [0.0.62](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.61...v0.0.62) (Sun Aug 02 2026)

### feat

* Added descriptions ([af710c6](https://github.com/serverlessinbox/mailbox-cdk/commit/af710c6284f69406e5c18d182dec2d46585b577c))

## [0.0.61](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.60...v0.0.61) (Fri Jul 17 2026)



## [0.0.60](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.59...v0.0.60) (Tue Jul 14 2026)



## [0.0.59](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.58...v0.0.59) (Tue Jul 14 2026)



## [0.0.58](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.57...v0.0.58) (Tue Jul 14 2026)



## [0.0.57](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.56...v0.0.57) (Tue Jul 14 2026)



## [0.0.56](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.55...v0.0.56) (Tue Jul 14 2026)



## [0.0.55](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.54...v0.0.55) (Tue Jul 14 2026)



## [0.0.54](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.53...v0.0.54) (Mon Jul 13 2026)

### feat

* Update api updates ([7ac62da](https://github.com/serverlessinbox/mailbox-cdk/commit/7ac62da237be3a31535e0ac2ce6849f89ed33a29))

## [0.0.53](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.52...v0.0.53) (Mon Jul 13 2026)



## [0.0.52](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.51...v0.0.52) (Sat Jul 11 2026)



## [0.0.51](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.50...v0.0.51) (Sat Jul 11 2026)



## [0.0.50](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.49...v0.0.50) (Fri Jul 10 2026)

### fix

* Updater handling ([24c9b87](https://github.com/serverlessinbox/mailbox-cdk/commit/24c9b87afd99d477c022f951796af6a2e826c021))

## [0.0.49](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.48...v0.0.49) (Fri Jul 10 2026)

### fix

* More testing ([2252b51](https://github.com/serverlessinbox/mailbox-cdk/commit/2252b5191793e6d642c100224d261202f71f75be))

## [0.0.48](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.47...v0.0.48) (Fri Jul 10 2026)

### feat

* Abac ([1db3fc6](https://github.com/serverlessinbox/mailbox-cdk/commit/1db3fc66612df95b21eca089e6e346888f0eb45c))

## [0.0.47](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.46...v0.0.47) (Fri Jul 10 2026)



## [0.0.46](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.45...v0.0.46) (Fri Jul 10 2026)



## [0.0.45](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.44...v0.0.45) (Fri Jul 10 2026)



## [0.0.44](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.43...v0.0.44) (Fri Jul 10 2026)



## [0.0.43](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.42...v0.0.43) (Thu Jul 09 2026)



## [0.0.42](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.41...v0.0.42) (Thu Jul 09 2026)



## [0.0.41](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.40...v0.0.41) (Thu Jul 09 2026)

### fix

* Double log retention ([f7192f7](https://github.com/serverlessinbox/mailbox-cdk/commit/f7192f7267151254c8ba851438915f50c9b27087))

## [0.0.40](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.39...v0.0.40) (Thu Jul 09 2026)



## [0.0.39](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.38...v0.0.39) (Thu Jul 09 2026)



## [0.0.38](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.37...v0.0.38) (Thu Jul 09 2026)

### feat

* Ui and edge auto update ([5165f6b](https://github.com/serverlessinbox/mailbox-cdk/commit/5165f6b0865acb9b640eabd73e84ba8a65db5a2d))

## [0.0.37](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.36...v0.0.37) (Thu Jul 09 2026)



## [0.0.36](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.35...v0.0.36) (Thu Jul 09 2026)



## [0.0.35](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.34...v0.0.35) (Thu Jul 09 2026)



## [0.0.34](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.33...v0.0.34) (Thu Jul 09 2026)



## [0.0.33](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.32...v0.0.33) (Thu Jul 09 2026)



## [0.0.32](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.31...v0.0.32) (Thu Jul 09 2026)



## [0.0.31](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.30...v0.0.31) (Thu Jul 09 2026)



## [0.0.30](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.29...v0.0.30) (Wed Jul 08 2026)

### feat

* Refactored auto update ([a54f9bf](https://github.com/serverlessinbox/mailbox-cdk/commit/a54f9bf401743e10ee0bea1c2650caf6273d6ba6))

## [0.0.29](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.28...v0.0.29) (Tue Jul 07 2026)

### fix

* Added region for resolver ([06001e3](https://github.com/serverlessinbox/mailbox-cdk/commit/06001e31c53d4969ff8ec4fc4e2fc46c656dfcf1))

## [0.0.28](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.27...v0.0.28) (Tue Jul 07 2026)



## [0.0.27](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.26...v0.0.27) (Tue Jul 07 2026)



## [0.0.26](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.25...v0.0.26) (Mon Jul 06 2026)

### fix

* Artifact-registry updates ([3fc9bb6](https://github.com/serverlessinbox/mailbox-cdk/commit/3fc9bb6862c9f8e8b2be1b06e3f520454f934698))

## [0.0.25](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.24...v0.0.25) (Mon Jul 06 2026)

### feat

* Dynamic track installation ([2b59811](https://github.com/serverlessinbox/mailbox-cdk/commit/2b598118c2570f353141fd258a75dc1f3658fcd3))

* New artifact-registry with logging ([46f3e11](https://github.com/serverlessinbox/mailbox-cdk/commit/46f3e11f84177213670539a4dfe092579d616384))

### fix

* Artifact-registry stable channel ([450054d](https://github.com/serverlessinbox/mailbox-cdk/commit/450054dfd211c559d1011ea768ada8bd33a0735f))

## [0.0.24](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.23...v0.0.24) (Fri Jul 03 2026)



## [0.0.23](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.22...v0.0.23) (Fri Jul 03 2026)



## [0.0.22](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.21...v0.0.22) (Fri Jul 03 2026)



## [0.0.21](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.20...v0.0.21) (Fri Jul 03 2026)



## [0.0.20](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.19...v0.0.20) (Fri Jul 03 2026)

### fix

* Sweeper fixes ([b1b56e9](https://github.com/serverlessinbox/mailbox-cdk/commit/b1b56e92d435b6e9b072e2385b966acb78dfd2f3))

## [0.0.19](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.18...v0.0.19) (Thu Jul 02 2026)



## [0.0.18](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.17...v0.0.18) (Thu Jul 02 2026)

### feat

* Deployer tag propagation ([8c360c1](https://github.com/serverlessinbox/mailbox-cdk/commit/8c360c19d9216f7c6ac7e6e277e74a974d44268c))

* Resource groups and tagging ([db9487b](https://github.com/serverlessinbox/mailbox-cdk/commit/db9487b502adc7a85f03b98d811440bff4e11d50))

### fix

* Custom resource timeout ([4e67fe6](https://github.com/serverlessinbox/mailbox-cdk/commit/4e67fe6a2e35837ba768ba6b66d455c905235afd))

## [0.0.17](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.16...v0.0.17) (Wed Jul 01 2026)



## [0.0.16](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.15...v0.0.16) (Wed Jul 01 2026)



## [0.0.15](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.14...v0.0.15) (Tue Jun 30 2026)



## [0.0.14](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.13...v0.0.14) (Tue Jun 30 2026)

### fix

* Versioning ([7b48fdf](https://github.com/serverlessinbox/mailbox-cdk/commit/7b48fdfced6a51d50623fa8e33e56153908960b9))

## [0.0.13](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.12...v0.0.13) (Tue Jun 30 2026)

### fix

* Versioning ([7b48fdf](https://github.com/serverlessinbox/mailbox-cdk/commit/7b48fdfced6a51d50623fa8e33e56153908960b9))

## [0.0.12](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.11...v0.0.12) (Tue Jun 30 2026)



## [0.0.11](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.10...v0.0.11) (Sat Jun 27 2026)



## [0.0.10](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.9...v0.0.10) (Fri Jun 26 2026)



## [0.0.9](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.8...v0.0.9) (Wed Jun 24 2026)

### fix

* linux version ([832ad7e](https://github.com/serverlessinbox/mailbox-cdk/commit/832ad7ea7371cab3a5793a69f8cdcccb66e19054))

## [0.0.8](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.7...v0.0.8) (Wed Jun 24 2026)

### chore

* Artifact registry ([c3e2765](https://github.com/serverlessinbox/mailbox-cdk/commit/c3e27656868573416f4d423bf5a5ffcc14cc3b16))

### fix

* Packing ([5bea90c](https://github.com/serverlessinbox/mailbox-cdk/commit/5bea90c51eb07c925806a1cec803ed3d94d2f2a5))

## [0.0.7](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.6...v0.0.7) (Fri Jun 19 2026)



## [0.0.6](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.5...v0.0.6) (Thu Jun 18 2026)

### feat

* Bundling code ([32f28e5](https://github.com/serverlessinbox/mailbox-cdk/commit/32f28e533efc7c943848b13819084607221997f6))

* Artifacts and cloud formation template generation ([63cd1f4](https://github.com/serverlessinbox/mailbox-cdk/commit/63cd1f484055d762e81d1655adb4ea09c2295f1b))

* Cognito data stack ([bcdc04f](https://github.com/serverlessinbox/mailbox-cdk/commit/bcdc04fb1987cc99255bcfde9100a316940b9c49))

### chore

* Cleanup old concepts ([9af540a](https://github.com/serverlessinbox/mailbox-cdk/commit/9af540ad38d14bb2ebd18c7708c9181824c33595))

## [0.0.5](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.4...v0.0.5) (Thu Jun 11 2026)



## [0.0.4](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.3...v0.0.4) (Wed Jun 10 2026)



## [0.0.3](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.2...v0.0.3) (Wed Jun 10 2026)

### feat

* Data stack extraction ([7f2e83b](https://github.com/serverlessinbox/mailbox-cdk/commit/7f2e83b80addd7950dda2b1290435492312296c5))

* New artifact tool ([2720e7f](https://github.com/serverlessinbox/mailbox-cdk/commit/2720e7f082102413d66f26d06a8b372c3310b75e))

* Artifact tooling update ([0b40723](https://github.com/serverlessinbox/mailbox-cdk/commit/0b40723603d1604c91bdb04d7b6ce15fa00117e9))

## [0.0.2](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.1...v0.0.2) (Mon Jun 08 2026)



## [0.0.1](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.0...v0.0.1) (Mon Jun 08 2026)

### feat

* build for jsii ([ec9b215](https://github.com/serverlessinbox/mailbox-cdk/commit/ec9b21543fc1e95dd5265600acc20be561058792))

* Gitversion configuration ([e9c552f](https://github.com/serverlessinbox/mailbox-cdk/commit/e9c552f26ffe875fc7690d1b8a8c15cdc0644da4))

* Pack and publish ([dc0c00f](https://github.com/serverlessinbox/mailbox-cdk/commit/dc0c00f3846d0ac2d474810b55b8af5b7fb45d7b))

* Fake registry url to prevent publish to npm for now ([5b8b7da](https://github.com/serverlessinbox/mailbox-cdk/commit/5b8b7da7b4c87fd4f9ffc35cfb6576e9c3d79d42))
