import type { StockPackageContract } from "./resolve-stock-physical-entry.js";

// Regular Vite and stylesheet package members verified against full lock SRI archives.
export const STOCK_VITE6_CSS_PACKAGES = {
  autoprefixer: {
    files: {
      "lib/autoprefixer.js": "94b40b643ca1f428e16f4f361db7daf275e550bfc508641a5c855a0d992fd781",
      "package.json": "39c01e338d38a21dc48946118e61415d915b91610c72f550e57b528e23e50836",
    },
    packageName: "autoprefixer",
    version: "10.4.21",
  },
  katex: {
    files: {
      "dist/katex.min.css": "23aefa0850248a16478b9f55d6b67028f74cc0b46b82b24dc22af068acaa4170",
      "package.json": "adb989dccd15378fa9e9e74b2fe87ce73e2ea5a0cdae035f1f39c46d49f7abbb",
    },
    packageName: "katex",
    version: "0.16.45",
  },
  lightgallery: {
    files: {
      "css/lg-autoplay.css": "49b21d33da86a24febf47b7e3d21c0c437cfb0b18e120aadd0f4f8b1d3d5f0d6",
      "css/lg-thumbnail.css": "877d8a7ed119bb9ae83a5ddd4d29355f525ab852c31949f0cffe8d5448e4b691",
      "css/lightgallery.css": "f1aba3d59ded2dd46c593e7203173c0d1d8eb9e73c35f558f0616a98654d7b7d",
      "package.json": "b3c8b090b2d3226849009fcb1ef0b3f819c2cbe58a8b31a9be4862af86cb4703",
    },
    packageName: "lightgallery",
    version: "2.8.3",
  },
  postcss: {
    files: {
      "lib/postcss.js": "8314c843f5dfa922e6f3fb9b8d8bf3e4b0be0d94b08075e1b4f3599f4276fb67",
      "lib/postcss.mjs": "986ebc2d661a3e93b6e026dd2e1925e18167efdcc963f4043a65e1859974664f",
      "package.json": "b4f5c8dcbd8b0cddfdf1ce0cbcedce7c399ba0f6843eab794f066d6412aa59e0",
    },
    packageName: "postcss",
    version: "8.5.10",
  },
  sass: {
    files: {
      "package.json": "5ff099fc32683054ef3fe4b79cc1056c26b765f1d1e6aa9089deb9d4eb6b20db",
      "sass.dart.js": "172f1210b73a8d52cf8b9ef5d32bfde2d28d3487cd468272cec4ffe9ad709e5c",
      "sass.default.js": "e83acfd805a0ccc3f48bd32a006280ffad4d6fd1ab3f9290a873f59c005c2fa0",
      "sass.node.js": "eb7a01ba57a04a0a421bdef0bf2f43558af4790b540a45501ec83900b07b0625",
      "sass.node.mjs": "45c68fef99d4c4ce5bffc14a48297a386b115ac056264e739dce3fdc0ad13f53",
    },
    packageName: "sass",
    version: "1.89.0",
  },
  tailwindcss: {
    files: {
      "lib/index.js": "277a58612ffb9c7577d0a6155448c8dc2c7dfa82a90a5b972726b364b4e7bea0",
      "lib/lib/findAtConfigPath.js":
        "14aaef73793cb6599bd5be2b982556774044da5c6c3648e41c308dbc3679fb25",
      "lib/lib/load-config.js": "16f9597c1bd4d9aab878522e4c9025b7b20b729109791fdad085884e8ec8c2d0",
      "lib/lib/setupTrackingContext.js":
        "1b74ae936c3673a157d3289a745b1d89ca424c2b74649c46e7d600dc490ead72",
      "lib/plugin.js": "8285235d07316ddca06b1c1095089381498f3c10fa73a68d3cc6b696ba6386d1",
      "lib/public/create-plugin.js":
        "378f5fc94618693c544d46207b577435e7d1f6fe74999f6c69754c9148730b97",
      "lib/util/resolveConfigPath.js":
        "b58690a4f1f552309a08aca8ff4c4d4e71360475509c47aa75f7c224a7ab5e4c",
      "package.json": "56330837214a14ffcf0faba46f0f94fb23209778f5d4cc0a2bed7d775108c8d1",
      "plugin.js": "5177c010adcd2b44bc2926f6d588f2daa6034012c3441792d0930f3de9686b21",
    },
    packageName: "tailwindcss",
    version: "3.4.17",
  },
  "tailwindcss-animate": {
    files: {
      "index.js": "7a9d260ebbd42f6ac75a515de818789b5d42896876bdace6a23e476477c5503a",
      "package.json": "a6a9ae2d3731891b7d005a7baf235db24fa9ce6c56a6da1cda4a953ea131bb69",
    },
    packageName: "tailwindcss-animate",
    version: "1.0.7",
  },
  "tw-animate-css": {
    files: {
      "dist/tw-animate.css": "62002ffb597499dd190d4bc51beaa3dc1bc46d9b1123130681ed5911e85f9612",
      "package.json": "0ce6c710073ef824540a47dcaa41eddab8bd4cf0e001e3937ed1ef5aed8e48c5",
    },
    packageName: "tw-animate-css",
    version: "1.3.0",
  },
  vite: {
    files: {
      "bin/vite.js": "8498a58e0d311572c409038515df0e5d707bdc6ab5927153f487e36ef1c9052c",
      "dist/node/chunks/dep-4-IQbZQm.js":
        "fcc9c6abb31f94cf301361f54bff07ffa66f740afbf6c2bd2d5b3e03773df545",
      "dist/node/chunks/dep-Dq2t6Dq0.js":
        "62b768c2485cef903e0b4e93f31b4183fc741ee27c12784808ec0551d28a1df3",
      "dist/node/constants.js": "58c1d17e5f8118fe278a620a1ca11bc2554d3c7fb899ac9d13ffeb5a15279e17",
      "dist/node/index.js": "225ea4f7ef4d520adecac29001ccd80d433156347fd10cab31cb569362351aac",
      "package.json": "5fc282b9be55507e1f487bbf0bc6d7621728c41ab1325c8111b353e4fe043a62",
    },
    packageName: "vite",
    version: "6.4.2",
  },
} satisfies Readonly<Record<string, StockPackageContract>>;
