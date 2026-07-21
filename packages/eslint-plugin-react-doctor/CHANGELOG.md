# eslint-plugin-react-doctor

## 0.8.3

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.8.3

## 0.8.2

### Patch Changes

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add four async effect safety diagnostics for unguarded async event handlers, loading flags that can remain stuck, unhandled promise side effects in effects, and stale state writes after awaited effect work.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add seven resource-lifecycle diagnostics for class teardown, debounced callbacks, listener identity, observers, animation-frame loops, and effect wrappers that discard cleanup returns.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add five state-update correctness diagnostics for stale boolean toggles, same-reference mutation, updater side effects, undefined-clobbered defaults, and overbroad props dependencies.

- [#1410](https://github.com/millionco/react-doctor/pull/1410) [`e6a1557`](https://github.com/millionco/react-doctor/commit/e6a155763ee4a1dd23be6dd60e4beecaf7182ae0) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect in-place mutation of proven Zustand state snapshots that can prevent subscriber updates.

- Updated dependencies [[`5b468f8`](https://github.com/millionco/react-doctor/commit/5b468f8a929cd210c93d015f1ba9cb9987e1d7b5), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`b4556e3`](https://github.com/millionco/react-doctor/commit/b4556e31d8804e4c8442ae6a5f198373b94fd378), [`7eca0ee`](https://github.com/millionco/react-doctor/commit/7eca0eebf94abba3e79143cbc08c03bd1da38b1c), [`82c4a12`](https://github.com/millionco/react-doctor/commit/82c4a125c538fd1fd5982c459154fc19388d6ed4), [`f4aa821`](https://github.com/millionco/react-doctor/commit/f4aa8214bfac4b52c5613f25bbad29e68cbeb28d), [`5332cb6`](https://github.com/millionco/react-doctor/commit/5332cb66cf73086cb8c53cbbdbb379d74e5a2e24), [`8c4959b`](https://github.com/millionco/react-doctor/commit/8c4959bb7400a6d5f21cc35a8d54d0ed7faf6971), [`0b0b5ac`](https://github.com/millionco/react-doctor/commit/0b0b5ac52301cbfbb5abdffe4d0d9bf673325a94), [`284b4e4`](https://github.com/millionco/react-doctor/commit/284b4e4e93da7b9ed72f2cbddd72c378737aa0a1), [`6fcd9c9`](https://github.com/millionco/react-doctor/commit/6fcd9c957671b5b7d0b9657260ea1706f73869e2), [`21221c2`](https://github.com/millionco/react-doctor/commit/21221c2d4bc1b9448a32928a582c34ef088236c8), [`fc1b3a3`](https://github.com/millionco/react-doctor/commit/fc1b3a3984e5993c1eb25478cf1c154d3d4ceddc), [`26b4a0c`](https://github.com/millionco/react-doctor/commit/26b4a0ceb1da349ea61073a78f12723e4336c2dc), [`61bf03e`](https://github.com/millionco/react-doctor/commit/61bf03eedcc602b2e21c45e1a5f2e3f012c7201c), [`af33723`](https://github.com/millionco/react-doctor/commit/af337232873fa5c96ec69fac453868f14a9be071), [`8e5ae45`](https://github.com/millionco/react-doctor/commit/8e5ae45dd3e93e6df263b37d0179403da5a9a170), [`3598138`](https://github.com/millionco/react-doctor/commit/3598138c7bdd55dac55bf17bc72ccfef1e4c2efd), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`f5f13b8`](https://github.com/millionco/react-doctor/commit/f5f13b877ab2096312e60d5b3413fc3bcf35f428), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`f5f6a79`](https://github.com/millionco/react-doctor/commit/f5f6a79ba247128ae48493cd58bbca9c1e16c1ff), [`d970055`](https://github.com/millionco/react-doctor/commit/d9700556d14a2c48e644512e70c5affe703cba2a), [`b852961`](https://github.com/millionco/react-doctor/commit/b8529619bdb06251314dd398c650207732ab5024), [`e6a1557`](https://github.com/millionco/react-doctor/commit/e6a155763ee4a1dd23be6dd60e4beecaf7182ae0), [`fe241a9`](https://github.com/millionco/react-doctor/commit/fe241a9723c12673f40d6e3ab42a1fa32e1238b2), [`a4eaedd`](https://github.com/millionco/react-doctor/commit/a4eaeddefecba43688c61edaad3452621ceb73de), [`a667b45`](https://github.com/millionco/react-doctor/commit/a667b4590700c052124994d73ae1aac202655cf0), [`c9f2c4b`](https://github.com/millionco/react-doctor/commit/c9f2c4be53a64dc99bbd2f83ae4e563557add007), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`5774353`](https://github.com/millionco/react-doctor/commit/57743539079f8a8c49fe9d2119822b27603e3a04), [`a2f9bf4`](https://github.com/millionco/react-doctor/commit/a2f9bf42c0dbc012dab41938008d90c0bd2dc77f), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1)]:
  - oxlint-plugin-react-doctor@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.8.1

## 0.8.0

### Patch Changes

- [#1350](https://github.com/millionco/react-doctor/pull/1350) [`db5fe10`](https://github.com/millionco/react-doctor/commit/db5fe10229150da08d83f808809bbcd1c640351c) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid treating human-readable storage key names with camelCase segments as hardcoded secrets.

- [#1354](https://github.com/millionco/react-doctor/pull/1354) [`0f11de1`](https://github.com/millionco/react-doctor/commit/0f11de18bd9ab6e02019b2e49ac7e19f1216135b) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize bounded render-derived equivalents in `exhaustive-deps` dependency lists.

- [#1352](https://github.com/millionco/react-doctor/pull/1352) [`c41f271`](https://github.com/millionco/react-doctor/commit/c41f271c3124d5f64cc7149195e93c4ed97fb6a6) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize stable values initialized once through `ref.current ??=` in `exhaustive-deps`.

- [#1334](https://github.com/millionco/react-doctor/pull/1334) [`b51022f`](https://github.com/millionco/react-doctor/commit/b51022f8e055ee0db07cce63b6d6e8cf795c4ba5) Thanks [@aidenybai](https://github.com/aidenybai)! - Restore `auth-token-in-web-storage` diagnostics for product API-key records, whose opaque IDs can be usable credentials, and follow web-storage aliases, factories, and local helper functions.

- Updated dependencies [[`cf7ada5`](https://github.com/millionco/react-doctor/commit/cf7ada5839156399e054b8e47bba1d54122f75b8), [`ac392cb`](https://github.com/millionco/react-doctor/commit/ac392cbbc02e77d7e62aa30d34ed6985860b394c), [`b30fb80`](https://github.com/millionco/react-doctor/commit/b30fb80a6d96de3a4d4c7f5d12cebb9acc5474a8), [`0ff57fa`](https://github.com/millionco/react-doctor/commit/0ff57fa57c6f81330f804d9ca94cab3139c20545), [`b2f3c9c`](https://github.com/millionco/react-doctor/commit/b2f3c9c463f5f04dd6d7c2d09621ff9edcc7144f), [`9aa98b9`](https://github.com/millionco/react-doctor/commit/9aa98b94e301f4038a1b6cf85301f6fe872d4d8a), [`44d3ad8`](https://github.com/millionco/react-doctor/commit/44d3ad879d28ea47248a8060485ee9d08e8b0c89), [`3c90f14`](https://github.com/millionco/react-doctor/commit/3c90f14c906778515fabab8615117ce5770b6ae2), [`f563205`](https://github.com/millionco/react-doctor/commit/f563205ee092aa93202964c05ff739c00ba74541), [`7eb7428`](https://github.com/millionco/react-doctor/commit/7eb74283d0ede1749c24f7b21818ac3a7ddcbfc7), [`f59ec54`](https://github.com/millionco/react-doctor/commit/f59ec540c751078decf4599ad52046c97c217ca2), [`a86b5b0`](https://github.com/millionco/react-doctor/commit/a86b5b0e9571e120fd38e3ebffcd0c78a3d458d7), [`d7d38d7`](https://github.com/millionco/react-doctor/commit/d7d38d7c881d8b6d31728fbed28a0ee5974bc818), [`52fc179`](https://github.com/millionco/react-doctor/commit/52fc179e82afbb43f5d562e0c81c2a4def638e94), [`1adf327`](https://github.com/millionco/react-doctor/commit/1adf3278df268d752a6eb3f40c62ebd7e8d84004), [`194cc06`](https://github.com/millionco/react-doctor/commit/194cc06e8c83decb1be71fecb9124009f5b8a837), [`c88a39a`](https://github.com/millionco/react-doctor/commit/c88a39a936c2c96dfd282d3ac74f9264dcd68fea), [`3e6dcfc`](https://github.com/millionco/react-doctor/commit/3e6dcfc21712a8cdb7a43ac63c0ed466039852e1), [`be6d64b`](https://github.com/millionco/react-doctor/commit/be6d64b466596e40a4ee1233b9c6f260944c4286), [`0fbf728`](https://github.com/millionco/react-doctor/commit/0fbf728ec1d6cc70f55d70cea431081b641726e7), [`30e0ff0`](https://github.com/millionco/react-doctor/commit/30e0ff015e974bc9cc5ad22988fb4da1d0884e01), [`11388bf`](https://github.com/millionco/react-doctor/commit/11388bfe2dd82851e46970ffea05d2a87a8fdf29), [`71892af`](https://github.com/millionco/react-doctor/commit/71892afc4651f9354baeb645a0fb77693fbf6f92), [`81da42b`](https://github.com/millionco/react-doctor/commit/81da42bc05a6097d6fd5c4d34afe6c87dc935917), [`e5d5753`](https://github.com/millionco/react-doctor/commit/e5d57534a7bd4b3a42f9f9cc5cb7c3e4f82ee7d2), [`66a1db8`](https://github.com/millionco/react-doctor/commit/66a1db84f4925b2bd919960af6e02b9f66dfaf1a), [`b392093`](https://github.com/millionco/react-doctor/commit/b3920938da9f8d3badbffca0f972f0b583c19a86), [`6c5c91b`](https://github.com/millionco/react-doctor/commit/6c5c91b68c7e089b0dcd7a269a44b8052f846888), [`d8a20e0`](https://github.com/millionco/react-doctor/commit/d8a20e0de7f3707ff9fca132a59f429384d5cc7a), [`f441f59`](https://github.com/millionco/react-doctor/commit/f441f598bb172a92a70c4f425934949042427a51), [`174955c`](https://github.com/millionco/react-doctor/commit/174955c25558a45dc3c8667c6efebb1af16ba8b4), [`bd3655c`](https://github.com/millionco/react-doctor/commit/bd3655c13d25fd43a9946a98a3643235d72ac55d), [`db5fe10`](https://github.com/millionco/react-doctor/commit/db5fe10229150da08d83f808809bbcd1c640351c), [`c1e75f0`](https://github.com/millionco/react-doctor/commit/c1e75f06bab2042469f9e61a23de5efef2b6fbb6), [`796a56d`](https://github.com/millionco/react-doctor/commit/796a56d4f9f86d451568218dd28c1f4edd11ef98), [`558118c`](https://github.com/millionco/react-doctor/commit/558118ca1fe556a2d563b8208d33fe9cd1a65e3d), [`d4db626`](https://github.com/millionco/react-doctor/commit/d4db626555cf2b9eb19e2824ca21a08a37fde631), [`a16e452`](https://github.com/millionco/react-doctor/commit/a16e452648eda8a2c05504219d1af66fd428dbf8), [`d3f54c4`](https://github.com/millionco/react-doctor/commit/d3f54c4c1ddbdd4bf0472c8e74e2c0dccc692a5a), [`e5a5f73`](https://github.com/millionco/react-doctor/commit/e5a5f736992f42f67eaf01db056180eb8ed319cb), [`6325f9c`](https://github.com/millionco/react-doctor/commit/6325f9cea5bef7ae66860835e4251250c522055b), [`e86bc57`](https://github.com/millionco/react-doctor/commit/e86bc57911b836e07227aa213b40130136ae423d), [`4f3848b`](https://github.com/millionco/react-doctor/commit/4f3848b0019590ef38d74e09296059ea6fbc5292), [`093619c`](https://github.com/millionco/react-doctor/commit/093619c3d8a9990586af270c00ed267b027506b4), [`21827da`](https://github.com/millionco/react-doctor/commit/21827da9079291ffdec247a907ff16b796912e95), [`12e9592`](https://github.com/millionco/react-doctor/commit/12e9592da8a7b95c3726ca439c334be7ab2f7ab8), [`c7f61cd`](https://github.com/millionco/react-doctor/commit/c7f61cd4f53fd864bc3299b7f2e359f161aae522), [`95f9937`](https://github.com/millionco/react-doctor/commit/95f99372c0498cc48a3c8829b63511518bf26085), [`0f11de1`](https://github.com/millionco/react-doctor/commit/0f11de18bd9ab6e02019b2e49ac7e19f1216135b), [`1b86dae`](https://github.com/millionco/react-doctor/commit/1b86dae52c98d58e79ece863eee616008b0e0612), [`1a30f2c`](https://github.com/millionco/react-doctor/commit/1a30f2caac12f1678243cb8733dd7bc1b598a9da), [`9e55e1f`](https://github.com/millionco/react-doctor/commit/9e55e1f83f3668e4fc39c8e158984f7976e5c12d), [`c41f271`](https://github.com/millionco/react-doctor/commit/c41f271c3124d5f64cc7149195e93c4ed97fb6a6), [`7e6cdf9`](https://github.com/millionco/react-doctor/commit/7e6cdf920b972a035cc7c5fd405049dbc060ed57), [`544356c`](https://github.com/millionco/react-doctor/commit/544356cb0edcc7240f0268dcc6279fa06dab19ee), [`cc96f47`](https://github.com/millionco/react-doctor/commit/cc96f473248c63e6c058827fc688579ee33aeb5e), [`5f3ba37`](https://github.com/millionco/react-doctor/commit/5f3ba376289fa07ab9e44c649eb290a967009536), [`cf9acf2`](https://github.com/millionco/react-doctor/commit/cf9acf26c22fde1a0a7874efdf598a78b94c4808), [`f94d7b1`](https://github.com/millionco/react-doctor/commit/f94d7b189b5b143c556209a67958556fed53875a), [`c245b9d`](https://github.com/millionco/react-doctor/commit/c245b9d05d7d0c48dc33891b037da21386061955), [`ef328c4`](https://github.com/millionco/react-doctor/commit/ef328c457115ff5e352e7016330b0c6a51386589), [`b51022f`](https://github.com/millionco/react-doctor/commit/b51022f8e055ee0db07cce63b6d6e8cf795c4ba5), [`21043e0`](https://github.com/millionco/react-doctor/commit/21043e024e77e65f0df5122d4330b7c759f0187e), [`418e0b2`](https://github.com/millionco/react-doctor/commit/418e0b210de5cb2c628baeda6704294b4c3b5b13), [`b76aef7`](https://github.com/millionco/react-doctor/commit/b76aef71635c85260fa76c4ab4d02830077a06f3), [`61111f1`](https://github.com/millionco/react-doctor/commit/61111f192a52e8c296b3b0ec7201e4ce3f4b84ae), [`c8a2918`](https://github.com/millionco/react-doctor/commit/c8a29185a03737dea64839d1a8063fbb8b892d79), [`8835214`](https://github.com/millionco/react-doctor/commit/88352149101497bbac80dfef98e07e1f2e6b7747), [`2ba83c3`](https://github.com/millionco/react-doctor/commit/2ba83c3201e364939c76187be2725ed0bbf9daa5)]:
  - oxlint-plugin-react-doctor@0.8.0

## 0.7.9

### Patch Changes

- Updated dependencies [[`9256423`](https://github.com/millionco/react-doctor/commit/9256423342c830e41a2ab71d940e1306b91de91e), [`4829841`](https://github.com/millionco/react-doctor/commit/4829841a4d4a77e64b7fd22faee4446ba2ff955d)]:
  - oxlint-plugin-react-doctor@0.7.9

## 0.7.8

### Patch Changes

- Updated dependencies [[`4a73399`](https://github.com/millionco/react-doctor/commit/4a73399f529580b18546df6addee71b53982f30c), [`760a3b0`](https://github.com/millionco/react-doctor/commit/760a3b009eb445dc3234c923f2ae33e0441f0e60), [`af58965`](https://github.com/millionco/react-doctor/commit/af58965a7233b5b66283ad35b3a651435f1e0de9), [`ed241c3`](https://github.com/millionco/react-doctor/commit/ed241c35e66b6b3759f49390ddcdcf92dcee1921), [`4190897`](https://github.com/millionco/react-doctor/commit/41908971fdb67be57afe862b0717f79f810bc5cf), [`4fce1c1`](https://github.com/millionco/react-doctor/commit/4fce1c1bff8af9adb66edad3ee66c25c20c5bd1e), [`c79c897`](https://github.com/millionco/react-doctor/commit/c79c897ec6128a3155ae23d10dda3f77e28683a5), [`517f87a`](https://github.com/millionco/react-doctor/commit/517f87a19f50893c4c19e79e6cdb37be12e71f01), [`ec144d9`](https://github.com/millionco/react-doctor/commit/ec144d99c9fb45698250b5ec47edbe1305cbfdbc), [`afed801`](https://github.com/millionco/react-doctor/commit/afed80154512c3fc4d55f3fe5c01bbc38afae627), [`9c612c5`](https://github.com/millionco/react-doctor/commit/9c612c57e4da1d48a489a6b9dcbbc532126904a0), [`9fab4fc`](https://github.com/millionco/react-doctor/commit/9fab4fc77e24d17079815edd0b2590615822ef6a), [`04c7e36`](https://github.com/millionco/react-doctor/commit/04c7e36b28b57ae4973662637946485504bc30af), [`165a6cb`](https://github.com/millionco/react-doctor/commit/165a6cbd9c454f1eaff4f353f063503c808bd634), [`287dff7`](https://github.com/millionco/react-doctor/commit/287dff742b8d90274ce6ff2298daeee8e7441bcd), [`9fc93f8`](https://github.com/millionco/react-doctor/commit/9fc93f865c7ef2638bfa802f0544256fd5fc85e5), [`43327b5`](https://github.com/millionco/react-doctor/commit/43327b535c90fa29a266dc0627030f1b6e6cb925), [`30b7eeb`](https://github.com/millionco/react-doctor/commit/30b7eebaeb1344b342ee2d59413cd5ef6e213f7a), [`89dbf08`](https://github.com/millionco/react-doctor/commit/89dbf08d76beeb93d3959d7ea2e2d4a77cdd5c3d), [`12e7193`](https://github.com/millionco/react-doctor/commit/12e719358046afde6294b5b620e735f8993ec56a), [`fbc804e`](https://github.com/millionco/react-doctor/commit/fbc804e6768b292b63fe6d8c249469e32d8b8899), [`046329c`](https://github.com/millionco/react-doctor/commit/046329caf3fdf99924e4b97ffe7b71106922787c), [`79abd71`](https://github.com/millionco/react-doctor/commit/79abd7177928fc79a91706cc2866b8097c7cd09c), [`a468589`](https://github.com/millionco/react-doctor/commit/a4685891b8ee768176741a74eb7db2f4d0724bdc)]:
  - oxlint-plugin-react-doctor@0.7.8

## 0.7.7

### Patch Changes

- Updated dependencies [[`c1916d5`](https://github.com/millionco/react-doctor/commit/c1916d577d90df5a6587e8a98f28bb1b12168554), [`8528def`](https://github.com/millionco/react-doctor/commit/8528deff881314adaf72bb17da1f1dabdcf58b5c), [`a01249a`](https://github.com/millionco/react-doctor/commit/a01249aa37f9ac4b693c1d8d162b58463b10d250), [`dfd47a7`](https://github.com/millionco/react-doctor/commit/dfd47a75a29f36df2b6799d57ef9695a7174b3f6), [`0150fc9`](https://github.com/millionco/react-doctor/commit/0150fc901cd5d85c5631e975510d51e48372bdde), [`4fb3694`](https://github.com/millionco/react-doctor/commit/4fb3694e186db0287cc0d49f72a44a38ad63a26e), [`da3a6e0`](https://github.com/millionco/react-doctor/commit/da3a6e019141ee9c598a661c07171591f7db5f55), [`a8cd24e`](https://github.com/millionco/react-doctor/commit/a8cd24e2fedbd6c9697266b09e92e9b685d07abf), [`778f1a2`](https://github.com/millionco/react-doctor/commit/778f1a2cc4a2be3863e79236db143677ae4192e1), [`5699529`](https://github.com/millionco/react-doctor/commit/5699529155f3735a2d75c56715d3edeb88e791f8), [`55cebeb`](https://github.com/millionco/react-doctor/commit/55cebebfd98eeb4cfb9f30f1b2bd137521d620dc), [`37c53d6`](https://github.com/millionco/react-doctor/commit/37c53d6ebf607a9b3942314cdc13700a876cefcc), [`8ee2977`](https://github.com/millionco/react-doctor/commit/8ee2977e174f0b1dd46554eea785cba853ff2207), [`c5a06bd`](https://github.com/millionco/react-doctor/commit/c5a06bd8c0d5ade974549326b9131fa9b6ae8e6e), [`1f14fa1`](https://github.com/millionco/react-doctor/commit/1f14fa1bf33530e46e900780d606d246c71da8b0), [`0d11bd5`](https://github.com/millionco/react-doctor/commit/0d11bd54717cc61fff2341eb0a3b1d25d4f645ad), [`d674163`](https://github.com/millionco/react-doctor/commit/d6741631233fe3622ff165740f1c260635abfa18), [`5fdc445`](https://github.com/millionco/react-doctor/commit/5fdc445783c626605b293283a2dd709c00575d83), [`64950ba`](https://github.com/millionco/react-doctor/commit/64950ba2879e7ccd11ee1a6599d1474992c22558), [`4753290`](https://github.com/millionco/react-doctor/commit/4753290a1ce3d1aadbe8fec11a7296fd575e9350), [`c6f996e`](https://github.com/millionco/react-doctor/commit/c6f996ec0183f34bff7fd99593028c15d91f0634), [`1d7b6e2`](https://github.com/millionco/react-doctor/commit/1d7b6e2887c8478df738d21e1422daac51ffb334), [`8c9a6c4`](https://github.com/millionco/react-doctor/commit/8c9a6c49ab09beabaf8fc47f406ffb9f29a95b34), [`79105a3`](https://github.com/millionco/react-doctor/commit/79105a3b97238d2db1b4011cf7774c8c8b592253), [`81e6647`](https://github.com/millionco/react-doctor/commit/81e6647f3c4c0dbc90881b199753a9d341cf7963), [`fbd85e3`](https://github.com/millionco/react-doctor/commit/fbd85e388c12e6d8ea2c2fcf2e9d8405379dd245), [`b550b32`](https://github.com/millionco/react-doctor/commit/b550b327ece611503d0565c3d1a9cf0f8e3c7246), [`55dcb93`](https://github.com/millionco/react-doctor/commit/55dcb937fbfa6fb58309d5779b4c9b97afd8731c), [`a6c24a8`](https://github.com/millionco/react-doctor/commit/a6c24a867e8b17b65fa8a278945fd351643fe05b), [`47beb25`](https://github.com/millionco/react-doctor/commit/47beb255f228eef2386e0ecd61a0b122d366ac09), [`acf14c4`](https://github.com/millionco/react-doctor/commit/acf14c4fc9774f53a82a7394cd50e09f02a9e7d6), [`b36e439`](https://github.com/millionco/react-doctor/commit/b36e439c26a81b20ede762fdc2f32d50968c7ff3)]:
  - oxlint-plugin-react-doctor@0.7.7

## 0.7.6

### Patch Changes

- Updated dependencies [[`dbd4067`](https://github.com/millionco/react-doctor/commit/dbd4067fce8ce9e734738af27b751992ea6bb483), [`bc49aaa`](https://github.com/millionco/react-doctor/commit/bc49aaa383da79ac3b31c4f99436bdf26f95495b), [`3075e10`](https://github.com/millionco/react-doctor/commit/3075e10babeb7dfd2ee531572454120df40fa904), [`0654849`](https://github.com/millionco/react-doctor/commit/06548498e257accee8a186762ace7557900d31cc), [`18e8717`](https://github.com/millionco/react-doctor/commit/18e8717ec18f2221953e9b8ae810c4a8464e7b6f), [`a240f8b`](https://github.com/millionco/react-doctor/commit/a240f8b7d94baf6d5d3eabdf313a91c296ce197e), [`76cd6be`](https://github.com/millionco/react-doctor/commit/76cd6bea69e1f453805a054e8d648abc97ef3384), [`8fc5848`](https://github.com/millionco/react-doctor/commit/8fc58480f83895fd64d51758cccd393c3d493515), [`22bb155`](https://github.com/millionco/react-doctor/commit/22bb1557282fbcf47c6fa865ca7ddca050f21b8f), [`21da48f`](https://github.com/millionco/react-doctor/commit/21da48ffb694ac857b5cf6336f56923ac411cb59), [`20cd922`](https://github.com/millionco/react-doctor/commit/20cd922e9a2908b20a36b9e728932975018207a1), [`d9676e2`](https://github.com/millionco/react-doctor/commit/d9676e2597fe01a8db537928b7e02cd82b1e3582), [`3afd146`](https://github.com/millionco/react-doctor/commit/3afd14670042fe8ffb85bd8cc04b15a2987eac52), [`70eff9a`](https://github.com/millionco/react-doctor/commit/70eff9a493f35eb6bdfedbe35ccadec3908ba132)]:
  - oxlint-plugin-react-doctor@0.7.6

## 0.7.5

### Patch Changes

- Updated dependencies [[`d4f2209`](https://github.com/millionco/react-doctor/commit/d4f22093a15ab937d40c7f40c1637ea3e53f6e26), [`5113067`](https://github.com/millionco/react-doctor/commit/5113067458f03349922bdd0a22ad564574ca74c2), [`118f806`](https://github.com/millionco/react-doctor/commit/118f80616fb1771f39a5c9a2afa1a5c8eb08120c), [`63fc41f`](https://github.com/millionco/react-doctor/commit/63fc41f4af69dcc1c8b1f39bf944e7201830be8f), [`98005f2`](https://github.com/millionco/react-doctor/commit/98005f2c3dc70debcd5fa5f95ce28aa9f32b5f7e), [`7bbb792`](https://github.com/millionco/react-doctor/commit/7bbb792e983318453118d1662dc4b4ac5c2d9dc0), [`5aa82e8`](https://github.com/millionco/react-doctor/commit/5aa82e86d065221e249b6e7c454c8411887bda23), [`11333b9`](https://github.com/millionco/react-doctor/commit/11333b9e7db0a8735baa4316f0e0c010b701ed8e), [`b47d053`](https://github.com/millionco/react-doctor/commit/b47d05302bfd8d465c468a65809ad5c7a2b0bdd7), [`a31f5e8`](https://github.com/millionco/react-doctor/commit/a31f5e8eb87d4e4b889f5ba293189a9a92829771), [`a989008`](https://github.com/millionco/react-doctor/commit/a989008fec7afce1039978c3355aadc5b8eea147), [`6610ea9`](https://github.com/millionco/react-doctor/commit/6610ea9ea4ce3a75b6502f89ed7ce4cbf0915eff), [`6292f89`](https://github.com/millionco/react-doctor/commit/6292f891f699654147608bc6a09d64ea5959737e), [`593824d`](https://github.com/millionco/react-doctor/commit/593824de1a156677db33de41e2579280d1a5e65b), [`2b5a18e`](https://github.com/millionco/react-doctor/commit/2b5a18ea3aedb476cf66d21347708102460f218e), [`6821fe0`](https://github.com/millionco/react-doctor/commit/6821fe08bb22ba4f58b7971f4d8026525ee4295c), [`3ec8e1e`](https://github.com/millionco/react-doctor/commit/3ec8e1e85957c446c13a459acf167e9407234746), [`b686594`](https://github.com/millionco/react-doctor/commit/b686594dfacbf4362780b25210d450e7eb4a9260), [`4a5d9bb`](https://github.com/millionco/react-doctor/commit/4a5d9bbe75f5400913f3cf943e3a4ed1beb4d32c), [`3867cf1`](https://github.com/millionco/react-doctor/commit/3867cf1ae77750f8c824181aac2187204348ad60), [`70b5d99`](https://github.com/millionco/react-doctor/commit/70b5d99db9f499c65e5dae95663f0497fd5ef420)]:
  - oxlint-plugin-react-doctor@0.7.5

## 0.7.4

### Patch Changes

- Updated dependencies [[`f91ede7`](https://github.com/millionco/react-doctor/commit/f91ede75c5d03970f4d30d66e862ce56e179c290), [`6b70b32`](https://github.com/millionco/react-doctor/commit/6b70b3231c5d9531f72e39b0e99550fbe850d86b), [`82187a3`](https://github.com/millionco/react-doctor/commit/82187a3b31fb38b622c911e92d70db95e9154ea4)]:
  - oxlint-plugin-react-doctor@0.7.4

## 0.7.3

### Patch Changes

- [`9b59d96`](https://github.com/millionco/react-doctor/commit/9b59d96f06dc7210686ef097e6ac92ce5f864eb4) Thanks [@aidenybai](https://github.com/aidenybai)! - New rule `no-locale-format-in-render` (warn, SSR-capable projects only): flags locale/timezone-dependent formatting evaluated during render — `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` on date-shaped receivers, `Intl.DateTimeFormat(...).format(...)`, and `Date` default stringification — because the server's locale and timezone differ from the browser's, causing hydration mismatches. Number formatting (`Intl.NumberFormat`, bare `toLocaleString()` on numbers) is deliberately out of scope: its only environment input is the ICU locale, a far weaker mismatch signal that was almost always client-fetched dashboard data in corpus validation. Formatting with an explicit locale and timeZone, inside event handlers or effects, behind client-only guards, or under `suppressHydrationWarning` stays unflagged. `rendering-hydration-no-flicker` gained a matching escape so the recommended post-mount `useEffect` + state fix is never flagged as a flicker.

- [`9b59d96`](https://github.com/millionco/react-doctor/commit/9b59d96f06dc7210686ef097e6ac92ce5f864eb4) Thanks [@aidenybai](https://github.com/aidenybai)! - prefer-use-sync-external-store now detects hand-rolled module-scope stores: a mutable module binding plus a listener registry and same-file subscribe function, consumed as `useState(sharedState)` with a `useEffect(() => subscribe(setState), [])`. Publishes fired between the render-time snapshot and the effect-time subscription are lost and concurrent renders can tear — `useSyncExternalStore(subscribe, getSnapshot)` is the fix. Genuine `useSyncExternalStore` usage, imported subscribe functions, and effects with non-empty dependencies stay unflagged.

- [#1102](https://github.com/millionco/react-doctor/pull/1102) [`da7bb4b`](https://github.com/millionco/react-doctor/commit/da7bb4bfc685e2436bf5202c17ac7596d86ae270) Thanks [@aidenybai](https://github.com/aidenybai)! - no-react19-deprecated-apis no longer flags `useContext`. React 19's `use()` is an additive alternative — `useContext` remains a fully supported, non-deprecated API, so calling it deprecated was misinformation. The rule still flags `forwardRef` (both named imports and `React.forwardRef` member access) on React 19+ projects.

- [`9b59d96`](https://github.com/millionco/react-doctor/commit/9b59d96f06dc7210686ef097e6ac92ce5f864eb4) Thanks [@aidenybai](https://github.com/aidenybai)! - Detection robustness against verdict-preserving source rewrites: rules no longer go silent when the same defect is spelled with a slightly different shape. `Date.now()` / `Math.random()` / `performance.now()` / `crypto.randomUUID()` and namespace-import calls like `React.forwardRef` now match through TS cast wrappers (`(Date as any).now()`, `(React!).forwardRef`); `prefer-use-sync-external-store` recognizes resync handlers written as block-bodied returns (`() => { return setX(read()); }`); and effect-body analyses (`no-derived-state-effect`, `rendering-hydration-no-flicker`, and everything on `getCallbackStatements`) skip no-op statements (`void 0;`, stray directives) instead of letting them flip a "body contains only setState" check.

- Updated dependencies [[`cb8f726`](https://github.com/millionco/react-doctor/commit/cb8f7268530911910bc572bf697614d32674e56a), [`b1bf6b9`](https://github.com/millionco/react-doctor/commit/b1bf6b9c31975620e8ff979d98b337328d75fa7f), [`ee9948a`](https://github.com/millionco/react-doctor/commit/ee9948af13715741788f2ed81cb738a35a0dce35), [`82e0475`](https://github.com/millionco/react-doctor/commit/82e0475b0b5af5e17a2714862d2a717a5a914e90), [`f10f9ca`](https://github.com/millionco/react-doctor/commit/f10f9ca8a622befea1e1972cd25ceb5e3ecb3f30), [`b1bf6b9`](https://github.com/millionco/react-doctor/commit/b1bf6b9c31975620e8ff979d98b337328d75fa7f), [`6680538`](https://github.com/millionco/react-doctor/commit/6680538e14dcff2f2cac36422b124e0df3912798), [`b1bf6b9`](https://github.com/millionco/react-doctor/commit/b1bf6b9c31975620e8ff979d98b337328d75fa7f), [`fb8ffb0`](https://github.com/millionco/react-doctor/commit/fb8ffb0f769532c035baac27443738f4ba84870b), [`b97a92f`](https://github.com/millionco/react-doctor/commit/b97a92f6111394d6fc01fae5b43b2bb5bf892b64), [`ea3e94e`](https://github.com/millionco/react-doctor/commit/ea3e94e37c467ab958190094dad2b582580be9c0), [`9b59d96`](https://github.com/millionco/react-doctor/commit/9b59d96f06dc7210686ef097e6ac92ce5f864eb4), [`11e9c87`](https://github.com/millionco/react-doctor/commit/11e9c87340eb3b83e604107f8c264417be178b0a), [`63e0657`](https://github.com/millionco/react-doctor/commit/63e065739f615310922041866b742f23e57c8a12), [`2953b25`](https://github.com/millionco/react-doctor/commit/2953b2592d464afd3dde8eba85f5400fb7863a90), [`02b1f82`](https://github.com/millionco/react-doctor/commit/02b1f82dd0c6fdf5a8fbbe5bab16c2384ae41bd0), [`9b59d96`](https://github.com/millionco/react-doctor/commit/9b59d96f06dc7210686ef097e6ac92ce5f864eb4), [`da7bb4b`](https://github.com/millionco/react-doctor/commit/da7bb4bfc685e2436bf5202c17ac7596d86ae270), [`f83092d`](https://github.com/millionco/react-doctor/commit/f83092d9313bc1cae41d8e0a154bd943b7414dd3), [`dfdc763`](https://github.com/millionco/react-doctor/commit/dfdc763bad8a068aaf4b47aaf23b6f83d720cf40), [`9b59d96`](https://github.com/millionco/react-doctor/commit/9b59d96f06dc7210686ef097e6ac92ce5f864eb4)]:
  - oxlint-plugin-react-doctor@0.7.3

## 0.7.2

### Patch Changes

- Updated dependencies [[`9cb4149`](https://github.com/millionco/react-doctor/commit/9cb414905de7b360d728ca08d45167116a94ee90), [`1880b15`](https://github.com/millionco/react-doctor/commit/1880b152e4d6aedd5c06cf2ca51783e53cfb4004), [`5d2f17f`](https://github.com/millionco/react-doctor/commit/5d2f17f71c9fb8e0d8d649da1b26de8f5cfe6c34), [`9cb4149`](https://github.com/millionco/react-doctor/commit/9cb414905de7b360d728ca08d45167116a94ee90)]:
  - oxlint-plugin-react-doctor@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies [[`c0c3fc1`](https://github.com/millionco/react-doctor/commit/c0c3fc170972876c8bbc2419b32e66b9c864df85)]:
  - oxlint-plugin-react-doctor@0.7.1

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.7.0

## 0.6.3

### Patch Changes

- Updated dependencies [[`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`b4faf74`](https://github.com/millionco/react-doctor/commit/b4faf74744c730d0836235854b0233ce59a42566), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`b4faf74`](https://github.com/millionco/react-doctor/commit/b4faf74744c730d0836235854b0233ce59a42566), [`b4faf74`](https://github.com/millionco/react-doctor/commit/b4faf74744c730d0836235854b0233ce59a42566), [`072d37e`](https://github.com/millionco/react-doctor/commit/072d37e8e4f82454d2e187114d0194f26efc1bf0), [`2980d0f`](https://github.com/millionco/react-doctor/commit/2980d0f4ed6abfee061ac02f3a0820806f942b95), [`5fec491`](https://github.com/millionco/react-doctor/commit/5fec491e6844d73f658f355ae2cbe86285068f0e), [`05f6399`](https://github.com/millionco/react-doctor/commit/05f639910abf2b3bfc0802e9ad568ecd2b7ce13d), [`a1c8ee1`](https://github.com/millionco/react-doctor/commit/a1c8ee110e137bbc8771c8a471c20287cccd2b38), [`fa61c20`](https://github.com/millionco/react-doctor/commit/fa61c2056951df2429e79d888e5f7334aaf61cfd), [`ac71a3b`](https://github.com/millionco/react-doctor/commit/ac71a3b8cfc8bdd157f0f1bcd242b61ec69f9c17), [`d8628d7`](https://github.com/millionco/react-doctor/commit/d8628d7f21e60b0e6dfd98d76c9f24e03f7afe24), [`ebeee56`](https://github.com/millionco/react-doctor/commit/ebeee568abf9a7ed37ed9fe0bba695e4f2a11c9f), [`da3b19c`](https://github.com/millionco/react-doctor/commit/da3b19c79c27945d873eb24e34431cbefa8f9938), [`6a9a73b`](https://github.com/millionco/react-doctor/commit/6a9a73b14908272535aabab6742258b61bc2ee5c), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b)]:
  - oxlint-plugin-react-doctor@0.6.3

## 0.6.2

### Patch Changes

- Updated dependencies [[`f07ee37`](https://github.com/millionco/react-doctor/commit/f07ee37598360b7d761505afe6960f9fd2f93595)]:
  - oxlint-plugin-react-doctor@0.6.2

## 0.6.1

### Patch Changes

- Updated dependencies [[`5f60bef`](https://github.com/millionco/react-doctor/commit/5f60befa8f954d3daf6e790670be8a170683e708), [`6885698`](https://github.com/millionco/react-doctor/commit/6885698cda0bc35446a13a1af7327f62c9c68025)]:
  - oxlint-plugin-react-doctor@0.6.1

## 0.6.0

### Patch Changes

- [#936](https://github.com/millionco/react-doctor/pull/936) [`ba2af1b`](https://github.com/millionco/react-doctor/commit/ba2af1b7faa5ef4e1ae39e6c3b786259fba23f1f) Thanks [@aidenybai](https://github.com/aidenybai)! - Update the license to MIT with additional restrictions: the software may not be used as training, fine-tuning, or evaluation data for machine-learning models or AI systems, nor sold or resold as a commercial product or service (e.g. a paid API, SaaS, or hosted/managed service) whose value derives substantially from the software, without prior written permission (contact founders@million.dev). Each version's additional restrictions expire on the second anniversary of its release, after which that version is available under the standard MIT License (an FSL-style grant of future license). Each published package now ships its own up-to-date `LICENSE` file so the terms travel with the tarball.

  The `react-doctor` CLI also now prints a one-time notice (once per run) when it detects it is running inside an AI/ML training pipeline or agent sandbox, pointing to the license terms.

- [#1013](https://github.com/millionco/react-doctor/pull/1013) [`7ef9f0e`](https://github.com/millionco/react-doctor/commit/7ef9f0eb7c026b4f9003902d1ab66d232e8ab43f) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - fix(rules): close three follow-up gaps in the 20-day audit fixes

  - **Comment stripper**: `isRegexLiteralStart` now uses a Unicode-aware
    identifier class, so a division after a non-ASCII identifier (`café / total`,
    `合計 / 個数`) is no longer misread as a regex literal — which had blanked
    real code up to the next slash and let `/* … */` comment bodies escape
    stripping across the pattern-based security-scan rules.
  - **`server-auth-actions`**: the cache/navigation exemption now requires the
    callee to resolve to _any_ import rather than specifically `next/cache` /
    `next/navigation`. A module-local `const revalidatePath = …` (a privileged
    shadow) is still flagged, but a revalidation-only action importing through a
    common re-export barrel (`import { revalidatePath } from "@/lib/cache"`) is no
    longer a false positive.
  - **`rn-no-raw-text`**: fragment piercing now sees through named
    `<Fragment>` / `<React.Fragment>` (via the existing `isJsxFragmentElement`
    helper), not only the shorthand `<>`, so children forwarded through a named
    fragment into a host are classified the same as the shorthand form.

- [#1017](https://github.com/millionco/react-doctor/pull/1017) [`c2af308`](https://github.com/millionco/react-doctor/commit/c2af3082bfcb85c97e4bfa0d0d71f20478cebe9b) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix four false positives found by React Doctor reviewing real, idiomatic React code (the Ink TUI in [#979](https://github.com/millionco/react-doctor/issues/979)):

  - `no-derived-state` no longer flags state accumulators — a `setState` inside an effect whose functional updater computes the new value from its own parameter (`setKeys((previous) => new Set(previous).add(key))`, `setTotal((prev) => prev + count)`, `setItems((prev) => [...prev, item])`). Accumulated history is by definition not derivable from the current props/state. The spread-only object merge (`setForm((prev) => ({ ...prev, field: <derived> }))`) still reports.
  - `no-array-index-as-key` no longer flags positional rendering of string fragments (characters, lines, tokens): `[...str]` and `Array.from(str)` where the source is provably a string (literal, template, `String()` call, or a binding/prop typed `string` in the same file), plus any `str.split(...)` receiver (only strings have `.split`, so no proof is needed) — including a local binding initialized from one (`const parts = line.split(" "); parts.map(...)`). Fragment position is the stable identity there — nothing reorders, filters, or carries per-item state. Data lists still report.
  - `prefer-useReducer` now requires an actual co-update signal instead of merely counting `useState` calls: it reports only when the threshold number of distinct setters are called together as sibling statements of one handler/effect block. Independent state updated from separate handlers or separate keyboard-handler branches stays quiet, and the message no longer claims each `useState` "can trigger a separate render" (wrong since React 18 automatic batching) — it now explains the real rationale: state that changes together is easier to keep consistent as a single reducer action.
  - `jsx-no-jsx-as-prop` only claims what it can prove: when the receiving component is not resolvable in the current file (imported), the message uses conditional wording ("If this child is memoized, …") instead of asserting a memo bailout that may not exist. Same-file components provably wrapped in `memo()` (or MobX `observer()`) keep the assertive message; provably plain function components already stayed quiet.
  - `lazy()` / `React.lazy()` components are no longer treated as memoized — `lazy` defers loading but does not skip re-renders. `jsx-no-jsx-as-prop` now uses the conditional wording for them, and the memoised-consumer-gated rules (`jsx-no-new-object-as-prop`, `jsx-no-new-array-as-prop`, `jsx-no-new-function-as-prop`, `prefer-stable-empty-fallback`) no longer report fresh-reference props passed to a `lazy()` component, matching their premise of a provably defeated memo bailout.

- [#958](https://github.com/millionco/react-doctor/pull/958) [`c72b560`](https://github.com/millionco/react-doctor/commit/c72b560682f1254aa4dd793898f2eed48afdbe27) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix `jsx-key`'s spread-overwrites-`key` check to key off the spread's position. A `{...spread}` can only clobber an explicit `key` when it appears _after_ the key — the later attribute wins under the classic runtime (`{ key, ...spread }`) and React falls back to `createElement` under the automatic runtime, so the later spread wins there too. The rule now reports `<App key="x" {...spread} />` (and the sandwiched `<App {...a} key="x" {...b} />`) and stays silent on `<App {...spread} key="x" />`, which previously produced a false positive. Spreads of object literals that provably carry no `key` (e.g. `{...{}}`, `{...{ className }}`) are never treated as overwriting.

- [#984](https://github.com/millionco/react-doctor/pull/984) [`0b64af5`](https://github.com/millionco/react-doctor/commit/0b64af58b16329c5cae7a210463d2842e34b150d) Thanks [@aidenybai](https://github.com/aidenybai)! - Stop `no-eval` and `auth-token-in-web-storage` from firing in non-production files

  `eval` / `new Function` / a stringy `setTimeout`, and a token written to web
  storage, are only vulnerabilities in code that ships to users. Both rules now
  skip test, spec, fixture, story, and script files (`isTestlikeFilename`), so a
  `new Function(...)` inside a `*.test.ts` or a throwaway token in `__tests__/` is
  no longer reported. The rules stay fully enabled in production code.

- [#1018](https://github.com/millionco/react-doctor/pull/1018) [`988ce57`](https://github.com/millionco/react-doctor/commit/988ce5701af82aef406be48190dace1449a5393c) Thanks [@aidenybai](https://github.com/aidenybai)! - Cut false positives across the state-and-effects rule family while locking the true-positive shapes in with regression tests:

  - `no-cascading-set-state` now counts setters per synchronous dispatch: deferred callbacks (timers, listeners, observers, promise continuations, subscriptions) no longer inflate the count on their own, but still compound when the effect also sets state synchronously; IIFE and synchronous-iteration (`forEach`/`map`/…) callbacks stay counted; statements after an unconditional `return`/`throw` are ignored, and early-return guard branches accumulate across re-runs.
  - `no-chain-state-updates`, `no-event-handler`, `no-pass-live-state-to-parent`, and `no-prop-callback-in-effect` stay silent when the triggering state is externally driven — its setter is called exclusively from timers, listeners, observers, promise continuations, or subscriptions — since there is no React event handler to fold the work into.
  - `no-derived-state` no longer flags a controlled-value mirror whose setter is also handed to a child as an `on*` JSX callback (`onChange={setValue}`): the state buffers the child's live edits.
  - `no-direct-state-mutation` exempts state whose `useState` initializer provably constructs a class instance (`useState(new TrackQueue())` or a lazy initializer returning one) — an opaque imperative object, not render data.
  - `no-pass-live-state-to-parent` and `no-prop-callback-in-effect` skip prop calls whose result flows into another call's argument (`setDisplay(format(amount))`) — a pure transform, not a parent hand-back — and `no-pass-live-state-to-parent` also skips functions returned by state-owning custom hooks.
  - `rerender-functional-setstate` recognizes `debounce`/`throttle` wrappers as deferred execution.
  - `rerender-state-only-in-handlers` no longer flags state that drives a side-effect-only `useEffect` dependency, feeds a render-phase hook call, or participates in React's adjust-state-while-rendering pattern. Effect reads are now resolved through binding scopes, so a local that shadows a state name neither hides nor fakes a read of the outer value.
  - `no-initialize-state` only defers to a mount effect for measurement API calls (`window.matchMedia(...)`), not bare method references (`!!window.matchMedia`) or scalar reads (`window.innerWidth`).

- Updated dependencies [[`ba2af1b`](https://github.com/millionco/react-doctor/commit/ba2af1b7faa5ef4e1ae39e6c3b786259fba23f1f), [`7ef9f0e`](https://github.com/millionco/react-doctor/commit/7ef9f0eb7c026b4f9003902d1ab66d232e8ab43f), [`c2af308`](https://github.com/millionco/react-doctor/commit/c2af3082bfcb85c97e4bfa0d0d71f20478cebe9b), [`c72b560`](https://github.com/millionco/react-doctor/commit/c72b560682f1254aa4dd793898f2eed48afdbe27), [`6e67626`](https://github.com/millionco/react-doctor/commit/6e6762667838caa518cea203fe985184ab0bd31f), [`0b64af5`](https://github.com/millionco/react-doctor/commit/0b64af58b16329c5cae7a210463d2842e34b150d), [`5639b1e`](https://github.com/millionco/react-doctor/commit/5639b1e40e66650cb7042206b19807b2f785d8ff), [`988ce57`](https://github.com/millionco/react-doctor/commit/988ce5701af82aef406be48190dace1449a5393c), [`f69f216`](https://github.com/millionco/react-doctor/commit/f69f21681dd7f17d632a09d742d501ef0b9b3047), [`6e67626`](https://github.com/millionco/react-doctor/commit/6e6762667838caa518cea203fe985184ab0bd31f), [`6e67626`](https://github.com/millionco/react-doctor/commit/6e6762667838caa518cea203fe985184ab0bd31f), [`6e67626`](https://github.com/millionco/react-doctor/commit/6e6762667838caa518cea203fe985184ab0bd31f), [`6339f71`](https://github.com/millionco/react-doctor/commit/6339f715cc1a30521a699b818140ec2fae6f569e)]:
  - oxlint-plugin-react-doctor@0.6.0

## 0.5.8

### Patch Changes

- Updated dependencies [[`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae)]:
  - oxlint-plugin-react-doctor@0.5.8

## 0.5.7

### Patch Changes

- Updated dependencies [[`424d8f9`](https://github.com/millionco/react-doctor/commit/424d8f9f914ff98b791af6b1f88337922c80c8ef), [`81bbfcc`](https://github.com/millionco/react-doctor/commit/81bbfcc39a0ae2f7d92ebb8860d854d09a60344d), [`937a7ca`](https://github.com/millionco/react-doctor/commit/937a7ca8a1b066a62210dc4a11149b9180dc9851), [`b8170f8`](https://github.com/millionco/react-doctor/commit/b8170f814c079d7bbc9e7796dd13646a6e8175fe), [`3f7d0e7`](https://github.com/millionco/react-doctor/commit/3f7d0e7ddb055b4970cba2b393ce14f6615732e4), [`6b8e756`](https://github.com/millionco/react-doctor/commit/6b8e756c40fe300634aec766edb00cbec73d8bc4), [`03301fc`](https://github.com/millionco/react-doctor/commit/03301fcdf4adcf256ef7ef7ed83f5566181ab371), [`44db3e0`](https://github.com/millionco/react-doctor/commit/44db3e0546fe0518b79e0aa2636754dcccda2939), [`5b742fa`](https://github.com/millionco/react-doctor/commit/5b742fa28c96443bd5bbd6348ad5aba55e17405c), [`8908f98`](https://github.com/millionco/react-doctor/commit/8908f98d02ad65e58d740ab948f8111948592cb9), [`451beeb`](https://github.com/millionco/react-doctor/commit/451beeb28405aa6810946e3311dfc7fb8de74632)]:
  - oxlint-plugin-react-doctor@0.5.7

## 0.5.6

### Patch Changes

- Updated dependencies [[`ea3b827`](https://github.com/millionco/react-doctor/commit/ea3b8278996613114c9c671afe292193388741c0), [`5fc0e27`](https://github.com/millionco/react-doctor/commit/5fc0e270c9a15d25be96ef982755cea81065d141), [`ea3b827`](https://github.com/millionco/react-doctor/commit/ea3b8278996613114c9c671afe292193388741c0)]:
  - oxlint-plugin-react-doctor@0.5.6

## 0.5.5

### Patch Changes

- Updated dependencies [[`e90eb7a`](https://github.com/millionco/react-doctor/commit/e90eb7acbfc4e06de68de2cb6a96d3242f72963e)]:
  - oxlint-plugin-react-doctor@0.5.5

## 0.5.4

### Patch Changes

- Updated dependencies [[`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb), [`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb)]:
  - oxlint-plugin-react-doctor@0.5.4

## 0.5.3

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.5.3

## 0.5.2

### Patch Changes

- [#766](https://github.com/millionco/react-doctor/pull/766) [`94f9f4f`](https://github.com/millionco/react-doctor/commit/94f9f4fe98207181958f82275b41d94963bc73a2) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Bump `engines.node` to `^20.19.0 || >=22.13.0` so the declared support range matches transitive dependencies (`eslint-scope@9`, `eslint-visitor-keys@5` require `^22.13.0`), preventing EBADENGINE warnings on npm and hard install failures on Yarn 1 under Node 22.12.x.

- Updated dependencies [[`94f9f4f`](https://github.com/millionco/react-doctor/commit/94f9f4fe98207181958f82275b41d94963bc73a2), [`038aaf7`](https://github.com/millionco/react-doctor/commit/038aaf78c12f7f9a2699f46d3a6aa304dc69fc12), [`fee3fc4`](https://github.com/millionco/react-doctor/commit/fee3fc436e502ad4a6609ab8bda9c9a782d8ecd7), [`c4f0e60`](https://github.com/millionco/react-doctor/commit/c4f0e607b6092485d226c0d67c783270f4eec8b2), [`f52bd07`](https://github.com/millionco/react-doctor/commit/f52bd0737527df9ab81f3746e64bdb5ac1defbc7), [`7c88165`](https://github.com/millionco/react-doctor/commit/7c8816575aff26f11b5099c7ef009c4793fe260f)]:
  - oxlint-plugin-react-doctor@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [[`77a70ab`](https://github.com/millionco/react-doctor/commit/77a70ab8a78dd21dc305a6c2b924e4bbc44058ce)]:
  - oxlint-plugin-react-doctor@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [[`b4b79ad`](https://github.com/millionco/react-doctor/commit/b4b79addce225c47048127e04be2670c13bca332), [`af98f83`](https://github.com/millionco/react-doctor/commit/af98f83614526cca30f3a31ec2507a5df5da2bed), [`93d4eec`](https://github.com/millionco/react-doctor/commit/93d4eecdb8e9e339f4258e67fcfc3649e2024ede)]:
  - oxlint-plugin-react-doctor@0.5.0

## 0.4.2

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.4.2

## 0.4.1

### Patch Changes

- Updated dependencies [[`dc35070`](https://github.com/millionco/react-doctor/commit/dc35070a5066f9864a7565b952dec2f81bff1223), [`b1a22ef`](https://github.com/millionco/react-doctor/commit/b1a22efdf7b18f2cc8b7af6c0b12173ed3c76d34), [`73dcb20`](https://github.com/millionco/react-doctor/commit/73dcb2040dc6aa207beea074f846fd675c30bd2b), [`64667da`](https://github.com/millionco/react-doctor/commit/64667dae16b812ad9b4304bd7906d5ddbb50921a), [`ee9ab33`](https://github.com/millionco/react-doctor/commit/ee9ab336d3b2918d319bc048b5b164f58611df83), [`fe5f3de`](https://github.com/millionco/react-doctor/commit/fe5f3de330c5c55f6bcbed68070296eb67c2ec5b), [`831cf3f`](https://github.com/millionco/react-doctor/commit/831cf3fbfd703f5048de5c2c3258e47988a2cce0)]:
  - oxlint-plugin-react-doctor@0.4.1

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`eba20ae`](https://github.com/millionco/react-doctor/commit/eba20ae9a708af81c7d95dbdadf16c8e5c6d21f9), [`5d7b36b`](https://github.com/millionco/react-doctor/commit/5d7b36bc315ba4c0a8ba6b60bd781a11efbed94f)]:
  - oxlint-plugin-react-doctor@0.3.0

## 0.2.18

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.18

## 0.2.17

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.17

## 0.2.16

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.16

## 0.2.15

### Patch Changes

- Updated dependencies [[`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7), [`75c1f99`](https://github.com/millionco/react-doctor/commit/75c1f99e062a8fc3e5e4ba294208dbc56bca5f6f)]:
  - oxlint-plugin-react-doctor@0.2.15

## 0.2.14

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.14

## 0.2.13

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.13

## 0.2.12

### Patch Changes

- [#570](https://github.com/millionco/react-doctor/pull/570) [`d917f62`](https://github.com/millionco/react-doctor/commit/d917f62ed6215e9a984c9bfa83940bba723ff5de) Thanks [@aidenybai](https://github.com/aidenybai)! - Add the `no-prop-types` architecture rule. React 19 removed runtime `propTypes` validation entirely — React no longer reads `Component.propTypes`, so invalid props that used to log a console warning now pass silently. The rule flags `Component.propTypes = { ... }` assignments and `static propTypes` class fields on component-cased identifiers, and is version-gated to React 19+ (`requires: ["react:19"]`) so projects where `propTypes` still runs stay quiet. It steers users toward TypeScript prop types plus explicit runtime validation. See [#460](https://github.com/millionco/react-doctor/issues/460).

- [#582](https://github.com/millionco/react-doctor/pull/582) [`b2934f9`](https://github.com/millionco/react-doctor/commit/b2934f93e439027ed132e40688d45ef682f05efb) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix a `rn-no-raw-text` false positive on fbtee translation tags. fbtee's `<fbt>` / `<fbs>` (and namespaced children like `<fbt:param>`) are compile-time translation tags that disappear at build time, so text inside `<Text><fbt>…</fbt></Text>` is really rendered inside `<Text>` and is safe on React Native. The rule now treats `fbt` / `fbs` as transparent wrappers when every ancestor up to a text-handling component is also transparent, while still reporting raw text when an `<fbt>` is used outside a `<Text>` boundary. See [#581](https://github.com/millionco/react-doctor/issues/581).

- Updated dependencies [[`d917f62`](https://github.com/millionco/react-doctor/commit/d917f62ed6215e9a984c9bfa83940bba723ff5de), [`d0f5206`](https://github.com/millionco/react-doctor/commit/d0f52062e09c7bfe11eda2c06ad6e9ab0ab7da58), [`b2934f9`](https://github.com/millionco/react-doctor/commit/b2934f93e439027ed132e40688d45ef682f05efb)]:
  - oxlint-plugin-react-doctor@0.2.12

## 0.2.11

### Patch Changes

- Updated dependencies [[`6f8640f`](https://github.com/millionco/react-doctor/commit/6f8640f6d98a75db90d28b56fdaf5abc81a53163)]:
  - oxlint-plugin-react-doctor@0.2.11

## 0.2.10

### Patch Changes

- Inherit the latest shared rule registry from `oxlint-plugin-react-doctor@0.2.10`: Preact compatibility checks, HTML correctness and dialog accessibility rules, `hooks-no-nan-in-deps`, Jotai atom diagnostics, React Native performance rules, `js-async-reduce-without-awaited-acc`, and React 19.2 `<Activity>` effect-boundary checks.

- Inherit false-positive fixes for `control-has-associated-label` and `no-giant-component`.

- Dependency bump: `oxlint-plugin-react-doctor@0.2.10`.

## 0.2.9

### Patch Changes

- Published with the trusted-publishing workflow update. No ESLint rule behavior changed in this package.

- Dependency bump: `oxlint-plugin-react-doctor@0.2.9`.

## 0.2.8

### Patch Changes

- add react-doctor.config.json schema field

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.8

## 0.2.7

### Patch Changes

- Bundle `eslint-plugin-react-hooks` as a direct dependency so React Compiler rules resolve without requiring users to install the peer separately.

- Inherit the `no-mutating-reducer-state` rule and helper consolidation from `oxlint-plugin-react-doctor@0.2.7`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.7

## 0.2.6

### Patch Changes

- Inherit the `design-no-bold-heading` rule removal from `oxlint-plugin-react-doctor@0.2.6`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.6

## 0.2.5

### Patch Changes

- Inherit the `jsx-key` shorthand fragment fix, static template literal normalization, and Node 20 support from `oxlint-plugin-react-doctor@0.2.5`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.5

## 0.2.4

### Patch Changes

- Inherit the Effect v4 runtime adoption, deprecated type stub removal, and user-plugin extension support from `oxlint-plugin-react-doctor@0.2.4`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.4

## 0.2.3

### Patch Changes

- Fix build configuration so the ESLint plugin resolves its dependency on `oxlint-plugin-react-doctor` correctly at publish time.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.3

## 0.2.2

### Patch Changes

- Restore `eslint-plugin-react-hooks` as a hard dependency so React Compiler rules resolve without requiring users to install the peer separately.

- [#273](https://github.com/millionco/react-doctor/pull/273) [`47772b7`](https://github.com/millionco/react-doctor/commit/47772b7da4f6e412b09e3a4f74d888307faf74a1) - Natively port the 8 rules from `eslint-plugin-react-you-might-not-need-an-effect`
  (NickvanDyke, MIT) into `oxlint-plugin-react-doctor`. They now ship as
  `react-doctor/*` rules and no longer require the optional peer
  dependency. The optional peer-dep surface (`effect/*` rules,
  `resolveYouMightNotNeedEffectPlugin`,
  `YOU_MIGHT_NOT_NEED_EFFECT_NAMESPACE`) is removed from
  `@react-doctor/core`.

  The ports use a real `eslint-scope` ScopeManager (cached per Program
  via `WeakMap`) - same `references` / `resolved.defs[].node.init` /
  `isEventualCallTo` chasing the upstream plugin uses. Diagnostic
  messages match upstream verbatim with template variables substituted
  in JS.

  | Rule (now `react-doctor/<id>`)      | What it catches                                                          |
  | ----------------------------------- | ------------------------------------------------------------------------ |
  | `no-derived-state`                  | Storing derived state via a useEffect instead of computing during render |
  | `no-chain-state-updates`            | Chaining state updates across effects                                    |
  | `no-event-handler`                  | Using state + a guarded effect as an event handler                       |
  | `no-adjust-state-on-prop-change`    | Adjusting state in an effect when a prop changes                         |
  | `no-reset-all-state-on-prop-change` | Resetting all state in an effect (use a `key` prop)                      |
  | `no-pass-live-state-to-parent`      | Pushing live state to a parent via a callback in an effect               |
  | `no-pass-data-to-parent`            | Passing fetched data to a parent via a callback in an effect             |
  | `no-initialize-state`               | Initializing state inside a mount-only effect                            |

  Parity coverage: 195 of 196 upstream test cases pass (the 1 remaining
  case is upstream's own `todo: true`, "Set derived state via identical
  intermediate setter").

  These coexist with React Doctor's existing thematically-related rules
  (`no-derived-state-effect`, `no-effect-chain`, `no-event-trigger-state`,
  `no-prop-callback-in-effect`) - different IDs, different shapes,
  different messages.

- Updated dependencies [[`47772b7`](https://github.com/millionco/react-doctor/commit/47772b7da4f6e412b09e3a4f74d888307faf74a1)]:
  - oxlint-plugin-react-doctor@0.2.2

## 0.2.1

### Patch Changes

- Make filesystem walks tolerate EPERM/EACCES (macOS Library)

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.1

## 0.2.0

### Minor Changes

- [`5be2ead`](https://github.com/millionco/react-doctor/commit/5be2eadd90b2248b28b228fad306808cec1bf758) - Add configuration-level controls for React Doctor's rule output. Users can now set top-level `rules` and `categories` severity overrides, tune individual output surfaces (`cli`, `prComment`, `score`, and `ciFailure`) by tag/category/rule id, and rely on registered rule-family tags such as `design`, `react-native`, `server-action`, `test-noise`, and `migration-hint` for broad filtering.

  The scan pipeline now applies those controls both when generating the oxlint config and when post-processing diagnostics, so `"off"` can skip rules before they run while `"warn"` / `"error"` restamp emitted diagnostics consistently across the CLI, score, PR comments, and CI failure gate. The oxlint plugin also exposes shared rule-set maps that the ESLint plugin reuses for its flat configs.

  Expose the GitHub Action's `annotations` input so workflow users can opt into inline PR annotations without dropping down to the raw CLI.

- [`809e38c`](https://github.com/millionco/react-doctor/commit/809e38cebabc15c42b3c40ee8c7a753c3d7549d0) - Extract project / dependency / framework detection, the oxlint runner +
  scoring engine, and the shared TypeScript type layer out of the
  `react-doctor` monolith into three new public workspace packages:
  `@react-doctor/types`, `@react-doctor/project-info`, and
  `@react-doctor/core` ([#249](https://github.com/millionco/react-doctor/issues/249)). The oxlint plugin is restructured into
  per-rule modules under `src/plugin/rules/<category>/<rule>.ts` with a
  codegen'd `rule-registry.ts` ([#218](https://github.com/millionco/react-doctor/issues/218), [#228](https://github.com/millionco/react-doctor/issues/228), [#230](https://github.com/millionco/react-doctor/issues/230), [#231](https://github.com/millionco/react-doctor/issues/231), [#234](https://github.com/millionco/react-doctor/issues/234), [#235](https://github.com/millionco/react-doctor/issues/235), [#236](https://github.com/millionco/react-doctor/issues/236),
  [#242](https://github.com/millionco/react-doctor/issues/242)). Land the user-feedback sweep ([#208](https://github.com/millionco/react-doctor/issues/208)): scoring transparency hooks,
  per-rule severity + rule-set selection config options, and reduced
  false positives across the design / Tailwind / state-and-effects rule
  families. Reorganise the CLI into `cli/commands/` + `cli/utils/`
  ([#250](https://github.com/millionco/react-doctor/issues/250)), and forward `reactMajorVersion` through programmatic
  `diagnose()` ([#174](https://github.com/millionco/react-doctor/issues/174)).

### Patch Changes

- [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c) - Rule-fix wave for the 0.2.0-beta.5 release:

  - Scope `no-secrets-in-client-code` to client-reachable bindings -
    skips server-only modules, public env-prefixed values, and
    locally-classified safe files ([#252](https://github.com/millionco/react-doctor/issues/252)).
  - `nextjs-no-side-effect-in-get-handler` stops flagging
    `response.headers.set(...)` and locally-constructed `Map` / `Set` /
    `Headers` inside GET handlers; the same safe-bindings classifier
    benefits `server-auth-actions` and the TanStack Start
    `get-mutation` rule ([#260](https://github.com/millionco/react-doctor/issues/260)).
  - `async-defer-await` no longer reports awaits inside destructured
    patterns with defaults, bare-statement early-returns, or awaits
    guarded by an earlier `if … return …` ([#265](https://github.com/millionco/react-doctor/issues/265)).
  - `js-length-check-first` detects length guards anywhere earlier in
    an `&&` chain, not only as the immediate left operand ([#269](https://github.com/millionco/react-doctor/issues/269)).
  - `async-parallel` is suppressed in test files, browser-fixture /
    Playwright helpers, and ordered UI flows where serial awaits are
    deliberate ([#270](https://github.com/millionco/react-doctor/issues/270)).
  - `js-combine-iterations` skips lazy `Iterator` helper chains
    (`Iterator.from`, `Iterator.prototype.{map,filter,take,drop,…}`)
    whose evaluation semantics differ from `Array.prototype` ([#272](https://github.com/millionco/react-doctor/issues/272),
    resolves [#205](https://github.com/millionco/react-doctor/issues/205)).
  - `no-prevent-default` is framework-aware: Remix / Next.js
    progressive-enhancement form handlers, synthetic event types with
    no documented alternative, and form `onSubmit` handlers that
    subsequently call `fetch` / a server action no longer trip ([#274](https://github.com/millionco/react-doctor/issues/274)).
  - New per-surface diagnostic controls in `@react-doctor/core` +
    `react-doctor`: design and Tailwind cleanup categories are demoted
    from the default PR-comment surface while staying visible in the
    CLI report and at the CI failure gate ([#271](https://github.com/millionco/react-doctor/issues/271)).

- [#266](https://github.com/millionco/react-doctor/pull/266) [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255) - Scope React Native rules to per-package boundaries. Previously every
  `rn-*` rule fired on every file in a project whose top-level framework
  was detected as React Native or Expo - even on sibling workspaces that
  were clearly web targets. In a mixed RN + web monorepo (`apps/mobile`
  alongside `apps/web` and `packages/storybook`) the rules would noisily
  report issues against Next.js, Vite, Docusaurus, Storybook, and plain
  React DOM packages where they don't apply.

  React Native rules now walk up to the file's nearest `package.json`
  before running. The rule body is skipped when the package declares a
  web-only framework (`next`, `vite`, `react-scripts`, `gatsby`,
  `@remix-run/react`, `@docusaurus/core`, `@storybook/*`, or plain
  `react-dom` without an RN sibling) and stays active when the package
  declares `react-native`, `expo`, `react-native-tvos`, `react-native-windows`,
  `react-native-macos`, anything under the `@react-native/` or
  `@react-native-` community namespaces (`@react-native-firebase/*`,
  `@react-native-async-storage/*`, `@react-native-community/*`, …), or
  Metro's top-level `"react-native"` resolution field.

  The detection is bidirectional: a web-rooted monorepo (root
  `package.json` declares `next` or `vite`) still loads `rn-*` rules
  when any workspace targets React Native or Expo, so the rules now
  fire on `apps/mobile` of a `next`-rooted repo as well as the inverse
  layout that the file-level boundary alone covered.

  `rn-no-raw-text` additionally skips raw text inside `Platform.OS === "web"`
  branches: `if`, `?:`, and `&&` / `||` short-circuits, the mirror
  `Platform.OS !== "web"` else branches, `switch (Platform.OS) { case "web": … }`
  case bodies, and the `web` arm of `Platform.select({ web: …, default: … })`.
  Optional chaining (`Platform?.OS`) and the TS non-null assertion
  (`Platform.OS!`) parse the same way as the bare form. The walker stops
  at function and `Program` boundaries so JSX defined inside a callback
  hoisted out of a `Platform.OS` branch does not inherit the parent
  guard.

  Native-only file extensions (`.ios.tsx`, `.android.tsx`, `.native.tsx`)
  keep the rule active even when the surrounding package classification
  is ambiguous.

- [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c) - False-positive sweep across the rule plugin and the oxlint runner:

  - Gate React-19-only rules on the detected React major version so they
    stay silent on React 18 projects, with hardened catalog / peer-range /
    workspace traversal in `@react-doctor/project-info` ([#254](https://github.com/millionco/react-doctor/issues/254)).
  - Treat early-return guards as render-reachable state reads so
    `rerender-state-only-in-handlers` / `no-event-trigger-state` stop
    recommending `useRef` for state that gates render output ([#255](https://github.com/millionco/react-doctor/issues/255)).
  - Narrow `no-effect-event-handler` - DOM imperatives, prop callbacks
    invoked from effects, and side effects routed through a stable ref
    are no longer reclassified as handler-only ([#256](https://github.com/millionco/react-doctor/issues/256)).
  - Suppress rules-of-hooks diagnostics on locally-defined `useX`
    helpers that are not React hooks, and add the `no-em-dash-in-jsx-text`
    / `no-three-period-ellipsis` typography rules ([#257](https://github.com/millionco/react-doctor/issues/257)).
  - Collapse duplicate oxlint diagnostics and recover diagnostics from
    large monorepo projects via batched runs + a new
    `dedupe-diagnostics` helper in `@react-doctor/core` ([#262](https://github.com/millionco/react-doctor/issues/262)).

- Updated dependencies [[`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c), [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255), [`5be2ead`](https://github.com/millionco/react-doctor/commit/5be2eadd90b2248b28b228fad306808cec1bf758), [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c), [`809e38c`](https://github.com/millionco/react-doctor/commit/809e38cebabc15c42b3c40ee8c7a753c3d7549d0)]:
  - oxlint-plugin-react-doctor@0.2.0

## 0.2.0-beta.6

### Minor Changes

- Add configuration-level controls for React Doctor's rule output. Users can now set top-level `rules` and `categories` severity overrides, tune individual output surfaces (`cli`, `prComment`, `score`, and `ciFailure`) by tag/category/rule id, and rely on registered rule-family tags such as `design`, `react-native`, `server-action`, `test-noise`, and `migration-hint` for broad filtering.

  The scan pipeline now applies those controls both when generating the oxlint config and when post-processing diagnostics, so `"off"` can skip rules before they run while `"warn"` / `"error"` restamp emitted diagnostics consistently across the CLI, score, PR comments, and CI failure gate. The oxlint plugin also exposes shared rule-set maps that the ESLint plugin reuses for its flat configs.

  Expose the GitHub Action's `annotations` input so workflow users can opt into inline PR annotations without dropping down to the raw CLI.

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.6

## 0.2.0-beta.5

### Patch Changes

- Inherits the rule-fix wave from
  `oxlint-plugin-react-doctor@0.2.0-beta.5` via the shared rule
  registry: `no-secrets-in-client-code` scoping
  ([#252](https://github.com/millionco/react-doctor/pull/252)),
  `nextjs-no-side-effect-in-get-handler` safe local bindings
  ([#260](https://github.com/millionco/react-doctor/pull/260)),
  `async-defer-await` destructuring / bare-statement / early-return
  fixes ([#265](https://github.com/millionco/react-doctor/pull/265)),
  `js-length-check-first` `&&`-chain detection
  ([#269](https://github.com/millionco/react-doctor/pull/269)),
  `async-parallel` test / browser-fixture suppression
  ([#270](https://github.com/millionco/react-doctor/pull/270)),
  `js-combine-iterations` lazy `Iterator` skip
  ([#272](https://github.com/millionco/react-doctor/pull/272)), and
  `no-prevent-default` framework awareness
  ([#274](https://github.com/millionco/react-doctor/pull/274)). See
  the oxlint plugin changelog for per-rule detail.

- [#266](https://github.com/millionco/react-doctor/pull/266) [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255) - Scope React Native rules to per-package boundaries. Previously every
  `rn-*` rule fired on every file in a project whose top-level framework
  was detected as React Native or Expo - even on sibling workspaces that
  were clearly web targets. In a mixed RN + web monorepo (`apps/mobile`
  alongside `apps/web` and `packages/storybook`) the rules would noisily
  report issues against Next.js, Vite, Docusaurus, Storybook, and plain
  React DOM packages where they don't apply.

  React Native rules now walk up to the file's nearest `package.json`
  before running. The rule body is skipped when the package declares a
  web-only framework (`next`, `vite`, `react-scripts`, `gatsby`,
  `@remix-run/react`, `@docusaurus/core`, `@storybook/*`, or plain
  `react-dom` without an RN sibling) and stays active when the package
  declares `react-native`, `expo`, `react-native-tvos`, `react-native-windows`,
  `react-native-macos`, anything under the `@react-native/` or
  `@react-native-` community namespaces (`@react-native-firebase/*`,
  `@react-native-async-storage/*`, `@react-native-community/*`, …), or
  Metro's top-level `"react-native"` resolution field.

  The detection is bidirectional: a web-rooted monorepo (root
  `package.json` declares `next` or `vite`) still loads `rn-*` rules
  when any workspace targets React Native or Expo, so the rules now
  fire on `apps/mobile` of a `next`-rooted repo as well as the inverse
  layout that the file-level boundary alone covered.

  `rn-no-raw-text` additionally skips raw text inside `Platform.OS === "web"`
  branches: `if`, `?:`, and `&&` / `||` short-circuits, the mirror
  `Platform.OS !== "web"` else branches, `switch (Platform.OS) { case "web": … }`
  case bodies, and the `web` arm of `Platform.select({ web: …, default: … })`.
  Optional chaining (`Platform?.OS`) and the TS non-null assertion
  (`Platform.OS!`) parse the same way as the bare form. The walker stops
  at function and `Program` boundaries so JSX defined inside a callback
  hoisted out of a `Platform.OS` branch does not inherit the parent
  guard.

  Native-only file extensions (`.ios.tsx`, `.android.tsx`, `.native.tsx`)
  keep the rule active even when the surrounding package classification
  is ambiguous.

- Updated dependencies [[`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255)]:
  - oxlint-plugin-react-doctor@0.2.0-beta.5

## 0.2.0-beta.4

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.4

## 0.2.0-beta.3

### Patch Changes

- Inherits the `no-barrel-import` index-resolution fix from
  [#253](https://github.com/millionco/react-doctor/pull/253) via the
  shared rule registry. See the oxlint plugin changelog.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.3

## 0.2.0-beta.2

### Minor Changes

- Inherits the per-rule module restructuring from
  `oxlint-plugin-react-doctor@0.2.0-beta.2`
  ([#249](https://github.com/millionco/react-doctor/pull/249) and
  follow-ups). The published ESLint plugin shape (flat-config-ready
  `recommended` / framework presets, `react-doctor/*` rule namespace)
  is unchanged - the bump is minor because rule authors writing
  custom shims now consume per-file modules instead of the previous
  kitchen-sink files.

### Patch Changes

- Inherits the beta.2 false-positive sweep from
  `oxlint-plugin-react-doctor@0.2.0-beta.2`:
  user-feedback rule tuning + scoring transparency
  ([#208](https://github.com/millionco/react-doctor/pull/208)),
  React-19 rule version-gating
  ([#254](https://github.com/millionco/react-doctor/pull/254)),
  render-reachable state analysis
  ([#255](https://github.com/millionco/react-doctor/pull/255)),
  narrowed `no-effect-event-handler` detection
  ([#256](https://github.com/millionco/react-doctor/pull/256)), and
  local `useX` helper suppression + new typography rules
  ([#257](https://github.com/millionco/react-doctor/pull/257)).

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.2
