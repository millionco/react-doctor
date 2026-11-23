import type { StockPackageContract } from "./resolve-stock-physical-entry.js";

// Proven regular members from integrity-checked stock archives.
// Live package metadata and source members must match these values.
export const STOCK_JEST_RENDERER_PACKAGES = {
  "@jest/core": {
    files: {
      "build/index.js": "a2d50f5a8491337eb9d87b3f3e11c8070908b20afd31e2cacfdd97c3123f98c6",
      "package.json": "f1c9552c84eb1ce4a291bbdd46827bc929e4bf0340dee78941d7348a3362ca41",
    },
    packageName: "@jest/core",
    version: "29.7.0",
  },
  "@jest/transform": {
    files: {
      "build/ScriptTransformer.js":
        "e07cd7a88714d6600d2d0cf88071f2df5635ece2bab9428bf5ae5b396d8d36ff",
      "build/index.js": "07c378f9ba2537946fdb24bffdb3fcc69472abe9a1dd00f3e530039585677f32",
      "package.json": "7b780a1a5a7c2b21ec7bd829301213835db61a2b60a01535d5b4a8380aeeebf5",
    },
    packageName: "@jest/transform",
    version: "29.7.0",
  },
  "@testing-library/dom": {
    files: {
      "dist/index.js": "4161f10eec17040425499179d5a72da86e9219c2e252ff87bad6c994f2a080f4",
      "package.json": "fc64bf9fe7a195d88311f679996f7e662941da6b85051e9472d0e2c3941a2314",
    },
    packageName: "@testing-library/dom",
    version: "10.4.0",
  },
  "@testing-library/react": {
    files: {
      "dist/act-compat.js": "e677572fecce84b93da90aef4a958d4dc5ee4ac76d466e798da6e576018e5e71",
      "dist/config.js": "09f85d7edf7795f65d39c8c382b611edd4de5f98923647d58aa49aab7bcc01f5",
      "dist/fire-event.js": "096daf3f4fb53cab55dc1b9c209200361491889639f478b1576041823db62309",
      "dist/index.js": "41e78e4a9bb806f2bb167bde3084489fa001f4fc8d9670f13d9a236da98f8cf6",
      "dist/pure.js": "889aa7ea739e65c7041ca801e7937c0645d04bed1d35781251ada787f9e517b4",
      "package.json": "29cb4a026c2e60f758e8d0325d48acff1b59c9a83d0a942eb51f35790704705d",
    },
    packageName: "@testing-library/react",
    version: "16.3.0",
  },
  "is-core-module": {
    files: {
      "core.json": "540e514fa6d22561a8c77ebc391066e6edc7de7abebf004f96ed6493345ea6c0",
      "index.js": "49ee5bbc34b2d520afd26bba50a0b4c996bdddbf518233d3fab51520d20fc42a",
      "package.json": "8b333baea62199fce87af28ba70632e093623ae3b8888e86f2dd525f2de0f69d",
    },
    packageName: "is-core-module",
    version: "2.16.1",
  },
  jest: {
    files: {
      "bin/jest.js": "2a9b435eab8a343bd09fe285b2e2043ff9ff89fae4e1d1f46ba3df28659d8a2c",
      "build/index.js": "970f4a71b4ba3d82e97507ba22548e2d56c7fbae2f86fa5a269cd654d29ee630",
      "package.json": "679fd6f49e8dcb1fd82b7d610c5d555b70204ad2e5e5092e284e9bc10eb9f353",
    },
    packageName: "jest",
    version: "29.7.0",
  },
  "jest-circus": {
    files: {
      "build/eventHandler.js": "0eb5af5b19c2d9c210428b74fd15eb3d1513917c582ffd1b6dfe9605b49e127a",
      "build/index.js": "f280ee39ad1181cc8cacc72032af10efa5112a7edfca679ad6ff60157d4eca63",
      "build/legacy-code-todo-rewrite/jestAdapter.js":
        "5decde9c87b3ef7946ca7b45068bf99f55a266333873adf8b3c99ba86b4ebc82",
      "build/legacy-code-todo-rewrite/jestAdapterInit.js":
        "f5a5a268af13d3519eaa5f9b359c50714b4d3f319dc5befac9144608210bbe08",
      "build/run.js": "e0ba3e46a59b751d7cc4ab5b6c00f27baa54d35b326c5dbc14404eb725fa8477",
      "package.json": "f022107cc4a2066b243db9dda60a4abcbac9607b14937fc1493091dfcdca1706",
      "runner.js": "a1d4a6d7e4bfdff844477c640ee12ed0df1b4649249a95e8d7c29e624c5eb07c",
    },
    packageName: "jest-circus",
    version: "29.7.0",
  },
  "jest-cli": {
    files: {
      "build/index.js": "83346c84c93ceaa9f4fcda9ba0d713bebc389b5903522f4162f8bf1d50396505",
      "package.json": "39ca39aa01d1ae1eb088e84c84fc263c5ce6df28d0e7d86b10e77ae9fc096ff1",
    },
    packageName: "jest-cli",
    version: "29.7.0",
  },
  "jest-config": {
    files: {
      "build/Defaults.js": "80cf43c82d56642e9d1b40782853bfbdcc576fa9e6e4d3cca7348d9950cb9451",
      "build/index.js": "e22fa526632cd362a6ddc8b11bf500dee8c10dac91ca07293d69ba5911d8aa8e",
      "build/normalize.js": "cf66e8284de0cac0a1411753046d9cd98dc260de7a914029f246985a678db632",
      "build/readConfigFileAndSetRootDir.js":
        "205db1bf0b8642c78822ab7d99a40a54fe0d7f6122327ec7b34ff5d8cc337beb",
      "build/utils.js": "b64edb9742a030a919834ff03b7771f078685952a4fc111b052c10482d69186b",
      "package.json": "0af7ad5e0cf7dcd22c1d8cbd22ba5fe46d246234cfd3b7a6e50baa648f3b5b1e",
    },
    packageName: "jest-config",
    version: "29.7.0",
  },
  "jest-environment-jsdom": {
    files: {
      "build/index.js": "3c9f0f87e8b17f7f0993e0d5abc0b4f071fdfc4b3c1ad0243d0275bc15cf59f7",
      "package.json": "fc1fb36dd7f83e4b7e5f91faf5deb5a8ce282ee20bdb5f4ed4dd2a91421383dc",
    },
    packageName: "jest-environment-jsdom",
    version: "29.7.0",
  },
  "jest-resolve": {
    files: {
      "build/defaultResolver.js":
        "bbd4e69e0f79c4b2c6d5dec1fef24534b3c73800951b478979e80669a35228c3",
      "build/fileWalkers.js": "4eb38f3a4a889701e5154cdcf356e1585111ee1a714a26f5e7b34d4926a0c0dd",
      "build/index.js": "a818e3c951c20699f88667d4ab02366f2d1f7b1556db749259c8bb512d0198c9",
      "build/resolver.js": "ef755edf6b6a5531821d3b72930c0f5805886309122cd275fb55211e546c3ec2",
      "build/utils.js": "a2632c024e7beb81082f2713ba626568be69e25564df9d1b34f4108dacc10be6",
      "package.json": "dc2e6a12baade43e2c7bca7e80009ea9c9c8a4e548a483acf8e83cbc5368d450",
    },
    packageName: "jest-resolve",
    version: "29.7.0",
  },
  "jest-runner": {
    files: {
      "build/index.js": "68eef378f68d2d492f41595d486b33bb7a17cedd4fe1e6db0f24f8d8ce71cf66",
      "build/runTest.js": "22a629522aff3c54bc4357915399bfddd5459ee05e591926e3b18f16a59c86a7",
      "build/testWorker.js": "b9d5cd3f471aa412be1fd67347c4281c481575a40e6b0299454ce161a8f9caf2",
      "package.json": "849a215327d27e74a271d9136908d74ebb44fd9241cdedeb3a19159343337f92",
    },
    packageName: "jest-runner",
    version: "29.7.0",
  },
  "jest-runtime": {
    files: {
      "build/index.js": "4afb88009e1b907c4d5b098930834a0f09115ebf5a2fe0551349d5a17bc3ef03",
      "package.json": "f70fb3d35e06e0f9b1845fb2718688f081974f4681a499a90d16545faba27162",
    },
    packageName: "jest-runtime",
    version: "29.7.0",
  },
  jsdom: {
    files: {
      "lib/api.js": "49ae58817d9426683a99d23470d4a37ab0c814c778ce798580bd2c76db0662c2",
      "lib/jsdom/browser/Window.js":
        "0fd4708762684e18dec1ed6dd4a6d1750e2f94261e2322e5c3080a9280ca60b3",
      "package.json": "9a2b2a263eb5f166f6053f448313f75bdfb0463baa4e7fd455df50b3d917eaa8",
    },
    packageName: "jsdom",
    version: "20.0.3",
  },
  react: {
    files: {
      "cjs/react-jsx-dev-runtime.development.js":
        "cd9394f47e01e9f1d87f7a8adcfc0ad8f8813d5c124ee74627791921f3277ac5",
      "cjs/react-jsx-dev-runtime.production.min.js":
        "c46386ede6d3618f7fe15be9312f9660916828ec4e07bec6b76cc6636db34b0d",
      "cjs/react-jsx-runtime.development.js":
        "581f93fa33c32b3aa7ea35b85b80258922517de046f5447236047dcc2845d9ff",
      "cjs/react-jsx-runtime.production.min.js":
        "76e3364c46895ed2c4a8d5cc332e5e4ef31d6f732d35b1e56826dc5895245452",
      "cjs/react.development.js":
        "1ff3a1d9861a87984329584fa1172aea920855d79eb57dae0d1cebe54093d7e3",
      "cjs/react.production.min.js":
        "4b35e378f469c4f492c7514bb106b5833746dbbae80496bd4aa9acc6e9ac4b42",
      "index.js": "a216c390bf956cbb906c66d29fdb2e2ad6999464a5ca83e476533a6f25ad0ef3",
      "jsx-dev-runtime.js": "25a7dbfdb2ae574b67fcdd2aab811080b415edd1c8043ead46866a533e99320e",
      "jsx-runtime.js": "28170e60f2ff0bc045bc7d175f5849e86f68dd02d76d7255369420718b30295a",
      "package.json": "d4e68a5c96babb20cad1daafea8b78822eae45b341552cf5418d06a5304fa64c",
    },
    packageName: "react",
    version: "18.3.1",
  },
  "react-dom": {
    files: {
      "cjs/react-dom-test-utils.development.js":
        "646e4ad0cda0a5479683dc329d5b158f206f0f709e813019272eff3b639b4eff",
      "cjs/react-dom.development.js":
        "1459b808bc6991de5a1ec3a86d8beee32dbb6c14282cf13f84e00dfebfbdc025",
      "cjs/react-dom.production.min.js":
        "cbf7fe6b9726ee65f8bcd5715289cc5161c8dacf74d0b8aaa0d29412516f5f47",
      "client.js": "a510041dfc40d69b3aa574e5e111864186c711fbeb3db41aa2f27196b27c429f",
      "index.js": "f26fcb81b5d1dc32c6edea34645c75b60d259916293d3208c8be48ac33e882e4",
      "package.json": "d2f29e31bd48b833e48cd7bbf41f192e8ee4ff8da249fdbe10d4ac4114b8b12e",
      "test-utils.js": "96b11c202300fc90ed6766e170ae6c075f3950636c839371b90e1bbf1c074bc8",
    },
    packageName: "react-dom",
    version: "18.3.1",
  },
  resolve: {
    files: {
      "index.js": "4952fa49a809ad740f6d9b6a1c1e9a9c93777f37b03efd253291ff68753a56b8",
      "lib/caller.js": "642c43c3f22077eb0d3cd7de3eafe513642919af238c5dcde1529af10e3e98d4",
      "lib/homedir.js": "6a60b7222828ea4f2818cfddd72c0767ae9ce3f5e64a22d51814cc771c4f7b79",
      "lib/node-modules-paths.js":
        "fe129d32d7c331783bc066fff8d90428ee95176faed9e64cc9077c1c2688704a",
      "lib/normalize-options.js":
        "88db22b3239f92484b70acadf2b4c786c7117af191c0efe46d17fdda9e40743a",
      "lib/sync.js": "d0846c2ad90e16795a0ffe69b22080cc1266f5f6902af663b1f23abe8e299ffd",
      "package.json": "ee5d2ef47e108920c9285f6e9ad4bd7088f1f6bfec9da54e49af28ca775a288c",
    },
    packageName: "resolve",
    version: "1.22.10",
  },
  "resolve.exports": {
    files: {
      "dist/index.js": "a4f66f7d4c029fe349c8f511b83cae045b734be397a783300271f5b6bd3c7576",
      "package.json": "0c7d5fe8e3174d4abb8f9f68e550837daef90b129e96b3bb41d486ef3b456895",
    },
    packageName: "resolve.exports",
    version: "2.0.3",
  },
  scheduler: {
    files: {
      "cjs/scheduler.development.js":
        "22e3d959dc9f9cd59fca4e1fc95fecb9fde4d2cb8ecadbd279137ada995983ac",
      "cjs/scheduler.production.min.js":
        "f6cb8cf42696980c702f6b879417ab8bd489660485eb012b46f67e92e18a78ee",
      "index.js": "b413b3aac7bd209fd82cbe2241fda1467558daaef830744f45ed8396fac9185e",
      "package.json": "0893643a24576d727174e639586b8833a53f2a7b4a2199a719b9cfcebe9bae88",
    },
    packageName: "scheduler",
    version: "0.23.2",
  },
  "ts-jest": {
    files: {
      "dist/config/index.js": "ff3d33de501dc536e092da96f55d0f610ef05f3949700b737315121ce14ce036",
      "dist/config/paths-to-module-name-mapper.js":
        "1f48dc625fb7f159c8a6e441bfe0e5167101ba6eb6c6b473bb68bd820ed7646a",
      "dist/index.js": "a1cec1ba5c519b32ff925e6734daa90e07dc3e648e3b4afb4bd8a6929888bcf9",
      "dist/legacy/compiler/ts-compiler.js":
        "58c06553cdd66a10589d2248c0643785cdd0cd76d58ee14a27b64c2ccc1c4922",
      "dist/legacy/config/config-set.js":
        "8f9048f325ebafb00b707b08b3e36ea31990d0c3234c9efd88c23c4cdec64df1",
      "dist/legacy/ts-jest-transformer.js":
        "1dbe11ab0c4173046e80348a57e852436b5b8d44ecf5b7f82b83821053736f14",
      "dist/presets/all-presets.js":
        "077be3792305ca782bda9bf0d95d823af75a32526b4a52163bc0f31131397222",
      "dist/presets/create-jest-preset.js":
        "3cf09e67a77e630a4c3348202fc0f5b5d3f72f00434c92a12e635727ce55d06a",
      "dist/transformers/hoist-jest.js":
        "131e716bc9a76654ffa244d70184a18d4e5f35f8a48b6549aec5a65c933dcdbd",
      "dist/utils/importer.js": "031e7a0ed52f6b1f5bd90b30094b184b1d8efcb9eb37f15f1aabdff54da709f9",
      "jest-preset.js": "596c31cab1ab0165f5d571b7089b517b6bacc53c2781774bc9a921bcb8c5cebd",
      "package.json": "1250590c786ba1c5b5dc42bbd71f3a5424833b912e9ef08bfc5011612737d060",
      "presets/index.js": "079323fb6147284a91129f21471bbed8c0c606b3365c86725d64a95e3f9bf2ea",
    },
    packageName: "ts-jest",
    version: "29.3.4",
  },
  typescript: {
    files: {
      "lib/typescript.js": "2e78d8d8d3b631646830e478dbee1ca109474840fe5ed7ca6c5b418f2e20b1a2",
      "package.json": "31f53749119232ad7d4550fed18793dd60c4863473093c29df1905fccf761c28",
    },
    packageName: "typescript",
    version: "4.9.5",
  },
} satisfies Readonly<Record<string, StockPackageContract>>;
