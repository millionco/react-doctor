// Trusted published npm release profiles; no project content or lockfile hash.
export interface ElectronCompilerPackageProfile {
  readonly directory: string;
  readonly name: string;
  readonly version: string;
  readonly memberCount: number;
  readonly contentDigest: string;
  readonly entryMembers: Readonly<Record<string, string>>;
}
export const STOCK_ELECTRON_RENDERER_PROFILE: {
  readonly packages: readonly ElectronCompilerPackageProfile[];
  readonly edges: readonly {
    readonly issuer: string;
    readonly specifier: string;
    readonly target: string;
  }[];
  readonly missing: readonly { readonly issuer: string; readonly specifier: string }[];
} = {
  packages: [
    {
      directory: "node_modules/electron-vite",
      name: "electron-vite",
      version: "2.3.0",
      memberCount: 19,
      contentDigest: "c7affb9aac9ca9c3d86169e31b2bb067c96a16e23785b1424232920e7823199c",
      entryMembers: {
        "dist/index.cjs": "24b4cf8e6df63ca1508e12932a14824fc3e3d19c05cd9e3917d74f5822735563",
        "dist/index.d.ts": "bd0e57158bd69732d3199a1d287435d52057e1687c760ae2c21af234b2ec7672",
        "dist/index.mjs": "d5830539f52b218f971bda32ef1dd5070d496da9d0d012cde4fabf84c5cf1a52",
        "node.d.ts": "2efbc5086f10635b6507392c3d9d073e94d9308a5cf08af5ae4389c250d1791c",
        "package.json": "156ebe9614c521f844a4dde94368aa20a9587a813cc45023a9550eed44ff1f0c",
      },
    },
    {
      directory: "node_modules/electron",
      name: "electron",
      version: "34.5.8",
      memberCount: 1,
      contentDigest: "2810dfc4595ced8929584b59827d0d574210d98858e3c8ed9fb2c29cbde60913",
      entryMembers: {
        "package.json": "308874b13e2c1a6bf982f6a991f501c6da8b6763095705bf2cd943aa527e5a9a",
      },
    },
    {
      directory: "node_modules/vite",
      name: "vite",
      version: "5.4.2",
      memberCount: 31,
      contentDigest: "861f86305ee2f8b7b41e0a5fc40de70bcf56870878a3fd4d4a5435cf08522420",
      entryMembers: {
        "client.d.ts": "984c09345059b76fc4221c2c54e53511f4c27a0794dfd6e9f81dc60f0b564e05",
        "dist/node/index.d.ts": "9ae0ca65717af0d3b554a26fd333ad9c78ad3910ad4b22140ff02acb63076927",
        "dist/node/index.js": "516ad4796a3ba6ec8eb881477d6a89ddcaa08c0f6861661a4c60d0bb3b22d7cc",
        "dist/node/runtime.d.ts":
          "82e687ebd99518bc63ea04b0c3810fb6e50aa6942decd0ca6f7a56d9b9a212a6",
        "dist/node/runtime.js": "2eabe923c5aa47a7ff18b5e88863b92b3d5d0ac33eb47ba6440163c7fa5c684f",
        "index.cjs": "39ceb2afa23ed2b597af850964a60605dc9c64160212c4b26e60d086e63fd02f",
        "index.d.cts": "0944e58e317834ff012037fc6ba9fc5823b2b777bfdef407fd46df6b968adde5",
        "package.json": "ddcc7d49712881548fd417401609173ef1937c8061ecf9775fc384a2b9bfcfe3",
      },
    },
    {
      directory: "node_modules/@vitejs/plugin-react",
      name: "@vitejs/plugin-react",
      version: "4.3.1",
      memberCount: 9,
      contentDigest: "f29bb350ac621111dd313fe764b246270ffd3b2678af9b43c904ef00fc792035",
      entryMembers: {
        "dist/index.cjs": "d5b86e3903e4e390ab759c58af499e52840ed378c9cfce3bf0dd1343782b4203",
        "dist/index.mjs": "fcd1031ab5d5242374b907838edc0a0279a2f83115ee74bfeb2bc367f38d7774",
        "package.json": "d25947910731425f1e7d64652bac44cb245bc32eb150832039d9596177bd2753",
      },
    },
    {
      directory: "node_modules/esbuild",
      name: "esbuild",
      version: "0.21.5",
      memberCount: 7,
      contentDigest: "5c899862c2729509b723668f4479833e3381f13533ab88384c29443098ae1082",
      entryMembers: {
        "bin/esbuild": "9ce5381d8403ef3e2738e32d1dcf9728d65a0b9e76c242110419d86dc034d62c",
        "lib/main.js": "ac0772cb9176e4dd1d896be746b82edff699103940c8535a286493cecb69bdee",
        "package.json": "0f35e0d63bd60a43ed85879604a40f7e9688b321904cf28a95be5b1bc629559c",
      },
    },
    {
      directory: "node_modules/react",
      name: "react",
      version: "18.3.1",
      memberCount: 20,
      contentDigest: "c649827d47a43f340f69441f1a6860e10a6e24d012a39238f5a1657545b2fb18",
      entryMembers: {
        "cjs/react-jsx-runtime.production.min.js":
          "76e3364c46895ed2c4a8d5cc332e5e4ef31d6f732d35b1e56826dc5895245452",
        "cjs/react.production.min.js":
          "4b35e378f469c4f492c7514bb106b5833746dbbae80496bd4aa9acc6e9ac4b42",
        "index.js": "a216c390bf956cbb906c66d29fdb2e2ad6999464a5ca83e476533a6f25ad0ef3",
        "jsx-dev-runtime.js": "25a7dbfdb2ae574b67fcdd2aab811080b415edd1c8043ead46866a533e99320e",
        "jsx-runtime.js": "28170e60f2ff0bc045bc7d175f5849e86f68dd02d76d7255369420718b30295a",
        "package.json": "d4e68a5c96babb20cad1daafea8b78822eae45b341552cf5418d06a5304fa64c",
        "react.shared-subset.js":
          "6e0253e5955264bf6d1014066f3921ab0715f432f27c5983bc487ced2a64f95b",
      },
    },
    {
      directory: "node_modules/react-dom",
      name: "react-dom",
      version: "18.3.1",
      memberCount: 32,
      contentDigest: "1fc98234edcd7670f93c9d436d584a0ad90e2f80d6f494d9929c1345ba16f667",
      entryMembers: {
        "client.js": "a510041dfc40d69b3aa574e5e111864186c711fbeb3db41aa2f27196b27c429f",
        "index.js": "f26fcb81b5d1dc32c6edea34645c75b60d259916293d3208c8be48ac33e882e4",
        "package.json": "d2f29e31bd48b833e48cd7bbf41f192e8ee4ff8da249fdbe10d4ac4114b8b12e",
        "profiling.js": "4d7fc987f48ce3afc8ff9e19d6e1d0d643c14d9dd255ce0c4c177cc6e4af3e3e",
        "server.browser.js": "25b2a8fbe5dbf5e38f32fb11db0af0c67f6c61abb3ef22a7c71473202cabf653",
        "server.node.js": "a0f7a56527b73f95ac283578815fad4a4e5e849f451267fb7a0d7b347453727c",
        "test-utils.js": "96b11c202300fc90ed6766e170ae6c075f3950636c839371b90e1bbf1c074bc8",
      },
    },
    {
      directory: "node_modules/scheduler",
      name: "scheduler",
      version: "0.23.2",
      memberCount: 17,
      contentDigest: "b69abbdb3be0195d037928621d94fbe187c330be4e1138cf1473e6a0ac349887",
      entryMembers: {
        "index.js": "b413b3aac7bd209fd82cbe2241fda1467558daaef830744f45ed8396fac9185e",
        "package.json": "0893643a24576d727174e639586b8833a53f2a7b4a2199a719b9cfcebe9bae88",
      },
    },
    {
      directory: "node_modules/@babel/core",
      name: "@babel/core",
      version: "7.25.2",
      memberCount: 120,
      contentDigest: "10227ceb000b6a31b38d6c6c5fdb1eb048a67aba4bc4a1cf81053b83fcb79ae4",
      entryMembers: {
        "lib/index.js": "fc7b3e687ec7f30f4a83a3d5bfcea321ca7ef84aae11335b360a22d69eeb4f24",
        "package.json": "b24be99b03b8bc86f06c0ec24240e372195ae25abd371327c3f4c0eeee596aed",
      },
    },
    {
      directory: "node_modules/@babel/plugin-transform-arrow-functions",
      name: "@babel/plugin-transform-arrow-functions",
      version: "7.24.7",
      memberCount: 7,
      contentDigest: "7ccf408b91fa4582a52ccca4b9e1d12ea93cbf1c7e9a30f295dd6edc292dd04c",
      entryMembers: {
        "lib/index.js": "471541066aaaad7ef662a2f73274f608f176e299a4b029020abb804856bd23a1",
        "package.json": "b110eb8195a9e89043a5e0c48444de17e4128ea1661be223ecba8f3c626a2f41",
      },
    },
    {
      directory: "node_modules/cac",
      name: "cac",
      version: "6.7.14",
      memberCount: 15,
      contentDigest: "5419cc5a100bfb38cc1f0fe96d99f3310289e18b3d55155ca1954d294f9a737a",
      entryMembers: {
        "dist/index.d.ts": "994a9dc0817e0ffe64b9529828e003a3c495343d097e7a602027adf3cd606f71",
        "dist/index.mjs": "77a876ecf34f8eb9002725ec4d04b315f1c4be8346642c0515926c99cec76d91",
        "index-compat.js": "f2203c9a5ac94d665fc0ae528d9051994b3c30fbe901384d42d2fa97c91eb99c",
        "package.json": "8677bbbe7404ce455200b5f088a45f841bd8a40e7d63475ac711b631516ddcdf",
      },
    },
    {
      directory: "node_modules/magic-string",
      name: "magic-string",
      version: "0.30.11",
      memberCount: 11,
      contentDigest: "528ef3683df28e35556c7fa1f4405d6541051785b1b2595add6fdc409d00443c",
      entryMembers: {
        "dist/magic-string.cjs.js":
          "544db05ce0a15f53fe95d960b5ca09338d3065491c4d153f31d368c1d0f1b944",
        "dist/magic-string.es.mjs":
          "23db387504b2eeae88d0942e869b666312bbf237378aad12424f5604f10242ae",
        "package.json": "8d5f9dc945ec56375ab3e215c44d8fe30a1df5406d024dbbccd0617150ec6c70",
      },
    },
    {
      directory: "node_modules/picocolors",
      name: "picocolors",
      version: "1.0.1",
      memberCount: 7,
      contentDigest: "ed35135d2862114ea9eeeea99dd353e5571ae1111fe2690c3aab75240842d3fc",
      entryMembers: {
        "package.json": "151fe2ce0a8e1a1809ff8d3ed67f16c736c5bc570a350f78612135510e1fe93f",
        "picocolors.js": "99c3c8d2635220c648da1f01c24dc04bd7532b24214e4df9edd245749c65c6b3",
      },
    },
    {
      directory: "node_modules/@types/node",
      name: "@types/node",
      version: "22.16.3",
      memberCount: 67,
      contentDigest: "93c37c4e013b57eb6fedeca9b277dd2be9e819aa766e4ef6793c344ad460240e",
      entryMembers: {
        "package.json": "1c011125e20b82840860319af311eb7936373b1a0ae95d72fd7c97044cfe20b6",
      },
    },
    {
      directory: "node_modules/postcss",
      name: "postcss",
      version: "8.4.41",
      memberCount: 55,
      contentDigest: "80b1d1455a6f891091ed9ff3b36e25959f80e83fd0ec4066c84aa4d9860f4788",
      entryMembers: {
        "lib/at-rule.js": "33b932bda8f304e9838a70232673326b6c0fd5fa030df35071bf36c127042a0b",
        "lib/comment.js": "674385438f42526f2c05c19dfb66fcc521f5cf180ccc85b3215ad5c07ac21a40",
        "lib/container.js": "28fcd771934aebd465795342a8e68ed5190e3e7ff78d420b6326f1ff94f0889d",
        "lib/css-syntax-error.js":
          "929bea589ef9d29d2711429f3407986f76adeabe76f727b02144ca37bbd5d709",
        "lib/declaration.js": "1a16f193814168ca7c7526133f0eec0526de6eed9c38c105b9c46d76c1101539",
        "lib/fromJSON.js": "4be0b0fa5d48f912933b958b5813f9efa3d6113726e5857cee765001e03b0c8d",
        "lib/input.js": "39803f755bac9628767f8f32e14bb97d660d23cda06e71bd2790f409eb4bbfc4",
        "lib/lazy-result.js": "02290ebfa7d264dd2f771b6be477dcb38fafafc3aff3f2cd2d1bbac39bfd5aa6",
        "lib/list.js": "6df35bac40d4c449ae8e9078776e5c17c529337830a01472761902a546032f52",
        "lib/map-generator.js": "74238b05042e7890d388a126b419d4b579a220439df14fcca57dbc2567160c2e",
        "lib/no-work-result.js": "0455e9bf283e7c5e6efe34f64a948d483316522f83744582715c3b1443f7ced7",
        "lib/node.js": "e9c49adf52654d19cb4d3a0b367c56cc4b958b031499625a8146c717eff317ab",
        "lib/parse.js": "57968b21181210bda81c74b5b019c3f5562d696970f341622f80a67090ac09aa",
        "lib/parser.js": "1335b03c13109bd2503e83977105611ccdc5be9fe903471d79441b7b38cda492",
        "lib/postcss.js": "998c5e1e05d436b43814946784ec967547ab96422baaae167810607010b1ebc2",
        "lib/postcss.mjs": "986ebc2d661a3e93b6e026dd2e1925e18167efdcc963f4043a65e1859974664f",
        "lib/previous-map.js": "6c71474cc5c5842a1ecaef8c5994e1779d4f2ace7d8f847ad64d0bf4f5253ed0",
        "lib/processor.js": "94c2cd762b66b3e09b40a9956d347559d511756ea3a861cbdfa35206d29adaae",
        "lib/result.js": "7f2b27651b2fb5ac7f46adb6e6f928194b31af0c6b821225400d0ee762c94e0c",
        "lib/root.js": "66bf461dbd984702272d737e8dc86a254b0481ae7934162f4ce0b32d9a19ec76",
        "lib/rule.js": "682e8fef7327307047965c6563e942bf53cc3bebda24db7d3eb286ca1e6f8ef8",
        "lib/stringifier.js": "c29cb2393a49240b06b710a626120ce9097236e289adc9d876c5421f6e8b9fcb",
        "lib/stringify.js": "99229cdda200513f88f7fee46004d5c39c1492a73451509e66164d26dff34abc",
        "lib/symbols.js": "eb8ab8b9648d400ec3e8e37e75dc159734b97ba21137f12da11b4afc2547a1b4",
        "lib/terminal-highlight.js":
          "27f1eb6cc633f3947e053c96f16b1754bcffcda2742ecc9a1e11cc2a75d70d9b",
        "lib/tokenize.js": "ddb2f66772a7611e7dfd1e844f1245d3902af06f4a8ddbc42cd044b1ed5827a7",
        "lib/warn-once.js": "5683ff69eeb8e77373a4bd0e0b9da611c7575ee434ba3c458c0552ab4806464a",
        "lib/warning.js": "a969d1ec8a5025c028278ee037cc21c5c7b8129e80269ea3bd8d831a957474fa",
        "package.json": "a71f54047ac366234d90b856e28cc5420903e8d6cfce3cf2aff5437aebd5b3ea",
      },
    },
    {
      directory: "node_modules/rollup",
      name: "rollup",
      version: "4.21.0",
      memberCount: 27,
      contentDigest: "f3e0e629d7d1183dc4df76ba4dae8d0b3ea756d8128d2136f238a9aeeb9588c1",
      entryMembers: {
        "dist/es/getLogFilter.js":
          "261e1abd6c7bd93f484bca1b8f4a67aa700705050515b91911e5334b638be354",
        "dist/es/parseAst.js": "6db9e901ee917eeac5e229c6a294ce530472c28e0e96a87cb49df82f6c0aa7fe",
        "dist/es/rollup.js": "cddd9390b0f3b2b1764c66b40049d6f7ad654123c1df5304f9947c00b33e493b",
        "dist/getLogFilter.d.ts":
          "e7cbf7017d77efd5099e08d85bf58c7658f29edfce5ab0db8faccb86fe9736fa",
        "dist/getLogFilter.js": "ab417d3ba229f7407c0084d5134b1b2764760637ae52b5bd9af2690f15bfeb07",
        "dist/loadConfigFile.d.ts":
          "da9f07c6be066d7b02671ee64ac78bd56cd1a57d98f1ad6b2ef54f685ca146cf",
        "dist/loadConfigFile.js":
          "a50727433e0969e1c555fae0a5c9ecdb7d013acb38cb7ac331a7362b36e77cd8",
        "dist/parseAst.d.ts": "a660aa95476042d3fdcc1343cf6bb8fdf24772d31712b1db321c5a4dcc325434",
        "dist/parseAst.js": "30780a62e3370b54d3783e56be25f51846f4f3819f690cd557f60d70a6020c02",
        "dist/rollup.d.ts": "f5ed3fcde4f8e724ad213e1deddd8a52adaeca132025b613f32bfe7ace31f42b",
        "dist/rollup.js": "004a883caf53f4b142f137507bdc5cdac458ec12306a1d702b1bf76ec4066492",
        "package.json": "6d90e766786961064c739ad4f833b09e5c04b4794058ee0879acccf201108741",
      },
    },
    {
      directory: "node_modules/@babel/plugin-transform-react-jsx-self",
      name: "@babel/plugin-transform-react-jsx-self",
      version: "7.24.7",
      memberCount: 7,
      contentDigest: "b9f314b2d21a0271e9eda2ecd969f02b99cfba402d1eed95612c3b441a3a4fc3",
      entryMembers: {
        "lib/index.js": "f4d2524bb5e539203ae9922f6b062fbd714cf245dcba6385acaa3cb2710dd289",
        "package.json": "2fa0a26278aade78277df366702b021177fc715458425e716c64f14149d45ec7",
      },
    },
    {
      directory: "node_modules/@babel/plugin-transform-react-jsx-source",
      name: "@babel/plugin-transform-react-jsx-source",
      version: "7.24.7",
      memberCount: 7,
      contentDigest: "6089557607de8ea5ea806eddc482de002208bb9285b1cae3e22a52253f688937",
      entryMembers: {
        "lib/index.js": "65c40dad23037e22ec4e230591dc18009d41702d2961ece46578707f3d571bee",
        "package.json": "e0bfdd15a521db2901b435bb065192edf09d8e00517bfeb8248f57010f4b0cb5",
      },
    },
    {
      directory: "node_modules/@types/babel__core",
      name: "@types/babel__core",
      version: "7.20.5",
      memberCount: 4,
      contentDigest: "b9b86270545c99d5ec1dc3250199e482491ffee990470b14469949de1e4d7e3d",
      entryMembers: {
        "package.json": "0787d557e5f4f1dcd57b43e2ec1a6cb955e768801bab5cad3c5c36e2d13eca0b",
      },
    },
    {
      directory: "node_modules/react-refresh",
      name: "react-refresh",
      version: "0.14.2",
      memberCount: 9,
      contentDigest: "2f91bd7e09e4355bee09b55de7a7878615413fcfb113d21c0acca50686b5091b",
      entryMembers: {
        "babel.js": "2eeb0f89bc4fb254f0e151efa554c06e9a67a0a635d5d467eeea5c29087d99d0",
        "package.json": "89eb7d02f68ae365d50e40540ca0dcbb8dd1ea09c9e24f7f4efd8de378ee6b3d",
        "runtime.js": "58d113977af3da9756dfa9bfbc43d6dad974618d70d90b6034654527bbf2d89d",
      },
    },
    {
      directory: "node_modules/@esbuild/linux-x64",
      name: "@esbuild/linux-x64",
      version: "0.21.5",
      memberCount: 3,
      contentDigest: "f8a055ae15b863c8c0fa697c67086b9cee57c44889e2a909713b3529fc482c1b",
      entryMembers: {
        "bin/esbuild": "b567f467fdac92c606717c86ea5cd1d6c30145c616776c0f2ff5429ad48586ba",
        "package.json": "cfcc162c440e93cc43afbf1edc478f4fc286c6ad16b8b850f3adc3e045a27165",
      },
    },
    {
      directory: "node_modules/loose-envify",
      name: "loose-envify",
      version: "1.4.0",
      memberCount: 8,
      contentDigest: "ea733f47538ff49796d35b7cd5c71482dccede647007618c40265461bfc28769",
      entryMembers: {
        "index.js": "4f69358a355fe134166716d787d47e6f6ceb7edd6a4ed271e8cca6533d822441",
        "package.json": "8c2e27dae366396ced36fe0f7c6d35d71a1440fd8e82df5f2005a5297888a0d4",
      },
    },
    {
      directory: "node_modules/@ampproject/remapping",
      name: "@ampproject/remapping",
      version: "2.3.0",
      memberCount: 12,
      contentDigest: "62c76996b0ad8ae260ee93c1342e366608c0b38e188e11437a0a4111bb719850",
      entryMembers: {
        "dist/remapping.mjs": "9d9c8d4f592c4e7dabaf993ec546e054a5303491fb7e2b9de67cdb167defd00e",
        "dist/remapping.umd.js": "1b7ce6aa4e0b93113b5dc94ac32b65e3347bd85095fb3116dd60d5d982e00cf7",
        "dist/types/remapping.d.ts":
          "26d8b621bb763f18d6de5ae0e6ca6da5410139eea590f47568c6fbc7dde578b2",
        "package.json": "d7adce7c898a226d04cce02982864a724ba2a710efd5a0e42a3da49dcec84f5a",
      },
    },
    {
      directory: "node_modules/@babel/code-frame",
      name: "@babel/code-frame",
      version: "7.24.7",
      memberCount: 5,
      contentDigest: "2088b1e8419368346385c69c184245e12cfd7b9826ca195d5052586824bbf437",
      entryMembers: {
        "lib/index.js": "3e34c4f58701fdcbb1df636d3a76a723b7b8399d8806e46ca8cc3efbe45f78fb",
        "package.json": "74e5c2bb0d11b48dda056274236e778a7a246fff8070a667645a26ee5df00788",
      },
    },
    {
      directory: "node_modules/@babel/generator",
      name: "@babel/generator",
      version: "7.25.5",
      memberCount: 41,
      contentDigest: "81ce0dbe71fe5c178ac4a74835d3d715e964fc3bf83725f991101d5bc38ad21d",
      entryMembers: {
        "lib/index.js": "01662566c9ab03ed09c44757014b27d572a6d8887f87dc3f6eda88774458b0fc",
        "package.json": "fce531f634673ec80fce0abf103b19c8364179353bfe10c361e2717a9c14c6c2",
      },
    },
    {
      directory: "node_modules/@babel/helper-compilation-targets",
      name: "@babel/helper-compilation-targets",
      version: "7.25.2",
      memberCount: 17,
      contentDigest: "1641ef4291341eb7ba40eaae5b1677a0aa65e1e4206bfd1da0fa0cb72c4e1afc",
      entryMembers: {
        "lib/index.js": "b7f90e46559609e72ec0ffa1c737c081f97627c3d565b6687f14e051d2643a87",
        "package.json": "9b3836847e69f151344a3a0b478ac32384998e8798531d57e9f0493ccb9b49c5",
      },
    },
    {
      directory: "node_modules/@babel/helper-module-transforms",
      name: "@babel/helper-module-transforms",
      version: "7.25.2",
      memberCount: 17,
      contentDigest: "3b763be107362d7176fe3d2c0ed3812946a252120a024e407f673643cae56ad5",
      entryMembers: {
        "lib/index.js": "bfa826ee556002f16fe3fbab9e298125a76f358e36f98b1012ccdf048e7d3fe9",
        "package.json": "ab51332f5012c038e7b30b843f0dca540053b03b2f60f74b22c268cdc4b85666",
      },
    },
    {
      directory: "node_modules/@babel/helpers",
      name: "@babel/helpers",
      version: "7.25.0",
      memberCount: 238,
      contentDigest: "4e5f777f4e54f3e79880bc5112c727d3e05d637e3eb505068e58577e6410619e",
      entryMembers: {
        "lib/index.js": "6c24bb245b5097867f5dc28af7ed044b70b47fd157ebdd988cc9bf5186475de4",
        "package.json": "4ca38b52484c2884f3512e432989a99651b6de2dc8d2863fbf76d744e2eb0c3c",
      },
    },
    {
      directory: "node_modules/@babel/parser",
      name: "@babel/parser",
      version: "7.25.4",
      memberCount: 9,
      contentDigest: "485ee277b395a12807ed6bc3abd4f164d26aadda9afec5559ec2f7d32b61e0d5",
      entryMembers: {
        "lib/index.js": "068cb32ea07b635c23c8ab80fda71753111e5614e0f543abdc4d419f538b4fef",
        "package.json": "d153cd221664ae8416112c4e9414effffa0144d836ce88885ab13392172b7de7",
      },
    },
    {
      directory: "node_modules/@babel/template",
      name: "@babel/template",
      version: "7.25.0",
      memberCount: 19,
      contentDigest: "aaaa8a2ba0d22bc445ecbcdfc1a0952439d5df2126a10e302ce28c667d354949",
      entryMembers: {
        "lib/index.js": "afa3d50840abdd95e81d3e00dd8539c448b533767f899dcedf4dac776ddff9a7",
        "package.json": "a76a6ecbb5ec33417b1603145942859fb780828cfcb01e79dca7662a7df2793d",
      },
    },
    {
      directory: "node_modules/@babel/traverse",
      name: "@babel/traverse",
      version: "7.25.4",
      memberCount: 63,
      contentDigest: "537ddd9d4094698c05a6d8888d05856a99b67ac021aa957ec807cc0115881c0f",
      entryMembers: {
        "lib/index.js": "0c9375386b72b3a576a12d80450bbf6d3b9e24afbfbde1e302e2e5bc8b6bdebd",
        "package.json": "774e5dee2a493271769ea60f0f48be9855e147ebfe623ece21ecf9a94f21a4da",
      },
    },
    {
      directory: "node_modules/@babel/types",
      name: "@babel/types",
      version: "7.25.4",
      memberCount: 178,
      contentDigest: "fa4b08b91150eeb5ea001b5d0833ec866c34ff7f419e2c817df5d15bca4c3b85",
      entryMembers: {
        "lib/index.js": "ce57e8a5482ecc7178cc3037176bed0316437a0b6c3fa1ac5ac6c86a5c1ed7ac",
        "package.json": "dd2d27b0602a1d1a8b2e7f30fde9dce36747a580b98a2b654479f31e99b19f1f",
      },
    },
    {
      directory: "node_modules/convert-source-map",
      name: "convert-source-map",
      version: "2.0.0",
      memberCount: 4,
      contentDigest: "c4e50c477b85a2a90763fc3b6fe852fbaabe5983cc973d0218962a54ec320554",
      entryMembers: {
        "index.js": "a842755693061e7bd3124513ca21f6b69d389b5776cdfbe097d62f66dc1f59dc",
        "package.json": "e6bf802e6ee220d66321808ce3d619fbb85ff4d5729ea4f649bd65dfe9ee8956",
      },
    },
    {
      directory: "node_modules/debug",
      name: "debug",
      version: "4.4.0",
      memberCount: 7,
      contentDigest: "42a213376edef8d90ef19b64acff1225f0abba4742a0524b39893ab82bdb69ef",
      entryMembers: {
        "package.json": "47344a5e8738d8b35ca7bcf3fb4b71081442bd82e8ad9847d9bc3c46ccf4a0e8",
        "src/browser.js": "38082ec0dfcafc58df42f67a078d6589a77019d17ace6a33b7dab131fc786804",
        "src/index.js": "aa127ff1752b7d9c7415c5c7bb6994d9aa722b81bcbcab4bd48316b013d23bf3",
      },
    },
    {
      directory: "node_modules/gensync",
      name: "gensync",
      version: "1.0.0-beta.2",
      memberCount: 7,
      contentDigest: "96eadd3f23ca673a01428b715b7171992c35549f84d77f270ac9c5629357049f",
      entryMembers: {
        "index.js": "09e82a13eb50d14b42acdfd1db8fbde8f17e99527aa1bd5a489094e9a48a855a",
        "package.json": "80cddca71baa1ba0cf44f65585e1c1ed7576abdb759ed391007925c961ca6334",
      },
    },
    {
      directory: "node_modules/json5",
      name: "json5",
      version: "2.2.3",
      memberCount: 20,
      contentDigest: "fba0e0fed6db7a91bc41377725848d75889ef241f9b9c7e538621e861f620fe4",
      entryMembers: {
        "dist/index.js": "c3f094c550436757e955bc1e2619fa5624ae8f22f41a7587b95af1d14175800a",
        "dist/index.mjs": "12db0fd3eac76597c0f5aaef2e013d8267a235c773589effc36b1a8a80a1314d",
        "lib/index.js": "e7b7e397d488b168e08e867d599f2ea4ce8e64a65a94cb91bb26584df3234700",
        "package.json": "1927c4592e3811cf9b8c86e568df1c41a373b628b4b322f88872395ef87e2ba5",
      },
    },
    {
      directory: "node_modules/semver",
      name: "semver",
      version: "6.3.1",
      memberCount: 6,
      contentDigest: "685e6fd9cf69436dae84a74c1562878cf41cb757defac18e1e9650e37a75609e",
      entryMembers: {
        "package.json": "aa906c5bf8a2fa68683cae07d18553ae2538ed0d5a567911980b2ef25ee8b9ba",
        "semver.js": "d89ed53251e85463bf4300ae9a3e258dc75eb73eb2820d524bd05f4451bed3d4",
      },
    },
    {
      directory: "node_modules/@babel/helper-plugin-utils",
      name: "@babel/helper-plugin-utils",
      version: "7.24.8",
      memberCount: 7,
      contentDigest: "2e2d43a162395d489260f72c5fc4761562a58efbe9de9c048102ae28b7b2dbd3",
      entryMembers: {
        "lib/index.js": "f048bd0e738569ef3a5ca16d07d20e3e56d06ba87412b80d55899d5e0898eca4",
        "package.json": "5dc93511c75c718325df84c40bc8f0fd79702fe3e9b393eab0b863b8b4d472c9",
      },
    },
    {
      directory: "node_modules/@jridgewell/sourcemap-codec",
      name: "@jridgewell/sourcemap-codec",
      version: "1.5.0",
      memberCount: 11,
      contentDigest: "850bad9564d54575ce9cab9770f66409e5ff6173e0dc000763ab8017c2640119",
      entryMembers: {
        "dist/sourcemap-codec.mjs":
          "4b3e7fe51a527790cdda6f8c666820492efa868e1dd0f835e524b6219c433480",
        "dist/sourcemap-codec.umd.js":
          "60b14b2be0ad7477a7ee7bd477fc1a550406c78c882d00a6b760516d5485f06c",
        "dist/types/sourcemap-codec.d.ts":
          "61ca713f0c4b6df8a5542a25ac7c1be1a703dff84c3a7fa70ae27546652a8f50",
        "package.json": "38628913cb25421ffff1eb47b530c72d67fe95ebc1daf52f4df632c345fd928e",
      },
    },
    {
      directory: "node_modules/undici-types",
      name: "undici-types",
      version: "6.21.0",
      memberCount: 41,
      contentDigest: "9504d06c1cd5567e4c085ca8dacd1988873e14ca8555b10ac1e96a9189920963",
      entryMembers: {
        "package.json": "11f873b423b96a5ad444a099685ca6b9de1379dcd83fd8d368e757ddb53658e4",
      },
    },
    {
      directory: "node_modules/nanoid",
      name: "nanoid",
      version: "3.3.7",
      memberCount: 25,
      contentDigest: "a17b84ac5d3bc6054f8e94f438e03cb33212a2100fc9bfb3842139e4c914fe21",
      entryMembers: {
        "async/index.browser.js":
          "df218a44dca7a1a2f3896a550a99cfbd7346939dd1e01154024359621c878354",
        "async/index.cjs": "f5911ad498fcae995a2e7f14be65cbb5df7f94091545668e8589a4fc62690ea4",
        "async/index.js": "8f8317c6517081062acbbded96fbbfd4dc33ae7fc09e16d2cd3b53751ce91564",
        "async/package.json": "0e02b9178f3638eba65e96c8643f3bf08ea192dcef7faadaf3c38c50a829b301",
        "index.browser.js": "cc29dde422f382986f35a751904be190e59853c1999e799eb4c0a1df371dbc7c",
        "index.cjs": "208a883b4ab6623c5340fce09719eb9c3cef111002c36263fa80682a8924b473",
        "index.d.cts": "a45ee7555d019a67fbe092898d1aef0b1d02a9f6679ab84461ff515b4460d706",
        "index.d.ts": "a45ee7555d019a67fbe092898d1aef0b1d02a9f6679ab84461ff515b4460d706",
        "index.js": "75ae4ecb41d5dcc6b8f86bcf4e742c47064591afc484f79bad6c9d987476c157",
        "non-secure/index.cjs": "2796014ef9ecaf270255a7af7732625524fafbbde58f60d0644fb2cbc87822f6",
        "non-secure/index.js": "7bebb58e9418255e446d10e07e6dea07e44c36918a797f73cff0088a3058241e",
        "non-secure/package.json":
          "2f9b8c4bee9312538f388b49c13987f4565ac25d6756fabdbbb771d339945e3e",
        "package.json": "6c7afd152d2156d610d1e30be0eaacc60d07e7b9a5792e65124f5882e03761fe",
        "url-alphabet/index.cjs":
          "8dbf2866b07583890919c7e27777dce67152e57699ff2fbd3eea2b5b6fae69ef",
        "url-alphabet/index.js": "a277361f60c9aca95ef53695330e8a291e5be7e6a19e838641e6a139990960ee",
        "url-alphabet/package.json":
          "2f9b8c4bee9312538f388b49c13987f4565ac25d6756fabdbbb771d339945e3e",
      },
    },
    {
      directory: "node_modules/source-map-js",
      name: "source-map-js",
      version: "1.2.0",
      memberCount: 15,
      contentDigest: "3579ea946203ffd759b134a9b58ee200089fa5fffd5010b696dd43c196a4619b",
      entryMembers: {
        "package.json": "f4611475149c859c9d1cf95ce7f47a4bbb958da6244e6f1c3b60ad4fcd3a35de",
        "source-map.js": "dc098456c2d9ab90a4c0a17cca9be16665b9813df20906553a98b0088a157be7",
      },
    },
    {
      directory: "node_modules/@rollup/rollup-linux-x64-gnu",
      name: "@rollup/rollup-linux-x64-gnu",
      version: "4.21.0",
      memberCount: 3,
      contentDigest: "4688db50e75d469b2476cc1cf50d3218ce585720924605cdb9b1b396a304494e",
      entryMembers: {
        "package.json": "2f1e37f3aa66bd66bdaabe20cd0c333aeb34a9ab3a620705863e05f0e934039c",
        "rollup.linux-x64-gnu.node":
          "da5df734ffb0e40399ae88dad22539f7b53fcbc8ed613b66b46ea956b19a6337",
      },
    },
    {
      directory: "node_modules/@rollup/rollup-linux-x64-musl",
      name: "@rollup/rollup-linux-x64-musl",
      version: "4.21.0",
      memberCount: 3,
      contentDigest: "42fa8a6bd4c0ec64f873667e6d34a2d635c3a9132868020c573c7871043248a7",
      entryMembers: {
        "package.json": "6d4a14dcc595e0e0f930579f434453afcae032a3e12da401fa33d27003e242ad",
        "rollup.linux-x64-musl.node":
          "3b0dd024e4496474e32f28e378900bbad1cfe28f6f0e61ec57dd5c0c14853dc8",
      },
    },
    {
      directory: "node_modules/@types/estree",
      name: "@types/estree",
      version: "1.0.5",
      memberCount: 5,
      contentDigest: "0c13606fbcfbc3537ed3d2ec9c05a8be5a5ebf6af1655e75084adf0d09838d36",
      entryMembers: {
        "package.json": "314996fce25d5ada65752651aa1ef3350f902e48b9c79a817d88266ba6fb625b",
      },
    },
    {
      directory: "node_modules/@types/babel__generator",
      name: "@types/babel__generator",
      version: "7.6.8",
      memberCount: 4,
      contentDigest: "5b69dc2fd1baf262bba766c758132b7b9bbf00625251c43db041d18578768070",
      entryMembers: {
        "package.json": "fe87189bfb870750151d8cc150e9dbf54480760e64a6343556ed5a8f00637a34",
      },
    },
    {
      directory: "node_modules/@types/babel__template",
      name: "@types/babel__template",
      version: "7.4.4",
      memberCount: 4,
      contentDigest: "300f95eb39f7dee190bcefc6bbe0e305c1b55fa6db7e1f5370230cbfc19acf34",
      entryMembers: {
        "package.json": "51293405049986b206d68e5b08181710934be70a05ecbd5384adb4eabde2ab82",
      },
    },
    {
      directory: "node_modules/@types/babel__traverse",
      name: "@types/babel__traverse",
      version: "7.20.6",
      memberCount: 4,
      contentDigest: "a79343fa05ebc4093d83efd1ea8c547569c98a09e6a725eb0ce35b18357d47b1",
      entryMembers: {
        "package.json": "18581126a5434878eb054d51e53690b391e2a65d805bb20797a0fbff8e558cd5",
      },
    },
    {
      directory: "node_modules/js-tokens",
      name: "js-tokens",
      version: "4.0.0",
      memberCount: 5,
      contentDigest: "b887c93aa03e7c776093af465c5f86f9fd4e8a1a4c1b91787ed7497947cae5d1",
      entryMembers: {
        "index.js": "b6f81c0531fc09be2f8a26059a5cb9f47150e550471da0ace5705a26d3c6268e",
        "package.json": "47345931827b3e26db9fe690abb81f856a0d040cbca8af1e69711a64cd58ce0d",
      },
    },
    {
      directory: "node_modules/@jridgewell/gen-mapping",
      name: "@jridgewell/gen-mapping",
      version: "0.3.5",
      memberCount: 10,
      contentDigest: "2568b10c1bd618b8b72f473cabc3d1e1ea278154aaaef568da8547376d4a5a26",
      entryMembers: {
        "dist/gen-mapping.mjs": "dba3894e29841deb803eb07641f6f5bd320aa89677e40e1d88167cd9125f9129",
        "dist/gen-mapping.umd.js":
          "677d825596f4bbdb6c9619a0e1728ddd383a66d1b6ceaf187b86ef7f23a7c2ce",
        "dist/types/gen-mapping.d.ts":
          "5af161220fdf46730477706e8c431ccbd1b4ff50223cb32450bc20513f50bfbd",
        "package.json": "6841fac6da8fda27314a8cdb753f20dd8805d9eaee92c33da0cf956813fafe55",
      },
    },
    {
      directory: "node_modules/@jridgewell/trace-mapping",
      name: "@jridgewell/trace-mapping",
      version: "0.3.25",
      memberCount: 16,
      contentDigest: "a526a9e868d4568f53498dd62fba8ed14a0c1026163aadbfe634403d7fd316de",
      entryMembers: {
        "dist/trace-mapping.mjs":
          "ed3820073847b25137a1227b7341c8f3f93287b974f6b6f6c1f224b57d0615e1",
        "dist/trace-mapping.umd.js":
          "d13c79e91df2228ed2fe8e5723e2496d47401ef535a14b81daf5df54492e95f6",
        "dist/types/trace-mapping.d.ts":
          "0771a93ef5e3b2a29f929c20f7ad232829341a671c9d1e96e93ef3fc42ef7bc2",
        "package.json": "d091ff9a3597e7a8fd25559a5b61ca29b9def430c29a0b0b4d9b2d9cf9e92558",
      },
    },
    {
      directory: "node_modules/@babel/highlight",
      name: "@babel/highlight",
      version: "7.24.7",
      memberCount: 5,
      contentDigest: "840557d91ece7f5aab9c5ec4b4422d1f32dc75cefe1536141d8a0799f56fb722",
      entryMembers: {
        "lib/index.js": "bcdb8dd1683f97503c0e9635ae888de23aaba640a9648d2e9add1f1cc20b21cd",
        "package.json": "9bb8b1fa94ef9aa63f8e1ebadcb04aa8c4ab3afdb421465406e3f5d003cdc756",
      },
    },
    {
      directory: "node_modules/jsesc",
      name: "jsesc",
      version: "2.5.2",
      memberCount: 6,
      contentDigest: "8e59c46f430d98ca8d4fe1dd2778616695623f9c67b6e8c7ed057bf83c1baa8d",
      entryMembers: {
        "jsesc.js": "3bb36cebc942e39033dff79a0abcf2761ec6f5185446d040f12e9ff3ea90e232",
        "package.json": "5dabf36eedd9ebbabc59010b324cf7fb11f66a097ef62bcf35ba4d0c92a49f42",
      },
    },
    {
      directory: "node_modules/@babel/compat-data",
      name: "@babel/compat-data",
      version: "7.25.4",
      memberCount: 17,
      contentDigest: "74879b88d28e700ffa8f0ede39a7405c72e34c7ef431f3ce8ec1a8b7c3718dc5",
      entryMembers: {
        "corejs2-built-ins.js": "650aa556daf6e89ae6d19f03f97ed1f8e821df5202a6247f5276034d156eb40c",
        "corejs3-shipped-proposals.js":
          "7273863740420fc763944537a51b261e1ee30b5b8806e2096098301ffdbd1782",
        "native-modules.js": "94801856d800a4cf2fcc2f34b4276c589437ba6d5b4689d841add9144cee8fba",
        "overlapping-plugins.js":
          "0a05a93986f76440ba4bf1c3c75641b38d0e6d7a32b1eba1afc7de40bc43b995",
        "package.json": "f838dcd7318f247de417db645bf1781ff88fa46b1f3c40a35b9cfed47d71860f",
        "plugin-bugfixes.js": "3b2f275132f4cd2d68aa8c1e803ce7d11fedb65ad14f34b05866db962c809008",
        "plugins.js": "19d28ea7387125ca877a8ad54b4048e2101853f964857b4fc1c7c383f8295a00",
      },
    },
    {
      directory: "node_modules/@babel/helper-validator-option",
      name: "@babel/helper-validator-option",
      version: "7.24.8",
      memberCount: 9,
      contentDigest: "ffe453a2a10fe50b7e0c32523a4554f8f3d3ac2d8bc29a0750fbda4e69bfd54e",
      entryMembers: {
        "lib/index.js": "f88b48887e540ba645aee55b29dbfe810b9318a8b757748cddab83fc948e562b",
        "package.json": "670758018cbe6d35bc54f00df58386ea4b898387703857a2b9dbce0da77e6afd",
      },
    },
    {
      directory: "node_modules/browserslist",
      name: "browserslist",
      version: "4.23.3",
      memberCount: 11,
      contentDigest: "3ca52b8f571ad022b50aa4f73e626590618c7ecca70b4f36d99ed332d1be5818",
      entryMembers: {
        "index.js": "21e43a3094ed4d0d86fed85b2d0b49a6c6858a998d85e3690dd089d96f571c9b",
        "package.json": "195910d9b4b3f553943a0db4c98be4c979a3eaf5bb8458600c51a8ca993b32ff",
      },
    },
    {
      directory: "node_modules/lru-cache",
      name: "lru-cache",
      version: "5.1.1",
      memberCount: 4,
      contentDigest: "3293e93958b39d30174e57547713074437a051c4040cdbc30a280f1527ff7b5b",
      entryMembers: {
        "index.js": "f527d2386a6266b9bf67d264194948cf741b12daa19fea19e3537414ee31f9a7",
        "package.json": "f5a3379f52a453412f5d8551bf11fa0bef4316cc88645c9d190a017e1c58a4c2",
      },
    },
    {
      directory: "node_modules/@babel/helper-module-imports",
      name: "@babel/helper-module-imports",
      version: "7.24.7",
      memberCount: 11,
      contentDigest: "71ce28b3d1da3eda1d431740797586eedce8e3a6d77cd3434848f7f9fd96301a",
      entryMembers: {
        "lib/index.js": "233349c8482863c4bfd2656c940b0a3f22448c1420b2957bbdfc498c94dab87f",
        "package.json": "ce314dfd33d59df2282f7eafeba3ce8b2fad3d6c92a1f5f7786c508e7b59b4a5",
      },
    },
    {
      directory: "node_modules/@babel/helper-simple-access",
      name: "@babel/helper-simple-access",
      version: "7.24.7",
      memberCount: 5,
      contentDigest: "f3b18631a638789b51a0e8008e7386464e2be160e88cc04dcfa0600bb49f7c48",
      entryMembers: {
        "lib/index.js": "f30d9760f1deda4f3ec6c19a70703307a677c08d96a58d5dea4c51cc884ae805",
        "package.json": "ca37bb677ab542810b477ec90699ce7ed64ca0dc4faf67146aaadce5b340f1d4",
      },
    },
    {
      directory: "node_modules/@babel/helper-validator-identifier",
      name: "@babel/helper-validator-identifier",
      version: "7.24.7",
      memberCount: 10,
      contentDigest: "f8cbbfb42d9086fbcd34d1e279ecf570d1144a0d0208a9b1753921fd4ca80517",
      entryMembers: {
        "lib/index.js": "98df6c259dc29b4082858573ffd24930ca68a7bf531a10f48d856ae813b9acbb",
        "package.json": "1f38602f9b136717271df369e7c1a8f1a82e5dc002f9ed1efa6c4679758e7067",
      },
    },
    {
      directory: "node_modules/globals",
      name: "globals",
      version: "11.12.0",
      memberCount: 5,
      contentDigest: "9257c8553945abc3aa6d92e8833a8f011d318bed69a25e638aaa40c9a1869330",
      entryMembers: {
        "index.js": "2998fa25447dc5e0032334703ccec8604d66b750afb5b84e13eb778bf66fbb38",
        "package.json": "99f1a8f34aa467a7046e08bea3aff23bc9af096361c58a32a84b3b80df7a8133",
      },
    },
    {
      directory: "node_modules/@babel/helper-string-parser",
      name: "@babel/helper-string-parser",
      version: "7.24.8",
      memberCount: 5,
      contentDigest: "dbfc35a24fc9ed62eace253e7802994bfb54f82b87f4c41de795c2e3cef1fff4",
      entryMembers: {
        "lib/index.js": "c1b1b25a48d3b44710984b894db71f5e8c335ca52c35da43e73967c20cf18bfd",
        "package.json": "8dd28255988077262517bcdf6286c27e6291cdc550f03bfd60055b88c4e480d6",
      },
    },
    {
      directory: "node_modules/to-fast-properties",
      name: "to-fast-properties",
      version: "2.0.0",
      memberCount: 4,
      contentDigest: "1a936b9179c35cd21edc73beab40d1c39d2476b2c87ef7584e795409bb0f6acd",
      entryMembers: {
        "index.js": "b5366ea937d6371e6cff26b97c58a60bc6f49bb9d27c6f05dc4090d78526a82b",
        "package.json": "1452e03798d0f8d34c6a35ee05c61af8226f2a1565453a412ad05c5f19ee17e7",
      },
    },
    {
      directory: "node_modules/ms",
      name: "ms",
      version: "2.1.3",
      memberCount: 4,
      contentDigest: "61b7ca21b9644d48c20ce30cf4ebde3d96343417197a1de275c855a79893aed6",
      entryMembers: {
        "index.js": "e5f0b6a946a9b2b356a28557728410717df54ea2f599edb619f9839df6b7b0e9",
        "package.json": "1a6b4d9739790c0b94ab96c8cc0507e281c164c311ff4fbf5e57fb8d26290b40",
      },
    },
    {
      directory: "node_modules/@jridgewell/set-array",
      name: "@jridgewell/set-array",
      version: "1.2.1",
      memberCount: 8,
      contentDigest: "78a0e6cadf0abab54608b36bc7c845111b5e53cb236f6afb7a6944f2a41b03b5",
      entryMembers: {
        "dist/set-array.mjs": "39961f1de056663a3917c789bfb7f9e6b82be4dc52989b48669bd1b8cb90cfb3",
        "dist/set-array.umd.js": "ba8fa3f12db94ca3697be604bc5500e4a0b113d439323e63a9bff9de47e91288",
        "dist/types/set-array.d.ts":
          "7fd7bf1630aa73d8208cf51ef5efb503068c214b0d53147ee9b7d4e64330f1b1",
        "package.json": "e6322fcb32d5adc80ed8bc4b2f2fca0e8e49f74e1ce8d1078dd4b5db0efee1b0",
      },
    },
    {
      directory: "node_modules/@jridgewell/resolve-uri",
      name: "@jridgewell/resolve-uri",
      version: "3.1.2",
      memberCount: 8,
      contentDigest: "5cf3e8c4dbb76c21bab70ac9e81733693808723f4c66571335859d5f5cf0beca",
      entryMembers: {
        "dist/resolve-uri.mjs": "92bc7d86f012f0a1a38447512014d2decabeec0663bcebf49b95ca6081722b90",
        "dist/resolve-uri.umd.js":
          "2d46a62531a9ffa1e6e04995a94ae35d7a10869e2116132068a8755a15d46663",
        "dist/types/resolve-uri.d.ts":
          "36fa2acbe42db6888b14a1202a9922a2532fae87f795ecc294d0884ed84a582b",
        "package.json": "0793e722ffe08f3b4f1862c4dc96d920a62d6811a3648b4feb02f06c63227e8b",
      },
    },
    {
      directory: "node_modules/@babel/highlight/node_modules/chalk",
      name: "chalk",
      version: "2.4.2",
      memberCount: 7,
      contentDigest: "af98c34e8f1099c7c3b93cfcd01bc8d64bb53eb1bf9e2e93976f0728065e86c6",
      entryMembers: {
        "index.js": "28860645f073d2fad163a8ddcfef92ed17633df0c817361ae13350f71a22ecf7",
        "package.json": "80052c957e397ff669429ea957c2bdc792578c2178866f7a940c8eb975b5ca91",
      },
    },
    {
      directory: "node_modules/caniuse-lite",
      name: "caniuse-lite",
      version: "1.0.30001697",
      memberCount: 835,
      contentDigest: "81348735e37b80d2e5a51818021c15380225120ce33f8b173ce3cda2ac3f770a",
      entryMembers: {
        "dist/unpacker/index.js":
          "921391c922d90db5da7f6cfd6bdb0c80fc9b636876d8740a35e184a65ea91e14",
        "package.json": "7e71c2f32a1b1da1735369a24db359aea18f62c75b6ef6f9e58b482e7fa11261",
      },
    },
    {
      directory: "node_modules/electron-to-chromium",
      name: "electron-to-chromium",
      version: "1.5.13",
      memberCount: 12,
      contentDigest: "cbfbd4224794271720f56841fecb81dfa01fb4ed2a936146d6d02df093a931d8",
      entryMembers: {
        "index.js": "c07cbb083eece52acb542c34f8a8985743706fd5a42da5aa86817b640d7e3cc0",
        "package.json": "14efcbacaab9e83ec8591c702483784582da13b1ec2016306233b94a80e8196c",
      },
    },
    {
      directory: "node_modules/node-releases",
      name: "node-releases",
      version: "2.0.18",
      memberCount: 5,
      contentDigest: "c5877a93d6ed20de920cec80841ca32c80a1691e04e3f9e5bad3e7c14b036d68",
      entryMembers: {
        "package.json": "a446b1fb981a013a6e9a21097f417c259fd5b2a1c156f4e54662b53345242b0a",
      },
    },
    {
      directory: "node_modules/update-browserslist-db",
      name: "update-browserslist-db",
      version: "1.1.0",
      memberCount: 8,
      contentDigest: "8234a7a114fcbe12abd9e99e0785edb8a316fc97c967fbf6da627bb7c680c26a",
      entryMembers: {
        "index.js": "efcd360d5f9e31a9a5158377c1f773c4c59214eb335c7d8b4b9a558f40572ffa",
        "package.json": "fd6ff07af0c8cd69817e52e02f902c0edfaaa64d8fc91e52bd7bcfe05152413a",
      },
    },
    {
      directory: "node_modules/yallist",
      name: "yallist",
      version: "3.1.1",
      memberCount: 5,
      contentDigest: "7c692c3017f661e73d39f387bde30e55a069096c63cab9f82e0cd8f856f3d15b",
      entryMembers: {
        "package.json": "27699a6415a43f128c0e8ddcd5bf6e265f6cf3a581a9d959c11b977244fadc34",
        "yallist.js": "a2518b63469953a0fd13f3c738f50a1b2ce084374e9af0af7d7209ee1b0e8e55",
      },
    },
    {
      directory: "node_modules/ansi-styles",
      name: "ansi-styles",
      version: "3.2.1",
      memberCount: 4,
      contentDigest: "bbf787593953789d53b61629e64b08b040bb5a7ec68a3180a688bc61c431e21f",
      entryMembers: {
        "index.js": "c902228053a3a64c6e8f5a651f4d2a960f04fb6ae579f799287bd38007144d86",
        "package.json": "8a015c815240c949222d5f474721b5888dd9413fccbbd91ab552bac134317f76",
      },
    },
    {
      directory: "node_modules/escape-string-regexp",
      name: "escape-string-regexp",
      version: "1.0.5",
      memberCount: 4,
      contentDigest: "b09434cae01c4e76f3e92f9f0a506e4633c6e0750974be86a6a5dc971435f0f0",
      entryMembers: {
        "index.js": "02f3a564251a4aef9084ee33489aa4a6bbd6466c676998bd223af2c05ac8ef07",
        "package.json": "c804f228dd0d4d3b9019ac361339f20cbb1664d62d6853aaa7c2855fbd60fd12",
      },
    },
    {
      directory: "node_modules/supports-color",
      name: "supports-color",
      version: "5.5.0",
      memberCount: 5,
      contentDigest: "d61058a667ab5c496a0d73c195f3c370dec44b1f3a392ae23fdb26ac88ff5d43",
      entryMembers: {
        "browser.js": "03b3defae5a0801f91bc78f5f3ff2b13dec13df4cef4c0a94554b2d1183da1d1",
        "index.js": "2626aab9a13dc645b1746d6ff1c919b7d27adee60729825404f24e70d982acb3",
        "package.json": "34c434b27dc21bd0de7b5edca42fa0d9ebf72d2ac823c72865a334cb8fcfb9b5",
      },
    },
    {
      directory: "node_modules/escalade",
      name: "escalade",
      version: "3.1.2",
      memberCount: 9,
      contentDigest: "58f96702ec628c5b7bae446574d16f7a7097bd2c1ab7468f6a407712e475d486",
      entryMembers: {
        "dist/index.js": "85643e13de77213831aea57dac009638a9dea5baaa85a964c2592f602234db68",
        "dist/index.mjs": "436c778b45b4f46cf906bff4c38962219b349d5e42a2c62696c689417ab582a5",
        "index.d.ts": "1d0a2317852d21742a4b0b1783bfeffeaf8b0405eb2409a9e569f3182a7e123a",
        "package.json": "ffc8ef96d3130650b753ec0dd6b98a82707a243e6a43fb3399122fd461aa6e52",
        "sync/index.d.ts": "1226f59621d8b3482368119b53973c93f6968a3a09a458a0405b4322dff3d5a7",
        "sync/index.js": "bf89be2b8bb2eb86c19ce0a3598e19fe91ad689a64710607e6cbb3e15c076d4f",
        "sync/index.mjs": "8262677f39b0e4f3c085c04a38b66626913b980237da67496a4f8ebd8d1e5507",
      },
    },
    {
      directory: "node_modules/color-convert",
      name: "color-convert",
      version: "1.9.3",
      memberCount: 7,
      contentDigest: "34353904182469ba33bbf90f71ff96b0df793d397bfd0b1908db3b864bf101b3",
      entryMembers: {
        "index.js": "5aa98c1ffb6418e057a67b152123af31e8aff4c63e1e61058f9e66629c0133a4",
        "package.json": "b19880ef7c610484649d11309820cd55c8934ebc4bde0b37706e94483bf2bd0f",
      },
    },
    {
      directory: "node_modules/has-flag",
      name: "has-flag",
      version: "3.0.0",
      memberCount: 4,
      contentDigest: "b38b16a4b23c87de7fa3197e6b7a8c6680015e586d8b0b7be283edf33ef07db8",
      entryMembers: {
        "index.js": "dc0f89bdb136779f9ec062e0a2963a3ec89f45731eec9e8028907ae9f9e9034d",
        "package.json": "5f786f6d16a53e7171fda89adc83bbd9c07fc17fb9de7ea78431283972593984",
      },
    },
    {
      directory: "node_modules/color-name",
      name: "color-name",
      version: "1.1.3",
      memberCount: 7,
      contentDigest: "93d88b8d4463a03c05e7ab84be911020a5004214df7fe30abe473f9cfb86f92e",
      entryMembers: {
        "index.js": "97dabd7ebb70c33c19ccfa6956377fc722d9769924903f42a3bede30d83a8592",
        "package.json": "522669bd4c785d5c372377f5b139243f5fb6cf6335fc9df0e7c2d294b6b678da",
      },
    },
  ],
  edges: [
    {
      issuer: "node_modules/electron-vite",
      specifier: "@babel/core",
      target: "node_modules/@babel/core",
    },
    {
      issuer: "node_modules/electron-vite",
      specifier: "@babel/plugin-transform-arrow-functions",
      target: "node_modules/@babel/plugin-transform-arrow-functions",
    },
    {
      issuer: "node_modules/electron-vite",
      specifier: "cac",
      target: "node_modules/cac",
    },
    {
      issuer: "node_modules/electron-vite",
      specifier: "esbuild",
      target: "node_modules/esbuild",
    },
    {
      issuer: "node_modules/electron-vite",
      specifier: "magic-string",
      target: "node_modules/magic-string",
    },
    {
      issuer: "node_modules/electron-vite",
      specifier: "picocolors",
      target: "node_modules/picocolors",
    },
    {
      issuer: "node_modules/electron-vite",
      specifier: "vite",
      target: "node_modules/vite",
    },
    {
      issuer: "node_modules/vite",
      specifier: "@types/node",
      target: "node_modules/@types/node",
    },
    {
      issuer: "node_modules/vite",
      specifier: "esbuild",
      target: "node_modules/esbuild",
    },
    {
      issuer: "node_modules/vite",
      specifier: "postcss",
      target: "node_modules/postcss",
    },
    {
      issuer: "node_modules/vite",
      specifier: "rollup",
      target: "node_modules/rollup",
    },
    {
      issuer: "node_modules/@vitejs/plugin-react",
      specifier: "@babel/core",
      target: "node_modules/@babel/core",
    },
    {
      issuer: "node_modules/@vitejs/plugin-react",
      specifier: "@babel/plugin-transform-react-jsx-self",
      target: "node_modules/@babel/plugin-transform-react-jsx-self",
    },
    {
      issuer: "node_modules/@vitejs/plugin-react",
      specifier: "@babel/plugin-transform-react-jsx-source",
      target: "node_modules/@babel/plugin-transform-react-jsx-source",
    },
    {
      issuer: "node_modules/@vitejs/plugin-react",
      specifier: "@types/babel__core",
      target: "node_modules/@types/babel__core",
    },
    {
      issuer: "node_modules/@vitejs/plugin-react",
      specifier: "react-refresh",
      target: "node_modules/react-refresh",
    },
    {
      issuer: "node_modules/@vitejs/plugin-react",
      specifier: "vite",
      target: "node_modules/vite",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/linux-x64",
      target: "node_modules/@esbuild/linux-x64",
    },
    {
      issuer: "node_modules/react",
      specifier: "loose-envify",
      target: "node_modules/loose-envify",
    },
    {
      issuer: "node_modules/react-dom",
      specifier: "loose-envify",
      target: "node_modules/loose-envify",
    },
    {
      issuer: "node_modules/react-dom",
      specifier: "react",
      target: "node_modules/react",
    },
    {
      issuer: "node_modules/react-dom",
      specifier: "scheduler",
      target: "node_modules/scheduler",
    },
    {
      issuer: "node_modules/scheduler",
      specifier: "loose-envify",
      target: "node_modules/loose-envify",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "@ampproject/remapping",
      target: "node_modules/@ampproject/remapping",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "@babel/code-frame",
      target: "node_modules/@babel/code-frame",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "@babel/generator",
      target: "node_modules/@babel/generator",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "@babel/helper-compilation-targets",
      target: "node_modules/@babel/helper-compilation-targets",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "@babel/helper-module-transforms",
      target: "node_modules/@babel/helper-module-transforms",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "@babel/helpers",
      target: "node_modules/@babel/helpers",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "@babel/parser",
      target: "node_modules/@babel/parser",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "@babel/template",
      target: "node_modules/@babel/template",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "@babel/traverse",
      target: "node_modules/@babel/traverse",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "@babel/types",
      target: "node_modules/@babel/types",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "convert-source-map",
      target: "node_modules/convert-source-map",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "debug",
      target: "node_modules/debug",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "gensync",
      target: "node_modules/gensync",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "json5",
      target: "node_modules/json5",
    },
    {
      issuer: "node_modules/@babel/core",
      specifier: "semver",
      target: "node_modules/semver",
    },
    {
      issuer: "node_modules/@babel/plugin-transform-arrow-functions",
      specifier: "@babel/core",
      target: "node_modules/@babel/core",
    },
    {
      issuer: "node_modules/@babel/plugin-transform-arrow-functions",
      specifier: "@babel/helper-plugin-utils",
      target: "node_modules/@babel/helper-plugin-utils",
    },
    {
      issuer: "node_modules/magic-string",
      specifier: "@jridgewell/sourcemap-codec",
      target: "node_modules/@jridgewell/sourcemap-codec",
    },
    {
      issuer: "node_modules/@types/node",
      specifier: "undici-types",
      target: "node_modules/undici-types",
    },
    {
      issuer: "node_modules/postcss",
      specifier: "nanoid",
      target: "node_modules/nanoid",
    },
    {
      issuer: "node_modules/postcss",
      specifier: "picocolors",
      target: "node_modules/picocolors",
    },
    {
      issuer: "node_modules/postcss",
      specifier: "source-map-js",
      target: "node_modules/source-map-js",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-linux-x64-gnu",
      target: "node_modules/@rollup/rollup-linux-x64-gnu",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-linux-x64-musl",
      target: "node_modules/@rollup/rollup-linux-x64-musl",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@types/estree",
      target: "node_modules/@types/estree",
    },
    {
      issuer: "node_modules/@babel/plugin-transform-react-jsx-self",
      specifier: "@babel/core",
      target: "node_modules/@babel/core",
    },
    {
      issuer: "node_modules/@babel/plugin-transform-react-jsx-self",
      specifier: "@babel/helper-plugin-utils",
      target: "node_modules/@babel/helper-plugin-utils",
    },
    {
      issuer: "node_modules/@babel/plugin-transform-react-jsx-source",
      specifier: "@babel/core",
      target: "node_modules/@babel/core",
    },
    {
      issuer: "node_modules/@babel/plugin-transform-react-jsx-source",
      specifier: "@babel/helper-plugin-utils",
      target: "node_modules/@babel/helper-plugin-utils",
    },
    {
      issuer: "node_modules/@types/babel__core",
      specifier: "@babel/parser",
      target: "node_modules/@babel/parser",
    },
    {
      issuer: "node_modules/@types/babel__core",
      specifier: "@babel/types",
      target: "node_modules/@babel/types",
    },
    {
      issuer: "node_modules/@types/babel__core",
      specifier: "@types/babel__generator",
      target: "node_modules/@types/babel__generator",
    },
    {
      issuer: "node_modules/@types/babel__core",
      specifier: "@types/babel__template",
      target: "node_modules/@types/babel__template",
    },
    {
      issuer: "node_modules/@types/babel__core",
      specifier: "@types/babel__traverse",
      target: "node_modules/@types/babel__traverse",
    },
    {
      issuer: "node_modules/loose-envify",
      specifier: "js-tokens",
      target: "node_modules/js-tokens",
    },
    {
      issuer: "node_modules/@ampproject/remapping",
      specifier: "@jridgewell/gen-mapping",
      target: "node_modules/@jridgewell/gen-mapping",
    },
    {
      issuer: "node_modules/@ampproject/remapping",
      specifier: "@jridgewell/trace-mapping",
      target: "node_modules/@jridgewell/trace-mapping",
    },
    {
      issuer: "node_modules/@babel/code-frame",
      specifier: "@babel/highlight",
      target: "node_modules/@babel/highlight",
    },
    {
      issuer: "node_modules/@babel/code-frame",
      specifier: "picocolors",
      target: "node_modules/picocolors",
    },
    {
      issuer: "node_modules/@babel/generator",
      specifier: "@babel/types",
      target: "node_modules/@babel/types",
    },
    {
      issuer: "node_modules/@babel/generator",
      specifier: "@jridgewell/gen-mapping",
      target: "node_modules/@jridgewell/gen-mapping",
    },
    {
      issuer: "node_modules/@babel/generator",
      specifier: "@jridgewell/trace-mapping",
      target: "node_modules/@jridgewell/trace-mapping",
    },
    {
      issuer: "node_modules/@babel/generator",
      specifier: "jsesc",
      target: "node_modules/jsesc",
    },
    {
      issuer: "node_modules/@babel/helper-compilation-targets",
      specifier: "@babel/compat-data",
      target: "node_modules/@babel/compat-data",
    },
    {
      issuer: "node_modules/@babel/helper-compilation-targets",
      specifier: "@babel/helper-validator-option",
      target: "node_modules/@babel/helper-validator-option",
    },
    {
      issuer: "node_modules/@babel/helper-compilation-targets",
      specifier: "browserslist",
      target: "node_modules/browserslist",
    },
    {
      issuer: "node_modules/@babel/helper-compilation-targets",
      specifier: "lru-cache",
      target: "node_modules/lru-cache",
    },
    {
      issuer: "node_modules/@babel/helper-compilation-targets",
      specifier: "semver",
      target: "node_modules/semver",
    },
    {
      issuer: "node_modules/@babel/helper-module-transforms",
      specifier: "@babel/core",
      target: "node_modules/@babel/core",
    },
    {
      issuer: "node_modules/@babel/helper-module-transforms",
      specifier: "@babel/helper-module-imports",
      target: "node_modules/@babel/helper-module-imports",
    },
    {
      issuer: "node_modules/@babel/helper-module-transforms",
      specifier: "@babel/helper-simple-access",
      target: "node_modules/@babel/helper-simple-access",
    },
    {
      issuer: "node_modules/@babel/helper-module-transforms",
      specifier: "@babel/helper-validator-identifier",
      target: "node_modules/@babel/helper-validator-identifier",
    },
    {
      issuer: "node_modules/@babel/helper-module-transforms",
      specifier: "@babel/traverse",
      target: "node_modules/@babel/traverse",
    },
    {
      issuer: "node_modules/@babel/helpers",
      specifier: "@babel/template",
      target: "node_modules/@babel/template",
    },
    {
      issuer: "node_modules/@babel/helpers",
      specifier: "@babel/types",
      target: "node_modules/@babel/types",
    },
    {
      issuer: "node_modules/@babel/parser",
      specifier: "@babel/types",
      target: "node_modules/@babel/types",
    },
    {
      issuer: "node_modules/@babel/template",
      specifier: "@babel/code-frame",
      target: "node_modules/@babel/code-frame",
    },
    {
      issuer: "node_modules/@babel/template",
      specifier: "@babel/parser",
      target: "node_modules/@babel/parser",
    },
    {
      issuer: "node_modules/@babel/template",
      specifier: "@babel/types",
      target: "node_modules/@babel/types",
    },
    {
      issuer: "node_modules/@babel/traverse",
      specifier: "@babel/code-frame",
      target: "node_modules/@babel/code-frame",
    },
    {
      issuer: "node_modules/@babel/traverse",
      specifier: "@babel/generator",
      target: "node_modules/@babel/generator",
    },
    {
      issuer: "node_modules/@babel/traverse",
      specifier: "@babel/parser",
      target: "node_modules/@babel/parser",
    },
    {
      issuer: "node_modules/@babel/traverse",
      specifier: "@babel/template",
      target: "node_modules/@babel/template",
    },
    {
      issuer: "node_modules/@babel/traverse",
      specifier: "@babel/types",
      target: "node_modules/@babel/types",
    },
    {
      issuer: "node_modules/@babel/traverse",
      specifier: "debug",
      target: "node_modules/debug",
    },
    {
      issuer: "node_modules/@babel/traverse",
      specifier: "globals",
      target: "node_modules/globals",
    },
    {
      issuer: "node_modules/@babel/types",
      specifier: "@babel/helper-string-parser",
      target: "node_modules/@babel/helper-string-parser",
    },
    {
      issuer: "node_modules/@babel/types",
      specifier: "@babel/helper-validator-identifier",
      target: "node_modules/@babel/helper-validator-identifier",
    },
    {
      issuer: "node_modules/@babel/types",
      specifier: "to-fast-properties",
      target: "node_modules/to-fast-properties",
    },
    {
      issuer: "node_modules/debug",
      specifier: "ms",
      target: "node_modules/ms",
    },
    {
      issuer: "node_modules/@types/babel__generator",
      specifier: "@babel/types",
      target: "node_modules/@babel/types",
    },
    {
      issuer: "node_modules/@types/babel__template",
      specifier: "@babel/parser",
      target: "node_modules/@babel/parser",
    },
    {
      issuer: "node_modules/@types/babel__template",
      specifier: "@babel/types",
      target: "node_modules/@babel/types",
    },
    {
      issuer: "node_modules/@types/babel__traverse",
      specifier: "@babel/types",
      target: "node_modules/@babel/types",
    },
    {
      issuer: "node_modules/@jridgewell/gen-mapping",
      specifier: "@jridgewell/set-array",
      target: "node_modules/@jridgewell/set-array",
    },
    {
      issuer: "node_modules/@jridgewell/gen-mapping",
      specifier: "@jridgewell/sourcemap-codec",
      target: "node_modules/@jridgewell/sourcemap-codec",
    },
    {
      issuer: "node_modules/@jridgewell/gen-mapping",
      specifier: "@jridgewell/trace-mapping",
      target: "node_modules/@jridgewell/trace-mapping",
    },
    {
      issuer: "node_modules/@jridgewell/trace-mapping",
      specifier: "@jridgewell/resolve-uri",
      target: "node_modules/@jridgewell/resolve-uri",
    },
    {
      issuer: "node_modules/@jridgewell/trace-mapping",
      specifier: "@jridgewell/sourcemap-codec",
      target: "node_modules/@jridgewell/sourcemap-codec",
    },
    {
      issuer: "node_modules/@babel/highlight",
      specifier: "@babel/helper-validator-identifier",
      target: "node_modules/@babel/helper-validator-identifier",
    },
    {
      issuer: "node_modules/@babel/highlight",
      specifier: "chalk",
      target: "node_modules/@babel/highlight/node_modules/chalk",
    },
    {
      issuer: "node_modules/@babel/highlight",
      specifier: "js-tokens",
      target: "node_modules/js-tokens",
    },
    {
      issuer: "node_modules/@babel/highlight",
      specifier: "picocolors",
      target: "node_modules/picocolors",
    },
    {
      issuer: "node_modules/browserslist",
      specifier: "caniuse-lite",
      target: "node_modules/caniuse-lite",
    },
    {
      issuer: "node_modules/browserslist",
      specifier: "electron-to-chromium",
      target: "node_modules/electron-to-chromium",
    },
    {
      issuer: "node_modules/browserslist",
      specifier: "node-releases",
      target: "node_modules/node-releases",
    },
    {
      issuer: "node_modules/browserslist",
      specifier: "update-browserslist-db",
      target: "node_modules/update-browserslist-db",
    },
    {
      issuer: "node_modules/lru-cache",
      specifier: "yallist",
      target: "node_modules/yallist",
    },
    {
      issuer: "node_modules/@babel/helper-module-imports",
      specifier: "@babel/traverse",
      target: "node_modules/@babel/traverse",
    },
    {
      issuer: "node_modules/@babel/helper-module-imports",
      specifier: "@babel/types",
      target: "node_modules/@babel/types",
    },
    {
      issuer: "node_modules/@babel/helper-simple-access",
      specifier: "@babel/traverse",
      target: "node_modules/@babel/traverse",
    },
    {
      issuer: "node_modules/@babel/helper-simple-access",
      specifier: "@babel/types",
      target: "node_modules/@babel/types",
    },
    {
      issuer: "node_modules/@babel/highlight/node_modules/chalk",
      specifier: "ansi-styles",
      target: "node_modules/ansi-styles",
    },
    {
      issuer: "node_modules/@babel/highlight/node_modules/chalk",
      specifier: "escape-string-regexp",
      target: "node_modules/escape-string-regexp",
    },
    {
      issuer: "node_modules/@babel/highlight/node_modules/chalk",
      specifier: "supports-color",
      target: "node_modules/supports-color",
    },
    {
      issuer: "node_modules/update-browserslist-db",
      specifier: "browserslist",
      target: "node_modules/browserslist",
    },
    {
      issuer: "node_modules/update-browserslist-db",
      specifier: "escalade",
      target: "node_modules/escalade",
    },
    {
      issuer: "node_modules/update-browserslist-db",
      specifier: "picocolors",
      target: "node_modules/picocolors",
    },
    {
      issuer: "node_modules/ansi-styles",
      specifier: "color-convert",
      target: "node_modules/color-convert",
    },
    {
      issuer: "node_modules/supports-color",
      specifier: "has-flag",
      target: "node_modules/has-flag",
    },
    {
      issuer: "node_modules/color-convert",
      specifier: "color-name",
      target: "node_modules/color-name",
    },
  ],
  missing: [
    {
      issuer: "node_modules/electron-vite",
      specifier: "@swc/core",
    },
    {
      issuer: "node_modules/vite",
      specifier: "fsevents",
    },
    {
      issuer: "node_modules/vite",
      specifier: "less",
    },
    {
      issuer: "node_modules/vite",
      specifier: "lightningcss",
    },
    {
      issuer: "node_modules/vite",
      specifier: "sass",
    },
    {
      issuer: "node_modules/vite",
      specifier: "sass-embedded",
    },
    {
      issuer: "node_modules/vite",
      specifier: "stylus",
    },
    {
      issuer: "node_modules/vite",
      specifier: "sugarss",
    },
    {
      issuer: "node_modules/vite",
      specifier: "terser",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/aix-ppc64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/android-arm",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/android-arm64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/android-x64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/darwin-arm64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/darwin-x64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/freebsd-arm64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/freebsd-x64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/linux-arm",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/linux-arm64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/linux-ia32",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/linux-loong64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/linux-mips64el",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/linux-ppc64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/linux-riscv64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/linux-s390x",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/netbsd-x64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/openbsd-x64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/sunos-x64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/win32-arm64",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/win32-ia32",
    },
    {
      issuer: "node_modules/esbuild",
      specifier: "@esbuild/win32-x64",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-android-arm-eabi",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-android-arm64",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-darwin-arm64",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-darwin-x64",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-linux-arm-gnueabihf",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-linux-arm-musleabihf",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-linux-arm64-gnu",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-linux-arm64-musl",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-linux-powerpc64le-gnu",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-linux-riscv64-gnu",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-linux-s390x-gnu",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-win32-arm64-msvc",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-win32-ia32-msvc",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "@rollup/rollup-win32-x64-msvc",
    },
    {
      issuer: "node_modules/rollup",
      specifier: "fsevents",
    },
  ],
};
