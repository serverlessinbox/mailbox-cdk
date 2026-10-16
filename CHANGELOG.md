
# Changelog

All notable changes to this project will be documented in this file


## [0.2.4](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.3...v0.2.4) (Fri Oct 16 2026)

### chore

* stop tracking the generated .jsii assemblies ([6d10c3a](https://github.com/serverlessinbox/mailbox-cdk/commit/6d10c3a83ce61f5cacfe8d013984fa01cacf3b52))

## [0.2.3](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.2...v0.2.3) (Fri Oct 16 2026)

### refactor

* **shared** restructure the stack-deployer Lambda runtime to the code skills, with a typed payload and a shared CaughtError ([9c3a1b5](https://github.com/serverlessinbox/mailbox-cdk/commit/9c3a1b59815905927d9525e8556ea479689a1edd))

* **cdk** restructure the stack-deployer constructs to the code skills, with shared worker grants and the runtime-owned payload type ([6b2b85b](https://github.com/serverlessinbox/mailbox-cdk/commit/6b2b85b76cb58b693831371c13b51b43dac3df0a))

* **shared** brand the stack-deployer identifiers so one kind cannot be passed as another ([94bf644](https://github.com/serverlessinbox/mailbox-cdk/commit/94bf644ee0e6ef7aa0132ea8edecb15fc0ac5f77))

* **shared** bring the shared content helpers to the code skills, with the CloudFront invalidation named for its concept ([063b234](https://github.com/serverlessinbox/mailbox-cdk/commit/063b234a1a7c71f05add6bcaa03def3e49e6c4ba))

* **mailbox** give the artifact-updater its typed config, events, identifiers and tag keys ([8cbf08f](https://github.com/serverlessinbox/mailbox-cdk/commit/8cbf08f20a96ed039ac1326e651c8079f08504be))

* **mailbox** give the artifact-updater one trigger interface with a single flush site, and enforce that every auto-updated Lambda answers the smoke-test probe ([8a0dfc2](https://github.com/serverlessinbox/mailbox-cdk/commit/8a0dfc250719b9b2680292dc82fce905ba0cfa04))

* **mailbox** restructure the blob-authorizer Lambda@Edge to the code skills, answer the smoke-test probe, and share the Branded type ([e2991a8](https://github.com/serverlessinbox/mailbox-cdk/commit/e2991a87892dbdfdd6cf5b134010b16ae7d9e55d))

* **shared** move Branded, the custom-resource and AWS identifiers, and the tag keys into the shared runtime ([5d986c0](https://github.com/serverlessinbox/mailbox-cdk/commit/5d986c073866e5101da128d996ed3fd29dc660a3))

* **mailbox** move the artifact-updater and blob-authorizer onto the shared identifiers and tag keys, and brand the blob-authorizer's auth identifiers ([634398d](https://github.com/serverlessinbox/mailbox-cdk/commit/634398d2ca4b84c8794c6980971bc95b52aedac2))

* **mailbox** rename the blob-authorizer Lambda@Edge to jmap-blob-download, including its artifact, tags, edge-stack parameters and construct ids ([1c6e057](https://github.com/serverlessinbox/mailbox-cdk/commit/1c6e0572fa4c07879f923411c21db5b61a89c348))

* **mailbox** split the artifact updater constructs; typed env-name contract ([96f3243](https://github.com/serverlessinbox/mailbox-cdk/commit/96f3243fdf155156facac6de8cb6140b396b264a))

* **cognito** split the bootstrap-user Lambda into handler, request handler, answers and user ensurer, on the shared bad-config answer and branded identifiers ([072f18a](https://github.com/serverlessinbox/mailbox-cdk/commit/072f18a2f9e07f12a83430666e8f2d22306d97df))

* **cognito** one identity-provisioner client and the Cognito brands shared within mailbox-cognito ([07b4534](https://github.com/serverlessinbox/mailbox-cdk/commit/07b453455a33d99986edb36cd47cb441ef212c23))

* **cognito** split the idp-users-api Lambda into handler, admin API, service, mapper, validation and audit emitter; typed env contract and branded identifiers ([b568ebb](https://github.com/serverlessinbox/mailbox-cdk/commit/b568ebbfe36105411f62a823a6797c875d28e33b))

* **shared** TenantId, Issuer and AccountId move into the shared runtime beside the new FunctionName and QueueUrl brands; jmap-blob-download imports them ([83939ad](https://github.com/serverlessinbox/mailbox-cdk/commit/83939ad1bd03fc07afca45cefeb217649bffa45d))

* **cognito** brand the identity-provisioner contract and add the Cognito ClientId and identity brands; jmap-oauth-dcr follows ([b32d2f9](https://github.com/serverlessinbox/mailbox-cdk/commit/b32d2f95b0c38c8ae08d00212da5541968ec71b6))

* **cognito** split the jmap-oauth-dcr Lambda into handler, client registration and answers; branded identifiers and a typed env contract ([8b6dea1](https://github.com/serverlessinbox/mailbox-cdk/commit/8b6dea1a4cd6f7ff64facad5776171f6895a4240))

* **mailbox** sweeper constructs with named grants, one execution-grant list for policy and permissions boundary, a shared worker retry loop and typed name contracts ([2f16215](https://github.com/serverlessinbox/mailbox-cdk/commit/2f1621592d3456c7318b6265c2b78a86f36f19aa))

* **mailbox** bootstrap and admin-api wrappers with named grants and their full environment inline in super(); the misplaced bootstrap test merges into the wrapper's test ([b44ab2a](https://github.com/serverlessinbox/mailbox-cdk/commit/b44ab2ae45f07846a2141e642c14035834e46f07))

* Lambda wrappers write their environment inline in super() with literal names; the env-name constants and environment types go ([1554635](https://github.com/serverlessinbox/mailbox-cdk/commit/1554635d2c7b0e8873ce91b3d6b720bedc04b5d0))

* **shared** logger buffer, env loaders, smoke-test wrapper, manual finalize and rollback detector to the skills; typanion probe guard; tests per unit on aws-sdk-client-mock ([b2650ec](https://github.com/serverlessinbox/mailbox-cdk/commit/b2650ec12aadd8c7e4e09a5458507c0a730a487c))

### test

* **cdk** share the CDK test helpers through a cdk-test-support export of mailbox-cdk-shared ([5479a0a](https://github.com/serverlessinbox/mailbox-cdk/commit/5479a0abec6603db9094052510a4e0cdcb82487c))

* one shared smoke-probe helper; mailbox-cognito enforces that its updater-managed Lambdas answer the probe ([8878aa7](https://github.com/serverlessinbox/mailbox-cdk/commit/8878aa76f64754f3236fc43b983df0fc416bc27b))

* **cognito** bootstrap-user tests per unit with template-key fixtures; the user pool types its custom-resource properties with the runtime payload ([d91cb86](https://github.com/serverlessinbox/mailbox-cdk/commit/d91cb86c13c2cd8e8981393c8451dbe866041e27))

* **cognito** idp-users-api tests per unit on aws-sdk-client-mock; the wrapper builds its typed environment and the addon documents its pool contract ([45eb866](https://github.com/serverlessinbox/mailbox-cdk/commit/45eb8660e9476da20515bdfa9b55d796b16de3c4))

* **cognito** jmap-oauth-dcr tests per unit; the wrapper builds its typed environment and the OAuth addon drops its casts ([edd0d7a](https://github.com/serverlessinbox/mailbox-cdk/commit/edd0d7ab199862b20fbf927fe2c4fe09741290f5))

* **mailbox** sweeper tests per unit — each removal, the retry loop, the shared execution grants, the workflow, both wrappers and the retain helper ([4bf7e64](https://github.com/serverlessinbox/mailbox-cdk/commit/4bf7e6460767474171677b89c0adc68612773379))

### fix

* **mailbox** keep updated Lambda code only when its smoke test passes, and split the artifact-updater's update operations into classes ([58fcf79](https://github.com/serverlessinbox/mailbox-cdk/commit/58fcf79fb7e372a8091d541b1eb9aace8bd7d00a))

* **mailbox** probe a new edge function version before CloudFront serves it, and give the artifact-updater its edge, UI and cycle classes ([bdcb8a2](https://github.com/serverlessinbox/mailbox-cdk/commit/bdcb8a25c2a4cf8122012492b8b986323ce4faaa))

* **shared** bucket-auto-empty Delete needs only the bucket name, stops before the Lambda deadline, and answers SUCCESS for an empty or missing bucket ([63492a4](https://github.com/serverlessinbox/mailbox-cdk/commit/63492a4d861696204375d02f1954fed7e6477abe))

* a custom-resource Delete answers SUCCESS on a config error or invalid properties (stack-helpers, data-override-resolver, content-deployer, bootstrap-user) ([e0ea119](https://github.com/serverlessinbox/mailbox-cdk/commit/e0ea119d3087ed53766108926ed9c4a23e7a55a5))

* **shared** the stack-deployer caps DELETE_FAILED retries at the poll cap, so a Delete is answered inside the service timeout ([c510c2d](https://github.com/serverlessinbox/mailbox-cdk/commit/c510c2df0c4459f4652f898acd2d5852d305a297))

* **cdk** retain stack-failure detector resources on create rollback ([37391d4](https://github.com/serverlessinbox/mailbox-cdk/commit/37391d4cadac200d2555000e52b04e90ad6bb829))

* **shared** deployer workers may write the Name and description tags ([4c1d4ec](https://github.com/serverlessinbox/mailbox-cdk/commit/4c1d4ecc8b6ad2608d424bfeccd29195b1eb8561))

### chore

* **scripts** template baseline synthesizes the bootstrap-user and DCR Lambdas ([08a78f4](https://github.com/serverlessinbox/mailbox-cdk/commit/08a78f4af10f21c37be75670de16941090e8fcd8))

## [0.2.2](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.1...v0.2.2) (Tue Oct 13 2026)

### chore

* remove internal plan references and the CI account ID from source and tests ([152d065](https://github.com/serverlessinbox/mailbox-cdk/commit/152d0658a2e41623f325a41b327d09a3264def1f))

* build Lambda zips into dist/lambdas and drop the retired ui-deployer bundle ([ba87f5d](https://github.com/serverlessinbox/mailbox-cdk/commit/ba87f5d3dab090bdd2f874e9d72e7034fd6c790d))

* **shared** require SERVICE_NAME, remove backward-compat reads ([95a7518](https://github.com/serverlessinbox/mailbox-cdk/commit/95a7518cec93a4fab71cb49893adabdc9736924f))

* **mailbox** require SERVICE_NAME, drop the sweeper's old property-shape shim ([de5cadb](https://github.com/serverlessinbox/mailbox-cdk/commit/de5cadb566db2db2846578dac5a304a895c6f592))

### refactor

* **shared** move naming helpers into src/naming ([d1b006c](https://github.com/serverlessinbox/mailbox-cdk/commit/d1b006cea3b43b9498cc789541f36ee17739aa5e))

* **mailbox** restructure the resource-sweeper Lambda to the code skills, with typed removal payloads ([eb9762e](https://github.com/serverlessinbox/mailbox-cdk/commit/eb9762e2621a5f161ee476694a9f37243d1099fb))

* **mailbox** restructure the data-override-resolver Lambda to the code skills, with a typed payload ([5491468](https://github.com/serverlessinbox/mailbox-cdk/commit/549146888b7e195ed698e0444123109d47a02834))

* **shared** restructure the stack-helpers Lambda to the code skills, with a typed payload ([e10c110](https://github.com/serverlessinbox/mailbox-cdk/commit/e10c110e7906fe1dc699b2c08f2524220aeb2546))

* **shared** restructure the bucket-auto-empty Lambda to the code skills, with a typed payload ([30398b3](https://github.com/serverlessinbox/mailbox-cdk/commit/30398b396042ae75165765ba156893cea0052fcc))

* **shared** restructure the content-deployer Lambda to the code skills and share the custom-resource request, failure answers and base config across the cleaned Lambdas ([a903927](https://github.com/serverlessinbox/mailbox-cdk/commit/a903927e8194e51fc14217f012fe3bc108370b0a))

### fix

* **sweeper** sweep on Delete only while the stack is being deleted ([01ad53a](https://github.com/serverlessinbox/mailbox-cdk/commit/01ad53a4d568f277de63df1fbd8d2736f8e73c4d))

### feat

* **shared** complete ARN parser and ExpectedFailure in the Lambda runtime ([15b050b](https://github.com/serverlessinbox/mailbox-cdk/commit/15b050ba6299275dc283d24b1396619d4e12a084))

* **scripts** template-baseline capture and diff for byte-identical refactors ([20cd2b1](https://github.com/serverlessinbox/mailbox-cdk/commit/20cd2b12925387f6c32519e23efb788e27d0fa94))

### docs

* **mailbox** trim resource-sweeper and sweeper comments to what the code does not say ([1aea716](https://github.com/serverlessinbox/mailbox-cdk/commit/1aea71670c7211df417cfaadafedab51b8e07850))

## [0.2.1](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.0...v0.2.1) (Mon Oct 12 2026)

### chore

* Updated artifact registry to 0.3.0 ([0fe0bc4](https://github.com/serverlessinbox/mailbox-cdk/commit/0fe0bc48854477ed129a75cf81a27d27249c61da))

## [0.2.0](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.19...v0.2.0) (Sun Oct 11 2026)

### chore

* Cleanup build ([5b35809](https://github.com/serverlessinbox/mailbox-cdk/commit/5b358094d36b4f2816293f1b4c553d58f098c8dc))

* Linting ([8853e4e](https://github.com/serverlessinbox/mailbox-cdk/commit/8853e4e9e9d6defe7b92f572f0c972730c503057))

* Drop publish manifest ([9477067](https://github.com/serverlessinbox/mailbox-cdk/commit/9477067fca52329769b46143e0949419c6bde89b))

* artifact-versions placeholders follow the 0.1.3 shape and the shared deployer ([877c283](https://github.com/serverlessinbox/mailbox-cdk/commit/877c283013f7dc8fb6be997a14a878ccb21c16d1))

* drop the orphaned root artifact-versions.json ([039948a](https://github.com/serverlessinbox/mailbox-cdk/commit/039948aeebb427d5cb03a0efd21fa8c93c61f6e5))

* mailbox-cdk packages on artifact-registry ^0.2.0 ([440f451](https://github.com/serverlessinbox/mailbox-cdk/commit/440f4516489e3577bcd2c5cab2abad69677378dd))

* remove mailbox-cognito-identity-center ([35e1ee1](https://github.com/serverlessinbox/mailbox-cdk/commit/35e1ee131da640c3959cd36950c0c0d8f61675fe))

### refactor

* mailbox-bundler to the house standard (one class per file, async I/O, typed loads, documented CLI) ([d5b00ed](https://github.com/serverlessinbox/mailbox-cdk/commit/d5b00ede79620a8cf424b93e99aeadfa2284e21c))

* artifact resolver reports version and location; addons get it from the context ([1454d82](https://github.com/serverlessinbox/mailbox-cdk/commit/1454d829c07a2269519a18435db1e489bfbdbaee))

* stack-deployer and stack-helpers move to mailbox-cdk-shared ([8637316](https://github.com/serverlessinbox/mailbox-cdk/commit/86373161fcb2cf50c4bccff42049d3ca21dc8544))

* artifact-updater clients built once at the entry point ([6826a1c](https://github.com/serverlessinbox/mailbox-cdk/commit/6826a1c766fc5e095726fca1e204e8a4d729260e))

* mailbox-cdk-shared resolves through artifact-registry-cdk; artifact-engine removed ([d7ca54c](https://github.com/serverlessinbox/mailbox-cdk/commit/d7ca54c48c5411437d4184695443bdd448d099dc))

* shared constructs take the artifact-registry-cdk resolver; no package registration ([e4263cc](https://github.com/serverlessinbox/mailbox-cdk/commit/e4263cc55f28ca32943fe0d17e7bfaad7c30d9a8))

* mailbox Lambda wrappers take the artifact-registry-cdk resolver (1/2) ([009f19a](https://github.com/serverlessinbox/mailbox-cdk/commit/009f19a20285b3ac847f62e23590c1f41c7af8b3))

* mailbox Lambda wrappers take the artifact-registry-cdk resolver (2/2) ([dea61e0](https://github.com/serverlessinbox/mailbox-cdk/commit/dea61e0339a09b175f48a7655911a49ff3ea06b9))

* mailbox takes the artifact-registry-cdk resolver; drops its own IArtifactResolver ([9e9a5d1](https://github.com/serverlessinbox/mailbox-cdk/commit/9e9a5d129fa891d73e3965fe617d99e2b45e6b92))

* mailbox constructs take the artifact-registry-cdk resolver (1/2) ([11800c1](https://github.com/serverlessinbox/mailbox-cdk/commit/11800c10a86256306b1350ba795515d856fc65bb))

* mailbox constructs take the artifact-registry-cdk resolver (2/2) ([1abb846](https://github.com/serverlessinbox/mailbox-cdk/commit/1abb8466b9cd74c784357c982bdbb52ce73c3ca8))

* mailbox-cognito takes the artifact-registry-cdk resolver ([cd2ae87](https://github.com/serverlessinbox/mailbox-cdk/commit/cd2ae87781155346699cf64a526a869336813ae3))

* MailboxUi takes a named uiConfig type; root-stack tag comes from the base-tags aspect ([4de4c3a](https://github.com/serverlessinbox/mailbox-cdk/commit/4de4c3a08ce16b97a1d881619a7e5125ad17c0df))

### feat

* publishable packages ship the registry record; release refreshes it (artifact-registry 0.1.3) ([c143255](https://github.com/serverlessinbox/mailbox-cdk/commit/c1432555e1803fd6dbd8930f9e49d75e95bc1e12))

* publishable packages ship artifact-versions.json in the { version, zone } shape; drop serverlessinbox.components ([d86cdaa](https://github.com/serverlessinbox/mailbox-cdk/commit/d86cdaa724886244fd58ed41d1b0e5fe8918c494))

* release bakes artifact-versions.json ({ version, zone }; own packages at the bumped version) ([9488468](https://github.com/serverlessinbox/mailbox-cdk/commit/9488468add83bfb23f09b39122a9f9b867bc4377))

* Granularity includes 'pinned'; docs per value ([8b6365d](https://github.com/serverlessinbox/mailbox-cdk/commit/8b6365d66833d2a0c2e6e4578f04f3881e76cb4e))

### fix

* migrate workspace configs to artifact-registry 0.1.3 ([6bca5f8](https://github.com/serverlessinbox/mailbox-cdk/commit/6bca5f8f8e762bd6aaa3c924429d76f0485ad717))

* support addon reports available:false when DISABLED; provider in its own file; tests per unit ([9549c78](https://github.com/serverlessinbox/mailbox-cdk/commit/9549c781d66b051ccae07a9f4a9709349fa4a24f))

### test

* shared construct tests for the resolver contract and the registry record ([261ed90](https://github.com/serverlessinbox/mailbox-cdk/commit/261ed9044e3defceee027e4da42895ba5cbc45f2))

* shared handler tests follow the stack-deployer move and the test type-check ([cb260b1](https://github.com/serverlessinbox/mailbox-cdk/commit/cb260b1201e6f2ec8abc05341c7016fdd3366d42))

* cognito and record-loader tests; drift guard for RegistryLocation ([01f5715](https://github.com/serverlessinbox/mailbox-cdk/commit/01f57152a9c9735e85127f13e62052ec8c365626))

* artifact-updater tests inject clients; deployer pins follow the shared package ([8caea2a](https://github.com/serverlessinbox/mailbox-cdk/commit/8caea2a2cdd27e669b9c9e599378b8ed2411f4de))

* mailbox construct tests follow the resolver contract and addon context ([3acea5a](https://github.com/serverlessinbox/mailbox-cdk/commit/3acea5a7dcc0d14ef341f2e96755697fca4b6740))

* Lambda construct tests pass a registry location to PinnedResolver ([3030a61](https://github.com/serverlessinbox/mailbox-cdk/commit/3030a611c1b8b023360238f3b4e428de968f5c19))

* shared construct tests build PinnedArtifactResolver directly ([4c4e27a](https://github.com/serverlessinbox/mailbox-cdk/commit/4c4e27ac99d471a87a15c756e48c4caec427511b))

* mailbox Lambda construct tests build PinnedArtifactResolver directly ([68d4b44](https://github.com/serverlessinbox/mailbox-cdk/commit/68d4b446488cbc2c6092337a035e7d508d90a39c))

* mailbox construct tests pin with zone and build PinnedArtifactResolver ([1874fa1](https://github.com/serverlessinbox/mailbox-cdk/commit/1874fa1a470a1e0025b15484278077ca92a68667))

* remaining mailbox tests build PinnedArtifactResolver directly ([cca49ec](https://github.com/serverlessinbox/mailbox-cdk/commit/cca49ec4790bbda34b3032635c6f905f397102fc))

* cognito tests pin with zone and build PinnedArtifactResolver ([7f688c5](https://github.com/serverlessinbox/mailbox-cdk/commit/7f688c5d7f0d06ba3c9bf7624acca22fd00508ce))

* drop the unread old-shape artifacts context from tests ([8ec0c6b](https://github.com/serverlessinbox/mailbox-cdk/commit/8ec0c6bbd2c671d7624b3204501e02ff62ed5610))

* env loader test asserts the recorded problem; bake command test cannot touch the repo ([3b0be17](https://github.com/serverlessinbox/mailbox-cdk/commit/3b0be1787a06dafa62dad7f712e1e61fd7566c63))

### docs

* mailbox construct comments follow code-comments ([1c2e14a](https://github.com/serverlessinbox/mailbox-cdk/commit/1c2e14ab1e628c013d94890447130f4bdcf4e73e))

* artifact-updater comments describe their own code; .jsii carries the new docs ([3df1eee](https://github.com/serverlessinbox/mailbox-cdk/commit/3df1eee1dd0f961c29d777119a2473b2e3b806f2))

## [0.1.19](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.18...v0.1.19) (Tue Sep 29 2026)

### fix

* Misc fixes ([cbbcd14](https://github.com/serverlessinbox/mailbox-cdk/commit/cbbcd14ebc600c8ba3347c69f9075aadc0f51f7d))

## [0.1.18](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.17...v0.1.18) (Mon Sep 28 2026)

### fix

* **cdk** scope blob reads to tenants/ and grant KMS on customer keys ([6ab011d](https://github.com/serverlessinbox/mailbox-cdk/commit/6ab011d8b243c8d2ff0da95c70bec09a31a99fa5))

### refactor

* **cdk** deployer takes a bucket, narrow the UI content grant ([da21870](https://github.com/serverlessinbox/mailbox-cdk/commit/da21870806143b971c79fbfbfca8ccbb9363be11))

* **cdk** stop exposing the sweeper state machine as a raw member ([e1eb70c](https://github.com/serverlessinbox/mailbox-cdk/commit/e1eb70c09e72c7e54ead2f2ab572a15122b0acbf))

* **cdk** make the pipeline log group a construct that owns its grants ([0e899ef](https://github.com/serverlessinbox/mailbox-cdk/commit/0e899effbad20fb91c2866c049642bb1de0aab50))

* **cdk** make the pipeline log group a construct that owns its grants ([e4bcd65](https://github.com/serverlessinbox/mailbox-cdk/commit/e4bcd65d9ad0ec6b61592d096030b58ec715c5a9))

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

### feat

* Individual blob hmac ([3ed5f55](https://github.com/serverlessinbox/mailbox-cdk/commit/3ed5f559a4588b1235c91ca9866601b341ab1490))

### fix

* Websocket rights ([7b3d625](https://github.com/serverlessinbox/mailbox-cdk/commit/7b3d625f88112b8027356e55540d61984bad1947))

## [0.1.12](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.11...v0.1.12) (Tue Sep 22 2026)

### fix

* IAM Permission tightening + removal of the guided stack update ([1b6d7ef](https://github.com/serverlessinbox/mailbox-cdk/commit/1b6d7ef0bf3e4f189b890fe0bde06f583c11e571))

## [0.1.11](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.10...v0.1.11) (Sun Sep 20 2026)

### fix

* generate bootstrap password with a CSPRNG ([995c4c7](https://github.com/serverlessinbox/mailbox-cdk/commit/995c4c71b7393e470b2addd50fdded99cc528b2a))

### chore

* Cleanup unwanted outputs ([6c28ea7](https://github.com/serverlessinbox/mailbox-cdk/commit/6c28ea7747698ec3ba78daf08706fb53b941c265))

## [0.1.10](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.9...v0.1.10) (Sun Sep 20 2026)

### fix

* Tantivy consistency ([4ad1ba9](https://github.com/serverlessinbox/mailbox-cdk/commit/4ad1ba9c51057fe97c6e0f8e06241ca659177c22))

## [0.1.9](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.8...v0.1.9) (Sat Sep 19 2026)

### chore

* Removed temp snapshot tests ([f8503d1](https://github.com/serverlessinbox/mailbox-cdk/commit/f8503d1323ca56cc5c274951b29c7db96250197a))

### feat

* Rollback protection ([abf2772](https://github.com/serverlessinbox/mailbox-cdk/commit/abf2772e83754fcd40ca7525e0681e90ec507436))

## [0.1.8](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.7...v0.1.8) (Fri Sep 18 2026)

### chore

* Cleanup ([19bf8af](https://github.com/serverlessinbox/mailbox-cdk/commit/19bf8af5fb70eef75defe4ce8b7d4bcccb96ae08))

* Fixate baseline for testing ([9a873d0](https://github.com/serverlessinbox/mailbox-cdk/commit/9a873d07309047824fd978dd318704970cffacfb))

* exclude tests and fixtures from published packages. ([02f60a7](https://github.com/serverlessinbox/mailbox-cdk/commit/02f60a7cfd9594c8375b596e3bf83cc68de08008))

* Cleanup underscores ([1e2f0f1](https://github.com/serverlessinbox/mailbox-cdk/commit/1e2f0f101d9d2f78ec2ea8a63ac46f4bf1604582))

* Grant method wrappers ([cc4090c](https://github.com/serverlessinbox/mailbox-cdk/commit/cc4090cd73db7f6a6082d98d6625828948a1790f))

* License handling ([423f6d6](https://github.com/serverlessinbox/mailbox-cdk/commit/423f6d61df9aee540fd3bf34bfcde11d6328031f))

* Cleanup ([c48cc88](https://github.com/serverlessinbox/mailbox-cdk/commit/c48cc883c9f72844f0e749a708d5c85958314cc4))

### test

* key named resources by name in the permission gate ([2a5644a](https://github.com/serverlessinbox/mailbox-cdk/commit/2a5644a9278b7aaaa91c108988937a54cf42a045))

### feat

* auth-key-store, websocket table and push-api constructs with explicit least-privilege grants. ([dad7adc](https://github.com/serverlessinbox/mailbox-cdk/commit/dad7adca53122296177c882de5db20f0c4a93c36))

* auth-key-store callers use IAuthKeyStoreTable with least-privilege grants ([2c83725](https://github.com/serverlessinbox/mailbox-cdk/commit/2c83725b2447b42002e702b6a84f4346c618990d))

* websocket table and push API own their grants; replace main-stack tables instead of pinning. ([ee76c9d](https://github.com/serverlessinbox/mailbox-cdk/commit/ee76c9dd54e1fd9dffdbe909ea1766e3f08af150))

* data tables behind IDataTable with explicit least-privilege grants; remove data-stack public API ([95c687d](https://github.com/serverlessinbox/mailbox-cdk/commit/95c687d9dc28cf1a127a4b1dec4f6a0d71f0f0db))

### refactor

* Constructs placements and extraction ([0ef188a](https://github.com/serverlessinbox/mailbox-cdk/commit/0ef188af514fa647aed464c7a78aeea9a89eff4f))

* Queue handling ([ab76278](https://github.com/serverlessinbox/mailbox-cdk/commit/ab76278ffde4d2f54d9df17d943cae917e56d3f5))

* move StackHelpers to mailbox-cdk-shared ([01642c8](https://github.com/serverlessinbox/mailbox-cdk/commit/01642c8936109a17926c8dc4bd433e10bcfea686))

* Data blob store ([47e33cb](https://github.com/serverlessinbox/mailbox-cdk/commit/47e33cb329c12c5670dda17c5a5324eb077e2a07))

* Ui buckets ([a03dcff](https://github.com/serverlessinbox/mailbox-cdk/commit/a03dcffc74b3bcbbf523a1684d7baf40f30c84a8))

* Non resource bound grants ([fc42a26](https://github.com/serverlessinbox/mailbox-cdk/commit/fc42a26caf84ec2a7d2c2e4ac302c63255dc4d35))

* Data deployer in shared ([ad077fc](https://github.com/serverlessinbox/mailbox-cdk/commit/ad077fc6b8273ba90f416f7601266c9949ac5c54))

* Sweeper grants ([5c0be09](https://github.com/serverlessinbox/mailbox-cdk/commit/5c0be09549ea481afd11a459833a4254b9d5d304))

* Updater grants and lambda extracts ([dd0e184](https://github.com/serverlessinbox/mailbox-cdk/commit/dd0e1840b9a2d8d25332cc28dbb1cfc79c1d2c40))

* Tag condition standardization ([418e5ef](https://github.com/serverlessinbox/mailbox-cdk/commit/418e5ef72a36957e521da71f7928061d61256353))

## [0.1.7](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.6...v0.1.7) (Wed Sep 16 2026)

### feat

* Changed blobs => uploads s3 key ([a18bc6b](https://github.com/serverlessinbox/mailbox-cdk/commit/a18bc6b3be946150f5621b71faa84c4437f18440))

## [0.1.6](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.5...v0.1.6) (Tue Sep 15 2026)

### chore

* Updated and synced deps ([5e67a9c](https://github.com/serverlessinbox/mailbox-cdk/commit/5e67a9ce76211a3671ab2ef9c30bec93570d276b))

### refactor

* **shared** move generic table, queue, Go Lambda, naming and resource-group constructs to mailbox-cdk-shared ([de02b86](https://github.com/serverlessinbox/mailbox-cdk/commit/de02b86e524ca123e61fde66a1e1c4ef675fe1e9))

### feat

* Data stack resource standardization ([8b80fb2](https://github.com/serverlessinbox/mailbox-cdk/commit/8b80fb2d84efe2979463ac573af3139cc2e9c55d))

* Data table override through ssm parameter ([db79fe5](https://github.com/serverlessinbox/mailbox-cdk/commit/db79fe568cc75b38e0b3e21c816a06065a7e6c21))

* Name base standardisation ([4d722c8](https://github.com/serverlessinbox/mailbox-cdk/commit/4d722c846d277448b10081335eceaee294bf11b9))

## [0.1.5](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.4...v0.1.5) (Mon Sep 14 2026)

### chore

* Idl update ([a162827](https://github.com/serverlessinbox/mailbox-cdk/commit/a1628276c4a45d813e68265b063df52eb03d1640))

## [0.1.4](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.3...v0.1.4) (Mon Sep 14 2026)

### fix

* Invalidation on ui change ([2746c1c](https://github.com/serverlessinbox/mailbox-cdk/commit/2746c1c0043990aaff5da2f7d240f9fc92cf1584))

## [0.1.3](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.2...v0.1.3) (Mon Sep 14 2026)

### fix

* Split handler config ([4cebfc9](https://github.com/serverlessinbox/mailbox-cdk/commit/4cebfc96693259bd58fca696a3beeebd7a2e917d))

## [0.1.2](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.1...v0.1.2) (Mon Sep 14 2026)

### feat

* Stack update through state machine ([90facff](https://github.com/serverlessinbox/mailbox-cdk/commit/90facff08095cd287d6135a2c90580e03944ff5a))

## [0.1.1](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.0...v0.1.1) (Mon Sep 14 2026)

### fix

* Added missing permissions ([45c31dc](https://github.com/serverlessinbox/mailbox-cdk/commit/45c31dcc5350b9818e767425e47273d66cc5a5f1))

## [0.1.0](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.82...v0.1.0) (Sun Sep 13 2026)

### refactor

* expose stack failure detection infra via interfaces ([4727cc9](https://github.com/serverlessinbox/mailbox-cdk/commit/4727cc9add2ae53c5e861812b5fa34234837f052))

* **mailbox** drop env vars and IAM grants no Lambda reads ([082b106](https://github.com/serverlessinbox/mailbox-cdk/commit/082b106f0d7b40a3477ac625bf7419fa30051dc7))

* **mailbox** TS Lambdas load config once via the shared loader ([e241877](https://github.com/serverlessinbox/mailbox-cdk/commit/e2418779c186526b6edf86f43d725648c8251c64))

* **cdk-shared** CR Lambdas load config via tryLoad; Delete succeeds on bad config ([66a0232](https://github.com/serverlessinbox/mailbox-cdk/commit/66a0232c77504900cdb67baa30b0aefd018a42ab))

* **cognito** Lambdas load config via the shared loader, clients injected ([8699903](https://github.com/serverlessinbox/mailbox-cdk/commit/8699903b6af0b163312ffdc3bc8229d93b49a7c6))

### feat

* IAM Tightening ([a034cf7](https://github.com/serverlessinbox/mailbox-cdk/commit/a034cf713a7da72d73ada4f0aae6acd0f16e4513))

* Context keys rename ([50b08b0](https://github.com/serverlessinbox/mailbox-cdk/commit/50b08b07e1511df15990a02694e2a529ea6883f7))

* Deployer type changes ([f84580d](https://github.com/serverlessinbox/mailbox-cdk/commit/f84580dadc227612aefb5176bb827e2d9cbbe924))

* Context standardization ([13fee58](https://github.com/serverlessinbox/mailbox-cdk/commit/13fee5816c6f9bff8d7e59f603a4fd87183acbef))

* Removed unneeded exports from public api ([93b8005](https://github.com/serverlessinbox/mailbox-cdk/commit/93b800543a7625c95b8cb7f2ca2a26bcb6e68bd9))

* Tag keys and iam tightening ([ef3c807](https://github.com/serverlessinbox/mailbox-cdk/commit/ef3c8072f6a2c76c8a53688ac9a8930a810708fe))

* Vendor and tag chaining ([a6f1250](https://github.com/serverlessinbox/mailbox-cdk/commit/a6f1250bc970d06da61613c4fb525d0d095f1225))

* Vendor account wiring ([b4715e6](https://github.com/serverlessinbox/mailbox-cdk/commit/b4715e6268ee6fc1653a42e5f83f4750e0b1b6d0))

* Sweeper safeties ([7779e96](https://github.com/serverlessinbox/mailbox-cdk/commit/7779e9690a103e907ec447105e794eea4792ef78))

* Evn loader ([70b80c9](https://github.com/serverlessinbox/mailbox-cdk/commit/70b80c9ea60987f762d7c83dc2ddf13b8c98ab9c))

* TS logger emit-level parity with Go, shared LoggerBuffer, injected AWS clients ([9044682](https://github.com/serverlessinbox/mailbox-cdk/commit/9044682e1b8ac7dbbd1ec27282e843817604c77d))

### chore

* Test script fix ([6e53845](https://github.com/serverlessinbox/mailbox-cdk/commit/6e538453240f6abb4c7692de24f4dc612b352d85))

* Context, vendors account testing ([04569f7](https://github.com/serverlessinbox/mailbox-cdk/commit/04569f727475de82c33b02223f7dbbb99b774971))

* Jsii generation ([c68aaf1](https://github.com/serverlessinbox/mailbox-cdk/commit/c68aaf1f36cc19b30c4ff1ad981f6d99a83997f5))

* Clean up old cache table references ([ad5436b](https://github.com/serverlessinbox/mailbox-cdk/commit/ad5436bd70c76496710792773274133e80cea231))

* Upgrade to node 24 ([3c1cac1](https://github.com/serverlessinbox/mailbox-cdk/commit/3c1cac14023292da0d97dec0d46507014baebd02))

### fix

* IAM Tightening for send mail ([106ee12](https://github.com/serverlessinbox/mailbox-cdk/commit/106ee12670009911b955809fa0daa7c3f61a0151))

### test

* Fix testing ([390bb85](https://github.com/serverlessinbox/mailbox-cdk/commit/390bb85d3c27f9601f8345f97efc9296003728a9))

## [0.0.82](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.81...v0.0.82) (Wed Sep 09 2026)

### refactor

* Rename support access -> support ([804ce33](https://github.com/serverlessinbox/mailbox-cdk/commit/804ce339795a0a09d252bfafa76b57b4fe7b5964))

* Renamed support access -> support ([0f5dbab](https://github.com/serverlessinbox/mailbox-cdk/commit/0f5dbab318d3ce4be8ede831c6ba5c661145221f))

* Renamed support access -> support ([766f44e](https://github.com/serverlessinbox/mailbox-cdk/commit/766f44eb71b92a00f496b258ca158a0744642513))

* rename minted to issued in DCR docstring ([9340433](https://github.com/serverlessinbox/mailbox-cdk/commit/9340433a451132ef03385a64f53b6be60e03fdf4))

* **sweeper** one implementation per removal type ([709e418](https://github.com/serverlessinbox/mailbox-cdk/commit/709e4180cd49496a301a1870b9b3650272888a87))

### feat

* Stack failure detector ([df4dd5e](https://github.com/serverlessinbox/mailbox-cdk/commit/df4dd5e4e30adb4e26811012ca24b385ae56feff))

## [0.0.81](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.80...v0.0.81) (Mon Sep 07 2026)

### fix

* Grant api invoke ([7fa8a95](https://github.com/serverlessinbox/mailbox-cdk/commit/7fa8a95fc2213d51b4402bc75200831ab58b724d))

## [0.0.80](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.79...v0.0.80) (Mon Sep 07 2026)

### feat

* Uideployer fixes ([247d6af](https://github.com/serverlessinbox/mailbox-cdk/commit/247d6af63846753a74bb928816df465a96da9ec8))

## [0.0.79](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.78...v0.0.79) (Sun Sep 06 2026)

### feat

* Reexport tag types ([9066b86](https://github.com/serverlessinbox/mailbox-cdk/commit/9066b86b9e851fa8644ba3239f8ebf667740f256))

## [0.0.78](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.77...v0.0.78) (Sun Sep 06 2026)

### fix

* Update test caes ([9078e7d](https://github.com/serverlessinbox/mailbox-cdk/commit/9078e7d8d94791273aaef754342a9c06d497a4f9))

* Cleanup of unused variable ([fb1a24f](https://github.com/serverlessinbox/mailbox-cdk/commit/fb1a24f3e5df99e75d0de38ce9e9ce72f8e86cbb))

* Log and logic fixes ([de65128](https://github.com/serverlessinbox/mailbox-cdk/commit/de65128ad8185a67ceabdf743ccaac7a06773881))

* read custom env vars at the lambda entry point ([01a05ce](https://github.com/serverlessinbox/mailbox-cdk/commit/01a05cec7a5fb22558ef0dea14d90b535f5df7db))

* auditEventsQueue is required, not optional ([da3741b](https://github.com/serverlessinbox/mailbox-cdk/commit/da3741b50d7b57d2e93e182f9f89e4808257850f))

* Smoke test types ([1c83128](https://github.com/serverlessinbox/mailbox-cdk/commit/1c831285593786338fbbe0ece1532d73cdbc7de4))

* Cleanup of pipeline logic inside lambdas ([29f80e0](https://github.com/serverlessinbox/mailbox-cdk/commit/29f80e06b7078ad01e3a4ec1d5a31f2a54143d8e))

* Updated tags ([5387e42](https://github.com/serverlessinbox/mailbox-cdk/commit/5387e42fd1e64a92bbdfcdf01253fcd73ffee443))

* Extra tag redirect ([d2f28ce](https://github.com/serverlessinbox/mailbox-cdk/commit/d2f28ce1ac726f9f693056f181c6aae45a309a9e))

* Support access test case ([77e0bd2](https://github.com/serverlessinbox/mailbox-cdk/commit/77e0bd282e7af2ada7fa61949768dabdad1ae249))

### feat

* Support access addon ([c1c9138](https://github.com/serverlessinbox/mailbox-cdk/commit/c1c9138b88e4226d1c3e2346e25ecc7ad9e177fd))

* Loggin improvements ([09ae896](https://github.com/serverlessinbox/mailbox-cdk/commit/09ae89639d36aadb6c44cf96e70d2fb96451f0c7))

* Support access addon ([6d6661b](https://github.com/serverlessinbox/mailbox-cdk/commit/6d6661b094f75e6cebcd2360d5993ac387347f4e))

* Support access tweaking ([424db72](https://github.com/serverlessinbox/mailbox-cdk/commit/424db72073e5f7aaad701a38d41dd8ff6d868624))

* Log updates ([b17fcb4](https://github.com/serverlessinbox/mailbox-cdk/commit/b17fcb4c3ea698f75d94c3ea0458b013a8cb8e74))

* Pipelines ([5c05ccf](https://github.com/serverlessinbox/mailbox-cdk/commit/5c05ccf6518304462c19990f13d38420629094fb))

* every Lambda declares its pipeline ([3e99a99](https://github.com/serverlessinbox/mailbox-cdk/commit/3e99a99e5864074dfe8bcb55f9e3f03442d93432))

* blob-authorizer logs into the shared jmap group ([48bebb5](https://github.com/serverlessinbox/mailbox-cdk/commit/48bebb55d8ff7fbaad021b793fc8c80ee0f5b019))

* Lambda log pipelines ([a1bbea5](https://github.com/serverlessinbox/mailbox-cdk/commit/a1bbea57ad0eee10de5cd9fc1cfbfc48d0a55cf2))

* Added permission boundaries on tags and resource names ([c7f09a8](https://github.com/serverlessinbox/mailbox-cdk/commit/c7f09a80a4d61eadec8b97d4f6b20018c6f53129))

* Support access test vendor accounts ([7a59443](https://github.com/serverlessinbox/mailbox-cdk/commit/7a594430c73ad781029cb1d8c5be5faad6f79132))

* Grant support tiers scoped CloudFormation read access ([3efefd7](https://github.com/serverlessinbox/mailbox-cdk/commit/3efefd713ab34c5386f1a7a4e0ee05124f216e6a))

### refactor

* Clean interfaces and construc boundaries ([736034c](https://github.com/serverlessinbox/mailbox-cdk/commit/736034cf9b5adc70539945e2d91421924b82932c))

### docs

* env.ts parity claim with Go is now accurate ([7c01d09](https://github.com/serverlessinbox/mailbox-cdk/commit/7c01d0973f0a07bebde96728fb2b480487dbc0b3))

### chore

* Build tweaking ([13bdc02](https://github.com/serverlessinbox/mailbox-cdk/commit/13bdc0265ba088570d44e80f8f3caf76feda5d23))

## [0.0.77](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.76...v0.0.77) (Tue Aug 25 2026)

### feat

* Locked base table to deny scan concepts ([eef9ec3](https://github.com/serverlessinbox/mailbox-cdk/commit/eef9ec3418d880ae905e45e09e56280cb0234463))

## [0.0.76](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.75...v0.0.76) (Tue Aug 25 2026)

### fix

* Update fix ([d4492b1](https://github.com/serverlessinbox/mailbox-cdk/commit/d4492b1fee01fd3f7cebd4c33eee95b0b56f8a0b))

### feat

* Smoke test ([82c56a9](https://github.com/serverlessinbox/mailbox-cdk/commit/82c56a9048e947facffae977532c30c47632e370))

## [0.0.75](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.74...v0.0.75) (Sun Aug 23 2026)

### chore

* Task state ([ea32721](https://github.com/serverlessinbox/mailbox-cdk/commit/ea327213be609c1b5515781c8308f4dcfae89658))

## [0.0.74](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.73...v0.0.74) (Sun Aug 23 2026)

### fix

* Misc fixes ([bbb273e](https://github.com/serverlessinbox/mailbox-cdk/commit/bbb273e3b5496d09c45ee7a3b16b75fa9e043078))

## [0.0.73](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.72...v0.0.73) (Sat Aug 22 2026)

### fix

* Bundling fixes ([aabddbb](https://github.com/serverlessinbox/mailbox-cdk/commit/aabddbbe3a93c6d16dcb847333e732aaf7ef2dbc))

## [0.0.72](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.71...v0.0.72) (Sat Aug 22 2026)

### feat

* Assets deployer ([9f9a5ee](https://github.com/serverlessinbox/mailbox-cdk/commit/9f9a5ee2494da0d91462910a72a287c729167958))

* Bucket cleanup ([b868dc9](https://github.com/serverlessinbox/mailbox-cdk/commit/b868dc9147e64450cab7b2f37c22894bf30c4b68))

* Attached the bucket auto empty ([09a521d](https://github.com/serverlessinbox/mailbox-cdk/commit/09a521d51a9df21be0f81143036beb3e12f3dc4b))

* JMap addon ([797f91c](https://github.com/serverlessinbox/mailbox-cdk/commit/797f91cc6e87fee0c52ef08a722862ebd96355c2))

* Route handling with anonymous ([d515917](https://github.com/serverlessinbox/mailbox-cdk/commit/d51591763f0d7dc1b44aaab1e9cd93893788c06c))

* Dynamic client registration for oauth ([83feca3](https://github.com/serverlessinbox/mailbox-cdk/commit/83feca3987185f7d72b9aed4147b6d1066232f91))

* Dynamic client registration with cfn condition ([8f8e6cc](https://github.com/serverlessinbox/mailbox-cdk/commit/8f8e6cca1f9e18a948702a59d8460e7ebf305182))

### fix

* Missing env var ([a96bdd2](https://github.com/serverlessinbox/mailbox-cdk/commit/a96bdd28609bad3a32e987688a6bd105224ed297))

* Renamed user provisior to identity provisior ([f288012](https://github.com/serverlessinbox/mailbox-cdk/commit/f288012583887b4abd5da3433b7324cd29053ea5))

* Renamed user provisior to identity provisior ([6653726](https://github.com/serverlessinbox/mailbox-cdk/commit/66537266ef451a44f53ebfcbd7133463b8a776fe))

## [0.0.71](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.70...v0.0.71) (Sat Aug 15 2026)

### feat

* Customer domain ([074a673](https://github.com/serverlessinbox/mailbox-cdk/commit/074a6730ebcc60eee6240586ba19794590c140df))

## [0.0.70](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.69...v0.0.70) (Sat Aug 15 2026)

### feat

* Stack deployer hardening ([09823cc](https://github.com/serverlessinbox/mailbox-cdk/commit/09823cc3a1f9acd219bb94ba8f441c9e3cabbfc9))

## [0.0.69](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.68...v0.0.69) (Thu Aug 13 2026)

### fix

* Misc tests ([cf0ad10](https://github.com/serverlessinbox/mailbox-cdk/commit/cf0ad10a9eca7705a0737f3cddae69fd451b28f1))

* Dev publish fix ([e895552](https://github.com/serverlessinbox/mailbox-cdk/commit/e895552081d7dfac5f77dfc5b92a2242066fad19))

* Cognito domain name and kms retry ([7b2aa0e](https://github.com/serverlessinbox/mailbox-cdk/commit/7b2aa0e67ba9c31dc0add0924178a1c1527da500))

* Config for tests ([a255e73](https://github.com/serverlessinbox/mailbox-cdk/commit/a255e73320dc78c822fbfe402242ebdfe146c241))

* Config ([3910b7b](https://github.com/serverlessinbox/mailbox-cdk/commit/3910b7be80d82163010eb41b3f18c29c5d15af39))

### feat

* Delete idp user ([417cde3](https://github.com/serverlessinbox/mailbox-cdk/commit/417cde370a5bf8925175a4157ccc3e636e0a8054))

* Base64 public blob ids ([57d2a4e](https://github.com/serverlessinbox/mailbox-cdk/commit/57d2a4e37b9243ec885f2e711848c61f9e835c70))

* Srv records ([f06d50c](https://github.com/serverlessinbox/mailbox-cdk/commit/f06d50c99447c061c703a20cce1e9bf8692a1f3e))

## [0.0.68](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.67...v0.0.68) (Mon Aug 03 2026)

### chore

* Updated idl repo ([783319f](https://github.com/serverlessinbox/mailbox-cdk/commit/783319f03f5d56aa6017c0aa6f793a1cdbf50bd8))

## [0.0.67](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.66...v0.0.67) (Mon Aug 03 2026)

### fix

* Resolving artifacts ([49c2cd2](https://github.com/serverlessinbox/mailbox-cdk/commit/49c2cd236d7920c4c041d45bfb52b5fbf5283772))

## [0.0.66](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.65...v0.0.66) (Mon Aug 03 2026)

### fix

* Trigger lambda ([e992782](https://github.com/serverlessinbox/mailbox-cdk/commit/e99278233343b14cc08decfac4a22997e0212726))

* Dependency for end trigger ([44e58fa](https://github.com/serverlessinbox/mailbox-cdk/commit/44e58fa16e509b3dbcff2d793e56fa2754e5e6c8))

## [0.0.65](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.64...v0.0.65) (Mon Aug 03 2026)

### fix

* Run update trigger always succeeds ([e3fe3b7](https://github.com/serverlessinbox/mailbox-cdk/commit/e3fe3b7694fe1e45c79e383c0b4c4d5db0993129))

## [0.0.64](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.63...v0.0.64) (Mon Aug 03 2026)

### fix

* Circular dependency ([13e3ad0](https://github.com/serverlessinbox/mailbox-cdk/commit/13e3ad06cd1339aae5a9e55ff336da2eadae8cf0))

## [0.0.63](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.62...v0.0.63) (Sun Aug 02 2026)

### chore

* Cleanup old pipeline ([de19a5c](https://github.com/serverlessinbox/mailbox-cdk/commit/de19a5c4f293cf4594d8884c95a510b78b20fe64))

## [0.0.62](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.61...v0.0.62) (Sun Aug 02 2026)

### feat

* Added descriptions ([af710c6](https://github.com/serverlessinbox/mailbox-cdk/commit/af710c6284f69406e5c18d182dec2d46585b577c))

## [0.0.61](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.60...v0.0.61) (Fri Jul 17 2026)

### feat

* Updater logic ([c897241](https://github.com/serverlessinbox/mailbox-cdk/commit/c897241dd3fb9ef5525feea8a27ce631ffdbfdf3))

## [0.0.60](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.59...v0.0.60) (Tue Jul 14 2026)

### fix

* role update ([040ac3c](https://github.com/serverlessinbox/mailbox-cdk/commit/040ac3c7623c1e2fbe44fbd2e90b5773cefb3a39))

## [0.0.59](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.58...v0.0.59) (Tue Jul 14 2026)

### fix

* Update api uses its own role for cloudformation ([2a133f5](https://github.com/serverlessinbox/mailbox-cdk/commit/2a133f5932b5f93436c80cc9f23f81f9bc68e645))

## [0.0.58](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.57...v0.0.58) (Tue Jul 14 2026)

### fix

* IAM Permissions ([ec6215f](https://github.com/serverlessinbox/mailbox-cdk/commit/ec6215fe5663d8d2c5506413265955a871fdc037))

## [0.0.57](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.56...v0.0.57) (Tue Jul 14 2026)

### fix

* Added stack grants ([3017800](https://github.com/serverlessinbox/mailbox-cdk/commit/3017800ea6b03bbb2efcf35ea676244384e5a525))

## [0.0.56](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.55...v0.0.56) (Tue Jul 14 2026)

### fix

* Nonce handling for artifacts ([c410144](https://github.com/serverlessinbox/mailbox-cdk/commit/c410144be8c84e520e602542bac94962f6d556ee))

## [0.0.55](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.54...v0.0.55) (Tue Jul 14 2026)

### feat

* Update addon version in ssm parameters ([7ccae02](https://github.com/serverlessinbox/mailbox-cdk/commit/7ccae02d7c2c8a73de4a6dbcd302daae9c584095))

## [0.0.54](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.53...v0.0.54) (Mon Jul 13 2026)

### feat

* Updated idl ([6ff1261](https://github.com/serverlessinbox/mailbox-cdk/commit/6ff126179646b6a01e3d16679f17ad23c14a56e9))

* Update api updates ([7ac62da](https://github.com/serverlessinbox/mailbox-cdk/commit/7ac62da237be3a31535e0ac2ce6849f89ed33a29))

## [0.0.53](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.52...v0.0.53) (Mon Jul 13 2026)

### feat

* Update addon ([e69752d](https://github.com/serverlessinbox/mailbox-cdk/commit/e69752d4f145181d93f8017d643c89a21f351c5c))

* Updated idl ([6ff1261](https://github.com/serverlessinbox/mailbox-cdk/commit/6ff126179646b6a01e3d16679f17ad23c14a56e9))

## [0.0.52](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.51...v0.0.52) (Sat Jul 11 2026)

### feat

* Logging updates ([56ecaee](https://github.com/serverlessinbox/mailbox-cdk/commit/56ecaeed087107c8458da2066b7ec97acdab1f07))

## [0.0.51](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.50...v0.0.51) (Sat Jul 11 2026)

### fix

* Socket handling fixed in node 24 ([c5ac3c3](https://github.com/serverlessinbox/mailbox-cdk/commit/c5ac3c3da1210756c9cbcde6edbed97c236d3de3))

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

### fix

* Cert grant ([380b71c](https://github.com/serverlessinbox/mailbox-cdk/commit/380b71ca35baa7618b256442d828c8ce4860cf25))

## [0.0.46](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.45...v0.0.46) (Fri Jul 10 2026)

### fix

* Granting ([536e3a8](https://github.com/serverlessinbox/mailbox-cdk/commit/536e3a89d7c70f16fa01c72ccc5f5f75ecefbfe0))

## [0.0.45](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.44...v0.0.45) (Fri Jul 10 2026)

### fix

* Grants ([a08c900](https://github.com/serverlessinbox/mailbox-cdk/commit/a08c900c922d12da2237b870b619e8b339e9fa1d))

## [0.0.44](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.43...v0.0.44) (Fri Jul 10 2026)

### fix

* Grants ([63dad21](https://github.com/serverlessinbox/mailbox-cdk/commit/63dad2139bc1a4fb14b349c25e8e365e182cb69f))

## [0.0.43](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.42...v0.0.43) (Thu Jul 09 2026)

### fix

* Log group naming ([108a9e1](https://github.com/serverlessinbox/mailbox-cdk/commit/108a9e11794b236946d992aa3ee3536ba43264a2))

## [0.0.42](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.41...v0.0.42) (Thu Jul 09 2026)

### fix

* IAM hardening ([e01aa80](https://github.com/serverlessinbox/mailbox-cdk/commit/e01aa8077e67f376730ec664f10ec7124e162ff8))

## [0.0.41](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.40...v0.0.41) (Thu Jul 09 2026)

### fix

* Double log retention ([f7192f7](https://github.com/serverlessinbox/mailbox-cdk/commit/f7192f7267151254c8ba851438915f50c9b27087))

## [0.0.40](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.39...v0.0.40) (Thu Jul 09 2026)

### fix

* Iam hardening ([e7ff17b](https://github.com/serverlessinbox/mailbox-cdk/commit/e7ff17b11c4c73ddd8cb3bb785b3bbc2bc89ea7a))

## [0.0.39](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.38...v0.0.39) (Thu Jul 09 2026)

### feat

* Switched around ui detection due to circular dependency ([fc192bd](https://github.com/serverlessinbox/mailbox-cdk/commit/fc192bd77a118b5553e88b7fdb5f8971c65945c0))

## [0.0.38](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.37...v0.0.38) (Thu Jul 09 2026)

### feat

* Ui and edge auto update ([5165f6b](https://github.com/serverlessinbox/mailbox-cdk/commit/5165f6b0865acb9b640eabd73e84ba8a65db5a2d))

## [0.0.37](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.36...v0.0.37) (Thu Jul 09 2026)

### fix

* Updater rights ([6c20223](https://github.com/serverlessinbox/mailbox-cdk/commit/6c202237fa38b5a2648e7ab8298be251f6aba1ea))

## [0.0.36](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.35...v0.0.36) (Thu Jul 09 2026)

### fix

* External deps ([bbaf802](https://github.com/serverlessinbox/mailbox-cdk/commit/bbaf80221ba5155d73783f65d54fa620d6786dd8))

## [0.0.35](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.34...v0.0.35) (Thu Jul 09 2026)

### fix

* External package ([796459f](https://github.com/serverlessinbox/mailbox-cdk/commit/796459fbd7525988afa99485fb61fde8acc4adcc))

## [0.0.34](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.33...v0.0.34) (Thu Jul 09 2026)

### fix

* Bundling ([4ce0d74](https://github.com/serverlessinbox/mailbox-cdk/commit/4ce0d743573d142eb29e05f60cc4b095618341e7))

## [0.0.33](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.32...v0.0.33) (Thu Jul 09 2026)

### fix

* Unit tests ([1b9b8e3](https://github.com/serverlessinbox/mailbox-cdk/commit/1b9b8e364949e0ef767cbd83d400f638d72d696b))

## [0.0.32](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.31...v0.0.32) (Thu Jul 09 2026)

### fix

* Exclude auto update tag ([d1411e0](https://github.com/serverlessinbox/mailbox-cdk/commit/d1411e00d47597ea0529cb6ccbc75f042aeb8d34))

## [0.0.31](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.30...v0.0.31) (Thu Jul 09 2026)

### feat

* Auto updater ([c020833](https://github.com/serverlessinbox/mailbox-cdk/commit/c020833a2c197fa9d771b54d40a4430ce5758ba3))

## [0.0.30](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.29...v0.0.30) (Wed Jul 08 2026)

### feat

* Refactored auto update ([a54f9bf](https://github.com/serverlessinbox/mailbox-cdk/commit/a54f9bf401743e10ee0bea1c2650caf6273d6ba6))

## [0.0.29](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.28...v0.0.29) (Tue Jul 07 2026)

### fix

* Added region for resolver ([06001e3](https://github.com/serverlessinbox/mailbox-cdk/commit/06001e31c53d4969ff8ec4fc4e2fc46c656dfcf1))

## [0.0.28](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.27...v0.0.28) (Tue Jul 07 2026)

### fix

* Bucket lookup ([dda9c23](https://github.com/serverlessinbox/mailbox-cdk/commit/dda9c23150468bc0148b840aa42386af98865810))

## [0.0.27](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.26...v0.0.27) (Tue Jul 07 2026)

### feat

* Artifact resolving ([6a01f4b](https://github.com/serverlessinbox/mailbox-cdk/commit/6a01f4b34279e85d54e71aadce11c1d235bad061))

## [0.0.26](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.25...v0.0.26) (Mon Jul 06 2026)

### fix

* Artifact-registry updates ([3fc9bb6](https://github.com/serverlessinbox/mailbox-cdk/commit/3fc9bb6862c9f8e8b2be1b06e3f520454f934698))

## [0.0.25](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.24...v0.0.25) (Mon Jul 06 2026)

### fix

* Defererd removal dependency ([cad19e2](https://github.com/serverlessinbox/mailbox-cdk/commit/cad19e2697714bdde6cd478538e711a90b70a636))

* Sweeper infra ([943e73c](https://github.com/serverlessinbox/mailbox-cdk/commit/943e73c63a60a209f0a167112c97b53ff0db2d4f))

* Artifact-registry stable channel ([450054d](https://github.com/serverlessinbox/mailbox-cdk/commit/450054dfd211c559d1011ea768ada8bd33a0735f))

### feat

* Dynamic track installation ([2b59811](https://github.com/serverlessinbox/mailbox-cdk/commit/2b598118c2570f353141fd258a75dc1f3658fcd3))

* New artifact-registry with logging ([46f3e11](https://github.com/serverlessinbox/mailbox-cdk/commit/46f3e11f84177213670539a4dfe092579d616384))

## [0.0.24](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.23...v0.0.24) (Fri Jul 03 2026)

### fix

* Component group for sweeper ([e5670ef](https://github.com/serverlessinbox/mailbox-cdk/commit/e5670ef2d4843b05bec37034cbdccec6110c78ea))

* Remove impossible step ([2fbae5f](https://github.com/serverlessinbox/mailbox-cdk/commit/2fbae5f94eb94f34aecf3f5895797bd383290b87))

## [0.0.23](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.22...v0.0.23) (Fri Jul 03 2026)

### fix

* Cleanup role ([501c0da](https://github.com/serverlessinbox/mailbox-cdk/commit/501c0da510310309e204c69a0e924cdb87b81e8c))

## [0.0.22](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.21...v0.0.22) (Fri Jul 03 2026)

### fix

* Sweeper logic ([d0e8b2a](https://github.com/serverlessinbox/mailbox-cdk/commit/d0e8b2a2e83f53e31b44b8d35cae716e38f872fc))

## [0.0.21](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.20...v0.0.21) (Fri Jul 03 2026)

### fix

* Sweeper ([02c9756](https://github.com/serverlessinbox/mailbox-cdk/commit/02c9756307d90c9f73e02054f6d6635f1dac9c91))

## [0.0.20](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.19...v0.0.20) (Fri Jul 03 2026)

### fix

* Sweeper fixes ([b1b56e9](https://github.com/serverlessinbox/mailbox-cdk/commit/b1b56e92d435b6e9b072e2385b966acb78dfd2f3))

## [0.0.19](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.18...v0.0.19) (Thu Jul 02 2026)

### fix

* Service timeout ([32c181c](https://github.com/serverlessinbox/mailbox-cdk/commit/32c181c1c053caed3731f1ca4b7fda8a9c4deab6))

## [0.0.18](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.17...v0.0.18) (Thu Jul 02 2026)

### feat

* Deployer tag propagation ([8c360c1](https://github.com/serverlessinbox/mailbox-cdk/commit/8c360c19d9216f7c6ac7e6e277e74a974d44268c))

* Resource groups and tagging ([db9487b](https://github.com/serverlessinbox/mailbox-cdk/commit/db9487b502adc7a85f03b98d811440bff4e11d50))

* Sweeper concept ([5eaad6c](https://github.com/serverlessinbox/mailbox-cdk/commit/5eaad6c01cb8d01ff0592302fc1cd005d911ea27))

* Sweeper + self destruct ([4a115e2](https://github.com/serverlessinbox/mailbox-cdk/commit/4a115e2b222b821ebecbbd825e8dde5a2c8a9184))

### fix

* Custom resource timeout ([4e67fe6](https://github.com/serverlessinbox/mailbox-cdk/commit/4e67fe6a2e35837ba768ba6b66d455c905235afd))

## [0.0.17](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.16...v0.0.17) (Wed Jul 01 2026)

### fix

* Edge grants for tags ([7b8d32e](https://github.com/serverlessinbox/mailbox-cdk/commit/7b8d32e052b449684c3648298152beb60993d66b))

## [0.0.16](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.15...v0.0.16) (Wed Jul 01 2026)

### feat

* Resource naming and tagging ([8e2aa2c](https://github.com/serverlessinbox/mailbox-cdk/commit/8e2aa2c3838093a4890bf1a14d284cf12a57e658))

## [0.0.15](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.14...v0.0.15) (Tue Jun 30 2026)

### feat

* Refactored the grouping and tagging ([a546414](https://github.com/serverlessinbox/mailbox-cdk/commit/a546414cec8905c7deb96d6e105515d71f8a29e8))

### fix

* Lock file ([9a4213e](https://github.com/serverlessinbox/mailbox-cdk/commit/9a4213ea47bbbe77bd3c4fd1b08cb4912dad3bb4))

## [0.0.14](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.13...v0.0.14) (Tue Jun 30 2026)

### fix

* Versioning ([7b48fdf](https://github.com/serverlessinbox/mailbox-cdk/commit/7b48fdfced6a51d50623fa8e33e56153908960b9))

* Redirect issues ([53aeb04](https://github.com/serverlessinbox/mailbox-cdk/commit/53aeb04e7c1d000b4253a5972c1221a71e652201))

## [0.0.13](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.12...v0.0.13) (Tue Jun 30 2026)

### fix

* Resolving ([659651d](https://github.com/serverlessinbox/mailbox-cdk/commit/659651dd4fb703401e16497137b1591684c3244d))

* Versioning ([7b48fdf](https://github.com/serverlessinbox/mailbox-cdk/commit/7b48fdfced6a51d50623fa8e33e56153908960b9))

## [0.0.12](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.11...v0.0.12) (Tue Jun 30 2026)

### refactor

* User provisioning ([829a2c8](https://github.com/serverlessinbox/mailbox-cdk/commit/829a2c8953794cde70eef223cff1d9842f7a8a82))

### feat

* Standard app ([1f536bb](https://github.com/serverlessinbox/mailbox-cdk/commit/1f536bbee46a31459be4251ec3d8e4655937f0b9))

* Bootstrap creates dkim ([6d168f7](https://github.com/serverlessinbox/mailbox-cdk/commit/6d168f703c4f2c10f4cce2c134224a4b954cfa32))

* Workflow dispatch trigger ([40d16e3](https://github.com/serverlessinbox/mailbox-cdk/commit/40d16e3cda8730fecaea21bd9036bf5dc5ea9c37))

### fix

* Apps and removed some legacy ([2186bb5](https://github.com/serverlessinbox/mailbox-cdk/commit/2186bb5e2bf33249eb68f36590c97b7645c40dc7))

### chore

* Removed apps ([81aabec](https://github.com/serverlessinbox/mailbox-cdk/commit/81aabec5bd25eb2f36aa8c2ffa29bdd6de0c0351))

## [0.0.11](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.10...v0.0.11) (Sat Jun 27 2026)

### feat

* Welcome twekaing ([658b360](https://github.com/serverlessinbox/mailbox-cdk/commit/658b36026de713477acfd567e3ca94979b12ff6b))

## [0.0.10](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.9...v0.0.10) (Fri Jun 26 2026)

### feat

* Admin api records ([d7cf41a](https://github.com/serverlessinbox/mailbox-cdk/commit/d7cf41a608684da899b262153b47559b723d8710))

## [0.0.9](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.8...v0.0.9) (Wed Jun 24 2026)

### fix

* linux version ([832ad7e](https://github.com/serverlessinbox/mailbox-cdk/commit/832ad7ea7371cab3a5793a69f8cdcccb66e19054))

## [0.0.8](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.7...v0.0.8) (Wed Jun 24 2026)

### chore

* Artifact registry ([c3e2765](https://github.com/serverlessinbox/mailbox-cdk/commit/c3e27656868573416f4d423bf5a5ffcc14cc3b16))

* Removed apps for now ([2222727](https://github.com/serverlessinbox/mailbox-cdk/commit/2222727c4f261a511d0be8c8be06a8c839e6f026))

### feat

* Ses rules activation ([41f3da4](https://github.com/serverlessinbox/mailbox-cdk/commit/41f3da45e810848050ef69ab2737fbadd71dff18))

* Stable standard app ([1443001](https://github.com/serverlessinbox/mailbox-cdk/commit/14430010f72df067bc16123cc3b377478c83f510))

### fix

* gsi3 for item table ([ead8485](https://github.com/serverlessinbox/mailbox-cdk/commit/ead8485c347d5553fdf5b99b4440da8d6903fcf8))

* Packing ([5bea90c](https://github.com/serverlessinbox/mailbox-cdk/commit/5bea90c51eb07c925806a1cec803ed3d94d2f2a5))

* Pipeline ([7f247ad](https://github.com/serverlessinbox/mailbox-cdk/commit/7f247ad0f490875c7cfe6dc53d5c496c68612166))

## [0.0.7](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.6...v0.0.7) (Fri Jun 19 2026)

### feat

* Derive domain name and s3 bucket name sanitization ([6a61c8c](https://github.com/serverlessinbox/mailbox-cdk/commit/6a61c8c93dbf3ad3d0cb872bb61907f99c32462c))

## [0.0.6](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.5...v0.0.6) (Thu Jun 18 2026)

### feat

* first app ([9b55915](https://github.com/serverlessinbox/mailbox-cdk/commit/9b55915bd5ced7d09b747bbe0b5fe0c3a95faa30))

* Public interface ([426f8a0](https://github.com/serverlessinbox/mailbox-cdk/commit/426f8a0655d4aebaf387822b7d36301c85f29b42))

* Bundling code ([32f28e5](https://github.com/serverlessinbox/mailbox-cdk/commit/32f28e533efc7c943848b13819084607221997f6))

* Artifacts and cloud formation template generation ([63cd1f4](https://github.com/serverlessinbox/mailbox-cdk/commit/63cd1f484055d762e81d1655adb4ea09c2295f1b))

* Ses rule enablement ([9375c25](https://github.com/serverlessinbox/mailbox-cdk/commit/9375c25832cdaef6d66cd80f9d92a90a94d6eb48))

* Email recieving on by default ([07c571d](https://github.com/serverlessinbox/mailbox-cdk/commit/07c571d0e57083356cfbe33f0582502c11930d51))

* Cognito data stack ([bcdc04f](https://github.com/serverlessinbox/mailbox-cdk/commit/bcdc04fb1987cc99255bcfde9100a316940b9c49))

### fix

* Ses recieving type export ([5da222f](https://github.com/serverlessinbox/mailbox-cdk/commit/5da222f8b7636dee2193720e5bda6b96660f2daa))

* Pipeline ([2fd15c3](https://github.com/serverlessinbox/mailbox-cdk/commit/2fd15c36599e5a95960a62f50bc62f5e7308a4f6))

### chore

* Cleanup old concepts ([9af540a](https://github.com/serverlessinbox/mailbox-cdk/commit/9af540ad38d14bb2ebd18c7708c9181824c33595))

* Using artifact registry ([c767486](https://github.com/serverlessinbox/mailbox-cdk/commit/c76748699ca847fc2dc3d07c00405c4f971c0372))

## [0.0.5](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.4...v0.0.5) (Thu Jun 11 2026)

### feat

* Updated artifact tools ([f1971f0](https://github.com/serverlessinbox/mailbox-cdk/commit/f1971f05b109f5fd5547a633b58569f6e81267e1))

## [0.0.4](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.3...v0.0.4) (Wed Jun 10 2026)

### fix

* Manifest publishing ([cd79698](https://github.com/serverlessinbox/mailbox-cdk/commit/cd79698fbf32f38693f6ebfd81a9402b4b00d7b6))

## [0.0.3](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.2...v0.0.3) (Wed Jun 10 2026)

### feat

* Data stack extraction ([5d48cae](https://github.com/serverlessinbox/mailbox-cdk/commit/5d48cae9889cef72ab0a4502bb88a9cf97964d5f))

* Data stack extraction ([7f2e83b](https://github.com/serverlessinbox/mailbox-cdk/commit/7f2e83b80addd7950dda2b1290435492312296c5))

* New artifact tool ([2720e7f](https://github.com/serverlessinbox/mailbox-cdk/commit/2720e7f082102413d66f26d06a8b372c3310b75e))

* Updated artifact tools ([62c043b](https://github.com/serverlessinbox/mailbox-cdk/commit/62c043b75e0184ed8dabff2dc1b23cce8a178c3e))

* Artifact tool tweaking ([4363225](https://github.com/serverlessinbox/mailbox-cdk/commit/43632252da204587fbb23c71af3892a264e15e4f))

* Artifact tooling update ([0b40723](https://github.com/serverlessinbox/mailbox-cdk/commit/0b40723603d1604c91bdb04d7b6ce15fa00117e9))

### fix

* CDN Cloudfront access to bucket ([617d738](https://github.com/serverlessinbox/mailbox-cdk/commit/617d73886f9f38b21fd823e6e08ef505ed49135c))

* Pipeline script ([cf0d7b3](https://github.com/serverlessinbox/mailbox-cdk/commit/cf0d7b36c544c7f31ce325a8408d2c0e3df53352))

* Artifact tools ([cd602f8](https://github.com/serverlessinbox/mailbox-cdk/commit/cd602f8c01adccfaf1b45375b4d56b502ca628dc))

## [0.0.2](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.1...v0.0.2) (Mon Jun 08 2026)

### feat

* Added manifest to lock artifacts versions to cdk releases ([085c504](https://github.com/serverlessinbox/mailbox-cdk/commit/085c50451215d705606a0c11b65911519e74f4bf))

### fix

* script fixing ([9d2f31a](https://github.com/serverlessinbox/mailbox-cdk/commit/9d2f31a447cd5ec4eaf2823009880d2a90815722))

### chore

* node 24 ([2e430ba](https://github.com/serverlessinbox/mailbox-cdk/commit/2e430ba8fa2de7e0c0cd47dbf14b9dd7aec261c7))

## [0.0.1](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.0...v0.0.1) (Mon Jun 08 2026)

### feat

* build for jsii ([ec9b215](https://github.com/serverlessinbox/mailbox-cdk/commit/ec9b21543fc1e95dd5265600acc20be561058792))

* Gitversion configuration ([e9c552f](https://github.com/serverlessinbox/mailbox-cdk/commit/e9c552f26ffe875fc7690d1b8a8c15cdc0644da4))

* Pack and publish ([dc0c00f](https://github.com/serverlessinbox/mailbox-cdk/commit/dc0c00f3846d0ac2d474810b55b8af5b7fb45d7b))

* Fake registry url to prevent publish to npm for now ([5b8b7da](https://github.com/serverlessinbox/mailbox-cdk/commit/5b8b7da7b4c87fd4f9ffc35cfb6576e9c3d79d42))

### fix

* Added go tooling to pipeline ([bb7ee4e](https://github.com/serverlessinbox/mailbox-cdk/commit/bb7ee4efcb435253a4f27740dbaa2f1c62cd0001))

* go task version pinning ([18b7074](https://github.com/serverlessinbox/mailbox-cdk/commit/18b7074c436a4bef60ffd6df95234f0ea31cd1f3))
