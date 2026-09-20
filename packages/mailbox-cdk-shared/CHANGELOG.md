
# Changelog

All notable changes to this project will be documented in this file


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
