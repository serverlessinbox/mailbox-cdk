
# Changelog

All notable changes to this project will be documented in this file


## [0.2.7](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.6...v0.2.7) (Fri Oct 16 2026)



## [0.2.6](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.5...v0.2.6) (Fri Oct 16 2026)

### fix

* **shared** custom-resource Lambdas answer before their deadline and empty buckets fully ([4907275](https://github.com/serverlessinbox/mailbox-cdk/commit/490727501beb3c55fb3397a108380f57aba43477))

* **shared** the stack-deployer answers every CloudFormation request exactly once ([82222b4](https://github.com/serverlessinbox/mailbox-cdk/commit/82222b48266d56a8c470de53378deabd73ef4aae))

* **shared** the stack-deployer's inputs mean what they say ([204c80e](https://github.com/serverlessinbox/mailbox-cdk/commit/204c80e48e9e6e75d3b5c0327faf82ad3026be78))

* **shared** the stack-deployer answers a failed Update SUCCESS while the parent rolls back ([2363690](https://github.com/serverlessinbox/mailbox-cdk/commit/23636906fe570ce353450c3a03547016559905a0))

## [0.2.5](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.4...v0.2.5) (Fri Oct 16 2026)

### fix

* **cdk** admit CloudFormation tag keys; keep detector grants in its named policy ([02ff44b](https://github.com/serverlessinbox/mailbox-cdk/commit/02ff44b91789b4a89fb1249dac2b9a7ba584c2e1))

## [0.2.4](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.3...v0.2.4) (Fri Oct 16 2026)



## [0.2.3](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.2...v0.2.3) (Fri Oct 16 2026)

### refactor

* **shared** restructure the stack-deployer Lambda runtime to the code skills, with a typed payload and a shared CaughtError ([9c3a1b5](https://github.com/serverlessinbox/mailbox-cdk/commit/9c3a1b59815905927d9525e8556ea479689a1edd))

* **cdk** restructure the stack-deployer constructs to the code skills, with shared worker grants and the runtime-owned payload type ([6b2b85b](https://github.com/serverlessinbox/mailbox-cdk/commit/6b2b85b76cb58b693831371c13b51b43dac3df0a))

* **shared** brand the stack-deployer identifiers so one kind cannot be passed as another ([94bf644](https://github.com/serverlessinbox/mailbox-cdk/commit/94bf644ee0e6ef7aa0132ea8edecb15fc0ac5f77))

* **shared** bring the shared content helpers to the code skills, with the CloudFront invalidation named for its concept ([063b234](https://github.com/serverlessinbox/mailbox-cdk/commit/063b234a1a7c71f05add6bcaa03def3e49e6c4ba))

* **mailbox** restructure the blob-authorizer Lambda@Edge to the code skills, answer the smoke-test probe, and share the Branded type ([e2991a8](https://github.com/serverlessinbox/mailbox-cdk/commit/e2991a87892dbdfdd6cf5b134010b16ae7d9e55d))

* **shared** move Branded, the custom-resource and AWS identifiers, and the tag keys into the shared runtime ([5d986c0](https://github.com/serverlessinbox/mailbox-cdk/commit/5d986c073866e5101da128d996ed3fd29dc660a3))

* **mailbox** rename the blob-authorizer Lambda@Edge to jmap-blob-download, including its artifact, tags, edge-stack parameters and construct ids ([1c6e057](https://github.com/serverlessinbox/mailbox-cdk/commit/1c6e0572fa4c07879f923411c21db5b61a89c348))

* **shared** TenantId, Issuer and AccountId move into the shared runtime beside the new FunctionName and QueueUrl brands; jmap-blob-download imports them ([83939ad](https://github.com/serverlessinbox/mailbox-cdk/commit/83939ad1bd03fc07afca45cefeb217649bffa45d))

* **shared** logger buffer, env loaders, smoke-test wrapper, manual finalize and rollback detector to the skills; typanion probe guard; tests per unit on aws-sdk-client-mock ([b2650ec](https://github.com/serverlessinbox/mailbox-cdk/commit/b2650ec12aadd8c7e4e09a5458507c0a730a487c))

### test

* **cdk** share the CDK test helpers through a cdk-test-support export of mailbox-cdk-shared ([5479a0a](https://github.com/serverlessinbox/mailbox-cdk/commit/5479a0abec6603db9094052510a4e0cdcb82487c))

* one shared smoke-probe helper; mailbox-cognito enforces that its updater-managed Lambdas answer the probe ([8878aa7](https://github.com/serverlessinbox/mailbox-cdk/commit/8878aa76f64754f3236fc43b983df0fc416bc27b))

### fix

* **shared** bucket-auto-empty Delete needs only the bucket name, stops before the Lambda deadline, and answers SUCCESS for an empty or missing bucket ([63492a4](https://github.com/serverlessinbox/mailbox-cdk/commit/63492a4d861696204375d02f1954fed7e6477abe))

* a custom-resource Delete answers SUCCESS on a config error or invalid properties (stack-helpers, data-override-resolver, content-deployer, bootstrap-user) ([e0ea119](https://github.com/serverlessinbox/mailbox-cdk/commit/e0ea119d3087ed53766108926ed9c4a23e7a55a5))

* **shared** the stack-deployer caps DELETE_FAILED retries at the poll cap, so a Delete is answered inside the service timeout ([c510c2d](https://github.com/serverlessinbox/mailbox-cdk/commit/c510c2df0c4459f4652f898acd2d5852d305a297))

* **cdk** retain stack-failure detector resources on create rollback ([37391d4](https://github.com/serverlessinbox/mailbox-cdk/commit/37391d4cadac200d2555000e52b04e90ad6bb829))

* **shared** deployer workers may write the Name and description tags ([4c1d4ec](https://github.com/serverlessinbox/mailbox-cdk/commit/4c1d4ecc8b6ad2608d424bfeccd29195b1eb8561))

## [0.2.2](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.1...v0.2.2) (Tue Oct 13 2026)

### chore

* build Lambda zips into dist/lambdas and drop the retired ui-deployer bundle ([ba87f5d](https://github.com/serverlessinbox/mailbox-cdk/commit/ba87f5d3dab090bdd2f874e9d72e7034fd6c790d))

* **shared** require SERVICE_NAME, remove backward-compat reads ([95a7518](https://github.com/serverlessinbox/mailbox-cdk/commit/95a7518cec93a4fab71cb49893adabdc9736924f))

### refactor

* **shared** move naming helpers into src/naming ([d1b006c](https://github.com/serverlessinbox/mailbox-cdk/commit/d1b006cea3b43b9498cc789541f36ee17739aa5e))

* **shared** restructure the stack-helpers Lambda to the code skills, with a typed payload ([e10c110](https://github.com/serverlessinbox/mailbox-cdk/commit/e10c110e7906fe1dc699b2c08f2524220aeb2546))

* **shared** restructure the bucket-auto-empty Lambda to the code skills, with a typed payload ([30398b3](https://github.com/serverlessinbox/mailbox-cdk/commit/30398b396042ae75165765ba156893cea0052fcc))

* **shared** restructure the content-deployer Lambda to the code skills and share the custom-resource request, failure answers and base config across the cleaned Lambdas ([a903927](https://github.com/serverlessinbox/mailbox-cdk/commit/a903927e8194e51fc14217f012fe3bc108370b0a))

### fix

* **sweeper** sweep on Delete only while the stack is being deleted ([01ad53a](https://github.com/serverlessinbox/mailbox-cdk/commit/01ad53a4d568f277de63df1fbd8d2736f8e73c4d))

### feat

* **shared** complete ARN parser and ExpectedFailure in the Lambda runtime ([15b050b](https://github.com/serverlessinbox/mailbox-cdk/commit/15b050ba6299275dc283d24b1396619d4e12a084))

### docs

* **mailbox** trim resource-sweeper and sweeper comments to what the code does not say ([1aea716](https://github.com/serverlessinbox/mailbox-cdk/commit/1aea71670c7211df417cfaadafedab51b8e07850))

## [0.2.1](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.2.0...v0.2.1) (Mon Oct 12 2026)

### chore

* Updated artifact registry to 0.3.0 ([0fe0bc4](https://github.com/serverlessinbox/mailbox-cdk/commit/0fe0bc48854477ed129a75cf81a27d27249c61da))

## [0.2.0](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.19...v0.2.0) (Sun Oct 11 2026)

### chore

* Cleanup build ([5b35809](https://github.com/serverlessinbox/mailbox-cdk/commit/5b358094d36b4f2816293f1b4c553d58f098c8dc))

* mailbox-cdk packages on artifact-registry ^0.2.0 ([440f451](https://github.com/serverlessinbox/mailbox-cdk/commit/440f4516489e3577bcd2c5cab2abad69677378dd))

### feat

* publishable packages ship the registry record; release refreshes it (artifact-registry 0.1.3) ([c143255](https://github.com/serverlessinbox/mailbox-cdk/commit/c1432555e1803fd6dbd8930f9e49d75e95bc1e12))

* publishable packages ship artifact-versions.json in the { version, zone } shape; drop serverlessinbox.components ([d86cdaa](https://github.com/serverlessinbox/mailbox-cdk/commit/d86cdaa724886244fd58ed41d1b0e5fe8918c494))

### fix

* migrate workspace configs to artifact-registry 0.1.3 ([6bca5f8](https://github.com/serverlessinbox/mailbox-cdk/commit/6bca5f8f8e762bd6aaa3c924429d76f0485ad717))

### refactor

* artifact resolver reports version and location; addons get it from the context ([1454d82](https://github.com/serverlessinbox/mailbox-cdk/commit/1454d829c07a2269519a18435db1e489bfbdbaee))

* stack-deployer and stack-helpers move to mailbox-cdk-shared ([8637316](https://github.com/serverlessinbox/mailbox-cdk/commit/86373161fcb2cf50c4bccff42049d3ca21dc8544))

* mailbox-cdk-shared resolves through artifact-registry-cdk; artifact-engine removed ([d7ca54c](https://github.com/serverlessinbox/mailbox-cdk/commit/d7ca54c48c5411437d4184695443bdd448d099dc))

* shared constructs take the artifact-registry-cdk resolver; no package registration ([e4263cc](https://github.com/serverlessinbox/mailbox-cdk/commit/e4263cc55f28ca32943fe0d17e7bfaad7c30d9a8))

### test

* shared construct tests for the resolver contract and the registry record ([261ed90](https://github.com/serverlessinbox/mailbox-cdk/commit/261ed9044e3defceee027e4da42895ba5cbc45f2))

* shared handler tests follow the stack-deployer move and the test type-check ([cb260b1](https://github.com/serverlessinbox/mailbox-cdk/commit/cb260b1201e6f2ec8abc05341c7016fdd3366d42))

* shared construct tests build PinnedArtifactResolver directly ([4c4e27a](https://github.com/serverlessinbox/mailbox-cdk/commit/4c4e27ac99d471a87a15c756e48c4caec427511b))

* drop the unread old-shape artifacts context from tests ([8ec0c6b](https://github.com/serverlessinbox/mailbox-cdk/commit/8ec0c6bbd2c671d7624b3204501e02ff62ed5610))

* env loader test asserts the recorded problem; bake command test cannot touch the repo ([3b0be17](https://github.com/serverlessinbox/mailbox-cdk/commit/3b0be1787a06dafa62dad7f712e1e61fd7566c63))

## [0.1.19](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.18...v0.1.19) (Tue Sep 29 2026)

### fix

* Misc fixes ([cbbcd14](https://github.com/serverlessinbox/mailbox-cdk/commit/cbbcd14ebc600c8ba3347c69f9075aadc0f51f7d))

## [0.1.18](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.17...v0.1.18) (Mon Sep 28 2026)

### fix

* **cdk** scope blob reads to tenants/ and grant KMS on customer keys ([6ab011d](https://github.com/serverlessinbox/mailbox-cdk/commit/6ab011d8b243c8d2ff0da95c70bec09a31a99fa5))

### refactor

* **cdk** deployer takes a bucket, narrow the UI content grant ([da21870](https://github.com/serverlessinbox/mailbox-cdk/commit/da21870806143b971c79fbfbfca8ccbb9363be11))

* **cdk** make the pipeline log group a construct that owns its grants ([0e899ef](https://github.com/serverlessinbox/mailbox-cdk/commit/0e899effbad20fb91c2866c049642bb1de0aab50))

* **cdk** make the pipeline log group a construct that owns its grants ([e4bcd65](https://github.com/serverlessinbox/mailbox-cdk/commit/e4bcd65d9ad0ec6b61592d096030b58ec715c5a9))

## [0.1.17](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.16...v0.1.17) (Mon Sep 28 2026)

### refactor

* **cdk** strip -vN replacement-safety suffixes from construct ids ([3b2157f](https://github.com/serverlessinbox/mailbox-cdk/commit/3b2157fec0286b66f01704cad1e95cea30bc9450))

### chore

* **cdk** trim publish manifest and fix clean scripts ([d8d44dd](https://github.com/serverlessinbox/mailbox-cdk/commit/d8d44dd1bf55664eb05314926079dfecda89705d))

## [0.1.16](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.15...v0.1.16) (Sun Sep 27 2026)



## [0.1.15](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.14...v0.1.15) (Sun Sep 27 2026)



## [0.1.14](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.13...v0.1.14) (Fri Sep 25 2026)



## [0.1.13](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.12...v0.1.13) (Fri Sep 25 2026)



## [0.1.12](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.11...v0.1.12) (Tue Sep 22 2026)



## [0.1.11](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.10...v0.1.11) (Sun Sep 20 2026)



## [0.1.10](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.9...v0.1.10) (Sun Sep 20 2026)



## [0.1.9](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.8...v0.1.9) (Sat Sep 19 2026)

### feat

* Rollback protection ([abf2772](https://github.com/serverlessinbox/mailbox-cdk/commit/abf2772e83754fcd40ca7525e0681e90ec507436))

## [0.1.8](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.7...v0.1.8) (Fri Sep 18 2026)

### chore

* Cleanup ([19bf8af](https://github.com/serverlessinbox/mailbox-cdk/commit/19bf8af5fb70eef75defe4ce8b7d4bcccb96ae08))

* Cleanup underscores ([1e2f0f1](https://github.com/serverlessinbox/mailbox-cdk/commit/1e2f0f101d9d2f78ec2ea8a63ac46f4bf1604582))

### feat

* auth-key-store, websocket table and push-api constructs with explicit least-privilege grants. ([dad7adc](https://github.com/serverlessinbox/mailbox-cdk/commit/dad7adca53122296177c882de5db20f0c4a93c36))

### refactor

* Constructs placements and extraction ([0ef188a](https://github.com/serverlessinbox/mailbox-cdk/commit/0ef188af514fa647aed464c7a78aeea9a89eff4f))

* Queue handling ([ab76278](https://github.com/serverlessinbox/mailbox-cdk/commit/ab76278ffde4d2f54d9df17d943cae917e56d3f5))

* move StackHelpers to mailbox-cdk-shared ([01642c8](https://github.com/serverlessinbox/mailbox-cdk/commit/01642c8936109a17926c8dc4bd433e10bcfea686))

* Data blob store ([47e33cb](https://github.com/serverlessinbox/mailbox-cdk/commit/47e33cb329c12c5670dda17c5a5324eb077e2a07))

* Ui buckets ([a03dcff](https://github.com/serverlessinbox/mailbox-cdk/commit/a03dcffc74b3bcbbf523a1684d7baf40f30c84a8))

* Data deployer in shared ([ad077fc](https://github.com/serverlessinbox/mailbox-cdk/commit/ad077fc6b8273ba90f416f7601266c9949ac5c54))

* Updater grants and lambda extracts ([dd0e184](https://github.com/serverlessinbox/mailbox-cdk/commit/dd0e1840b9a2d8d25332cc28dbb1cfc79c1d2c40))

* Tag condition standardization ([418e5ef](https://github.com/serverlessinbox/mailbox-cdk/commit/418e5ef72a36957e521da71f7928061d61256353))

## [0.1.7](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.6...v0.1.7) (Wed Sep 16 2026)



## [0.1.6](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.5...v0.1.6) (Tue Sep 15 2026)

### chore

* Updated and synced deps ([5e67a9c](https://github.com/serverlessinbox/mailbox-cdk/commit/5e67a9ce76211a3671ab2ef9c30bec93570d276b))

### refactor

* **shared** move generic table, queue, Go Lambda, naming and resource-group constructs to mailbox-cdk-shared ([de02b86](https://github.com/serverlessinbox/mailbox-cdk/commit/de02b86e524ca123e61fde66a1e1c4ef675fe1e9))

### feat

* Name base standardisation ([4d722c8](https://github.com/serverlessinbox/mailbox-cdk/commit/4d722c846d277448b10081335eceaee294bf11b9))

## [0.1.5](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.4...v0.1.5) (Mon Sep 14 2026)



## [0.1.4](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.3...v0.1.4) (Mon Sep 14 2026)

### fix

* Invalidation on ui change ([2746c1c](https://github.com/serverlessinbox/mailbox-cdk/commit/2746c1c0043990aaff5da2f7d240f9fc92cf1584))

## [0.1.3](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.2...v0.1.3) (Mon Sep 14 2026)



## [0.1.2](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.1...v0.1.2) (Mon Sep 14 2026)



## [0.1.1](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.1.0...v0.1.1) (Mon Sep 14 2026)



## [0.1.0](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.82...v0.1.0) (Sun Sep 13 2026)

### feat

* IAM Tightening ([a034cf7](https://github.com/serverlessinbox/mailbox-cdk/commit/a034cf713a7da72d73ada4f0aae6acd0f16e4513))

* Context keys rename ([50b08b0](https://github.com/serverlessinbox/mailbox-cdk/commit/50b08b07e1511df15990a02694e2a529ea6883f7))

* Deployer type changes ([f84580d](https://github.com/serverlessinbox/mailbox-cdk/commit/f84580dadc227612aefb5176bb827e2d9cbbe924))

* Context standardization ([13fee58](https://github.com/serverlessinbox/mailbox-cdk/commit/13fee5816c6f9bff8d7e59f603a4fd87183acbef))

* Evn loader ([70b80c9](https://github.com/serverlessinbox/mailbox-cdk/commit/70b80c9ea60987f762d7c83dc2ddf13b8c98ab9c))

* TS logger emit-level parity with Go, shared LoggerBuffer, injected AWS clients ([9044682](https://github.com/serverlessinbox/mailbox-cdk/commit/9044682e1b8ac7dbbd1ec27282e843817604c77d))

### refactor

* **cdk-shared** CR Lambdas load config via tryLoad; Delete succeeds on bad config ([66a0232](https://github.com/serverlessinbox/mailbox-cdk/commit/66a0232c77504900cdb67baa30b0aefd018a42ab))

## [0.0.82](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.81...v0.0.82) (Wed Sep 09 2026)



## [0.0.81](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.80...v0.0.81) (Mon Sep 07 2026)



## [0.0.80](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.79...v0.0.80) (Mon Sep 07 2026)



## [0.0.79](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.78...v0.0.79) (Sun Sep 06 2026)



## [0.0.78](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.77...v0.0.78) (Sun Sep 06 2026)

### fix

* Update test caes ([9078e7d](https://github.com/serverlessinbox/mailbox-cdk/commit/9078e7d8d94791273aaef754342a9c06d497a4f9))

* Log and logic fixes ([de65128](https://github.com/serverlessinbox/mailbox-cdk/commit/de65128ad8185a67ceabdf743ccaac7a06773881))

* Smoke test types ([1c83128](https://github.com/serverlessinbox/mailbox-cdk/commit/1c831285593786338fbbe0ece1532d73cdbc7de4))

* Cleanup of pipeline logic inside lambdas ([29f80e0](https://github.com/serverlessinbox/mailbox-cdk/commit/29f80e06b7078ad01e3a4ec1d5a31f2a54143d8e))

* Updated tags ([5387e42](https://github.com/serverlessinbox/mailbox-cdk/commit/5387e42fd1e64a92bbdfcdf01253fcd73ffee443))

### feat

* Support access addon ([c1c9138](https://github.com/serverlessinbox/mailbox-cdk/commit/c1c9138b88e4226d1c3e2346e25ecc7ad9e177fd))

* Loggin improvements ([09ae896](https://github.com/serverlessinbox/mailbox-cdk/commit/09ae89639d36aadb6c44cf96e70d2fb96451f0c7))

* Log updates ([b17fcb4](https://github.com/serverlessinbox/mailbox-cdk/commit/b17fcb4c3ea698f75d94c3ea0458b013a8cb8e74))

* Pipelines ([5c05ccf](https://github.com/serverlessinbox/mailbox-cdk/commit/5c05ccf6518304462c19990f13d38420629094fb))

* every Lambda declares its pipeline ([3e99a99](https://github.com/serverlessinbox/mailbox-cdk/commit/3e99a99e5864074dfe8bcb55f9e3f03442d93432))

* Lambda log pipelines ([a1bbea5](https://github.com/serverlessinbox/mailbox-cdk/commit/a1bbea57ad0eee10de5cd9fc1cfbfc48d0a55cf2))

### docs

* env.ts parity claim with Go is now accurate ([7c01d09](https://github.com/serverlessinbox/mailbox-cdk/commit/7c01d0973f0a07bebde96728fb2b480487dbc0b3))

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

### fix

* Bundling fixes ([aabddbb](https://github.com/serverlessinbox/mailbox-cdk/commit/aabddbbe3a93c6d16dcb847333e732aaf7ef2dbc))
