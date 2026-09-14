
# Changelog

All notable changes to this project will be documented in this file


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

* TS logger emit-level parity with Go, shared LoggerBuffer, injected AWS clients ([9044682](https://github.com/serverlessinbox/mailbox-cdk/commit/9044682e1b8ac7dbbd1ec27282e843817604c77d))

### chore

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

### feat

* Support access addon ([c1c9138](https://github.com/serverlessinbox/mailbox-cdk/commit/c1c9138b88e4226d1c3e2346e25ecc7ad9e177fd))

* Loggin improvements ([09ae896](https://github.com/serverlessinbox/mailbox-cdk/commit/09ae89639d36aadb6c44cf96e70d2fb96451f0c7))

* Support access addon ([6d6661b](https://github.com/serverlessinbox/mailbox-cdk/commit/6d6661b094f75e6cebcd2360d5993ac387347f4e))

* Support access tweaking ([424db72](https://github.com/serverlessinbox/mailbox-cdk/commit/424db72073e5f7aaad701a38d41dd8ff6d868624))

* Log updates ([b17fcb4](https://github.com/serverlessinbox/mailbox-cdk/commit/b17fcb4c3ea698f75d94c3ea0458b013a8cb8e74))

* every Lambda declares its pipeline ([3e99a99](https://github.com/serverlessinbox/mailbox-cdk/commit/3e99a99e5864074dfe8bcb55f9e3f03442d93432))

* blob-authorizer logs into the shared jmap group ([48bebb5](https://github.com/serverlessinbox/mailbox-cdk/commit/48bebb55d8ff7fbaad021b793fc8c80ee0f5b019))

* Lambda log pipelines ([a1bbea5](https://github.com/serverlessinbox/mailbox-cdk/commit/a1bbea57ad0eee10de5cd9fc1cfbfc48d0a55cf2))

* Added permission boundaries on tags and resource names ([c7f09a8](https://github.com/serverlessinbox/mailbox-cdk/commit/c7f09a80a4d61eadec8b97d4f6b20018c6f53129))

* Support access test vendor accounts ([7a59443](https://github.com/serverlessinbox/mailbox-cdk/commit/7a594430c73ad781029cb1d8c5be5faad6f79132))

* Grant support tiers scoped CloudFormation read access ([3efefd7](https://github.com/serverlessinbox/mailbox-cdk/commit/3efefd713ab34c5386f1a7a4e0ee05124f216e6a))

### fix

* Cleanup of unused variable ([fb1a24f](https://github.com/serverlessinbox/mailbox-cdk/commit/fb1a24f3e5df99e75d0de38ce9e9ce72f8e86cbb))

* Log and logic fixes ([de65128](https://github.com/serverlessinbox/mailbox-cdk/commit/de65128ad8185a67ceabdf743ccaac7a06773881))

* read custom env vars at the lambda entry point ([01a05ce](https://github.com/serverlessinbox/mailbox-cdk/commit/01a05cec7a5fb22558ef0dea14d90b535f5df7db))

* auditEventsQueue is required, not optional ([da3741b](https://github.com/serverlessinbox/mailbox-cdk/commit/da3741b50d7b57d2e93e182f9f89e4808257850f))

* Cleanup of pipeline logic inside lambdas ([29f80e0](https://github.com/serverlessinbox/mailbox-cdk/commit/29f80e06b7078ad01e3a4ec1d5a31f2a54143d8e))

* Updated tags ([5387e42](https://github.com/serverlessinbox/mailbox-cdk/commit/5387e42fd1e64a92bbdfcdf01253fcd73ffee443))

* Support access test case ([77e0bd2](https://github.com/serverlessinbox/mailbox-cdk/commit/77e0bd282e7af2ada7fa61949768dabdad1ae249))

### refactor

* Clean interfaces and construc boundaries ([736034c](https://github.com/serverlessinbox/mailbox-cdk/commit/736034cf9b5adc70539945e2d91421924b82932c))

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

* Base64 public blob ids ([57d2a4e](https://github.com/serverlessinbox/mailbox-cdk/commit/57d2a4e37b9243ec885f2e711848c61f9e835c70))

* Srv records ([f06d50c](https://github.com/serverlessinbox/mailbox-cdk/commit/f06d50c99447c061c703a20cce1e9bf8692a1f3e))

## [0.0.68](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.67...v0.0.68) (Mon Aug 03 2026)



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

* Update api updates ([7ac62da](https://github.com/serverlessinbox/mailbox-cdk/commit/7ac62da237be3a31535e0ac2ce6849f89ed33a29))

## [0.0.53](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.52...v0.0.53) (Mon Jul 13 2026)

### feat

* Update addon ([e69752d](https://github.com/serverlessinbox/mailbox-cdk/commit/e69752d4f145181d93f8017d643c89a21f351c5c))

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



## [0.0.29](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.28...v0.0.29) (Tue Jul 07 2026)

### fix

* Added region for resolver ([06001e3](https://github.com/serverlessinbox/mailbox-cdk/commit/06001e31c53d4969ff8ec4fc4e2fc46c656dfcf1))

## [0.0.28](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.27...v0.0.28) (Tue Jul 07 2026)



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

## [0.0.14](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.13...v0.0.14) (Tue Jun 30 2026)

### fix

* Redirect issues ([53aeb04](https://github.com/serverlessinbox/mailbox-cdk/commit/53aeb04e7c1d000b4253a5972c1221a71e652201))

## [0.0.13](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.12...v0.0.13) (Tue Jun 30 2026)

### fix

* Resolving ([659651d](https://github.com/serverlessinbox/mailbox-cdk/commit/659651dd4fb703401e16497137b1591684c3244d))

## [0.0.12](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.11...v0.0.12) (Tue Jun 30 2026)

### refactor

* User provisioning ([829a2c8](https://github.com/serverlessinbox/mailbox-cdk/commit/829a2c8953794cde70eef223cff1d9842f7a8a82))

### feat

* Bootstrap creates dkim ([6d168f7](https://github.com/serverlessinbox/mailbox-cdk/commit/6d168f703c4f2c10f4cce2c134224a4b954cfa32))

### fix

* Apps and removed some legacy ([2186bb5](https://github.com/serverlessinbox/mailbox-cdk/commit/2186bb5e2bf33249eb68f36590c97b7645c40dc7))

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

### feat

* Ses rules activation ([41f3da4](https://github.com/serverlessinbox/mailbox-cdk/commit/41f3da45e810848050ef69ab2737fbadd71dff18))

* Stable standard app ([1443001](https://github.com/serverlessinbox/mailbox-cdk/commit/14430010f72df067bc16123cc3b377478c83f510))

### fix

* gsi3 for item table ([ead8485](https://github.com/serverlessinbox/mailbox-cdk/commit/ead8485c347d5553fdf5b99b4440da8d6903fcf8))

* Packing ([5bea90c](https://github.com/serverlessinbox/mailbox-cdk/commit/5bea90c51eb07c925806a1cec803ed3d94d2f2a5))

## [0.0.7](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.6...v0.0.7) (Fri Jun 19 2026)

### feat

* Derive domain name and s3 bucket name sanitization ([6a61c8c](https://github.com/serverlessinbox/mailbox-cdk/commit/6a61c8c93dbf3ad3d0cb872bb61907f99c32462c))

## [0.0.6](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.5...v0.0.6) (Thu Jun 18 2026)

### feat

* Public interface ([426f8a0](https://github.com/serverlessinbox/mailbox-cdk/commit/426f8a0655d4aebaf387822b7d36301c85f29b42))

* Bundling code ([32f28e5](https://github.com/serverlessinbox/mailbox-cdk/commit/32f28e533efc7c943848b13819084607221997f6))

* Artifacts and cloud formation template generation ([63cd1f4](https://github.com/serverlessinbox/mailbox-cdk/commit/63cd1f484055d762e81d1655adb4ea09c2295f1b))

* Ses rule enablement ([9375c25](https://github.com/serverlessinbox/mailbox-cdk/commit/9375c25832cdaef6d66cd80f9d92a90a94d6eb48))

* Email recieving on by default ([07c571d](https://github.com/serverlessinbox/mailbox-cdk/commit/07c571d0e57083356cfbe33f0582502c11930d51))

* Cognito data stack ([bcdc04f](https://github.com/serverlessinbox/mailbox-cdk/commit/bcdc04fb1987cc99255bcfde9100a316940b9c49))

### fix

* Ses recieving type export ([5da222f](https://github.com/serverlessinbox/mailbox-cdk/commit/5da222f8b7636dee2193720e5bda6b96660f2daa))

### chore

* Cleanup old concepts ([9af540a](https://github.com/serverlessinbox/mailbox-cdk/commit/9af540ad38d14bb2ebd18c7708c9181824c33595))

## [0.0.5](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.4...v0.0.5) (Thu Jun 11 2026)



## [0.0.4](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.3...v0.0.4) (Wed Jun 10 2026)



## [0.0.3](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.2...v0.0.3) (Wed Jun 10 2026)

### feat

* Data stack extraction ([5d48cae](https://github.com/serverlessinbox/mailbox-cdk/commit/5d48cae9889cef72ab0a4502bb88a9cf97964d5f))

* Data stack extraction ([7f2e83b](https://github.com/serverlessinbox/mailbox-cdk/commit/7f2e83b80addd7950dda2b1290435492312296c5))

* New artifact tool ([2720e7f](https://github.com/serverlessinbox/mailbox-cdk/commit/2720e7f082102413d66f26d06a8b372c3310b75e))

* Artifact tool tweaking ([4363225](https://github.com/serverlessinbox/mailbox-cdk/commit/43632252da204587fbb23c71af3892a264e15e4f))

* Artifact tooling update ([0b40723](https://github.com/serverlessinbox/mailbox-cdk/commit/0b40723603d1604c91bdb04d7b6ce15fa00117e9))

### fix

* CDN Cloudfront access to bucket ([617d738](https://github.com/serverlessinbox/mailbox-cdk/commit/617d73886f9f38b21fd823e6e08ef505ed49135c))

* Pipeline script ([cf0d7b3](https://github.com/serverlessinbox/mailbox-cdk/commit/cf0d7b36c544c7f31ce325a8408d2c0e3df53352))

## [0.0.2](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.1...v0.0.2) (Mon Jun 08 2026)

### feat

* Added manifest to lock artifacts versions to cdk releases ([085c504](https://github.com/serverlessinbox/mailbox-cdk/commit/085c50451215d705606a0c11b65911519e74f4bf))

## [0.0.1](https://github.com/serverlessinbox/mailbox-cdk/compare/v0.0.0...v0.0.1) (Mon Jun 08 2026)

### feat

* build for jsii ([ec9b215](https://github.com/serverlessinbox/mailbox-cdk/commit/ec9b21543fc1e95dd5265600acc20be561058792))

* Gitversion configuration ([e9c552f](https://github.com/serverlessinbox/mailbox-cdk/commit/e9c552f26ffe875fc7690d1b8a8c15cdc0644da4))

* Pack and publish ([dc0c00f](https://github.com/serverlessinbox/mailbox-cdk/commit/dc0c00f3846d0ac2d474810b55b8af5b7fb45d7b))

* Fake registry url to prevent publish to npm for now ([5b8b7da](https://github.com/serverlessinbox/mailbox-cdk/commit/5b8b7da7b4c87fd4f9ffc35cfb6576e9c3d79d42))
