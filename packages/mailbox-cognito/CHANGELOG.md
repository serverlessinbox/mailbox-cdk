
# Changelog

All notable changes to this project will be documented in this file


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
