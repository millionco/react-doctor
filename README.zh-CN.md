<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/react-doctor-readme-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/react-doctor-readme-logo-light.svg">
  <img alt="React Doctor" src="./assets/react-doctor-readme-logo-light.svg" width="180" height="40">
</picture>

[![version](https://img.shields.io/npm/v/react-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)
[![downloads](https://img.shields.io/npm/dt/react-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)

[English](./README.md) | 简体中文

你的 AI 编程助手写出来的 React 代码很烂,这个工具能把问题揪出来。

一条命令扫完整个代码库,给你一个 **0 到 100 的健康分**,以及一份可操作的诊断清单。

支持 Next.js、Vite 和 React Native。

### [在线演示 →](https://react.doctor)

## 安装

在你的项目根目录下运行:

```bash
npx -y react-doctor@latest .
```

你会得到一个分数(75 以上 优秀,50 到 74 需改进,50 以下 严重),以及一份按 state 与副作用、性能、架构、安全、无障碍、死代码归类的问题清单。规则会根据你使用的框架和 React 版本自动启用或禁用。

https://github.com/user-attachments/assets/07cc88d9-9589-44c3-aa73-5d603cb1c570

## 接入你的 AI 编程助手

教你的 AI 编程助手 React 最佳实践,让它从源头就别再写烂代码。

```bash
npx -y react-doctor@latest install
```

命令会让你选择要为哪些已识别到的 agent 安装。加 `--yes` 可跳过交互。

兼容 Claude Code、Cursor、Codex、OpenCode 以及其他 50+ 种 agent。

## GitHub Actions

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0 # --diff 模式必须
- uses: millionco/react-doctor@main
  with:
    diff: main
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

在 `pull_request` 事件中如果传入了 `github-token`,扫描结果会作为 PR 评论自动发出来。Action 同时输出一个 `score`(0 到 100),你可以在后续步骤里用。

## 配置

在项目根目录下创建一个 `react-doctor.config.json`:

```json
{
  "ignore": {
    "rules": ["react/no-danger", "jsx-a11y/no-autofocus"],
    "files": ["src/generated/**"],
    "overrides": [
      {
        "files": ["components/diff/**"],
        "rules": ["react-doctor/no-array-index-as-key"]
      }
    ]
  }
}
```

`ignore.rules` 会在所有文件里关闭对应规则。`ignore.files` 会让匹配到的文件免受所有规则检查。`ignore.overrides` 用来在指定目录里只关闭某几条规则。你也可以在 `package.json` 里使用 `"reactDoctor"` 这个 key。命令行参数始终优先于配置文件。

React Doctor 会遵守 `.gitignore`、`.eslintignore`、`.oxlintignore`、`.prettierignore`,以及 `.gitattributes` 中的 `linguist-vendored` / `linguist-generated` 标注。代码里行内的 `// eslint-disable*` 和 `// oxlint-disable*` 注释也会被尊重。

如果项目里有 JSON 格式的 oxlint 或 eslint 配置(`.oxlintrc.json` 或 `.eslintrc.json`),其中的规则会被自动合并进扫描,也会计入分数。设置 `adoptExistingLintConfig: false` 可以关闭这一行为。

### 行内禁用

```tsx
// react-doctor-disable-next-line react-doctor/no-cascading-set-state
useEffect(() => {
  setA(value);
  setB(value);
}, [value]);
```

如果同一行触发了两条规则,在一个注释里用逗号分隔规则 id 即可。块注释也可以写在 JSX 内部:

<!-- prettier-ignore -->
```tsx
{/* react-doctor-disable-next-line react/no-danger */}
<div dangerouslySetInnerHTML={{ __html }} />
```

对于多行 JSX,把注释放在开标签的正上方就能覆盖整段属性列表(和 ESLint 的惯例一致)。

## 单独使用 Lint 插件

同一套规则同时以 oxlint 插件和 ESLint 插件的形式发布,所以你可以接到项目现有的任意一种 lint 引擎里。

**oxlint** 在 `.oxlintrc.json` 里:

```jsonc
{
  "jsPlugins": [{ "name": "react-doctor", "specifier": "react-doctor/oxlint-plugin" }],
  "rules": {
    "react-doctor/no-fetch-in-effect": "warn",
    "react-doctor/no-derived-state-effect": "warn",
  },
}
```

**ESLint** flat config:

```js
import reactDoctor from "react-doctor/eslint-plugin";

export default [
  reactDoctor.configs.recommended,
  reactDoctor.configs.next,
  reactDoctor.configs["react-native"],
  reactDoctor.configs["tanstack-start"],
  reactDoctor.configs["tanstack-query"],
];
```

完整的规则列表在 [`oxlint-config.ts`](https://github.com/millionco/react-doctor/blob/main/packages/react-doctor/src/oxlint-config.ts)。

## CLI 参数

```
Usage: react-doctor [directory] [options]

Options:
  -v, --version           display the version number
  --no-lint               skip linting
  --no-dead-code          skip dead code detection
  --verbose               show every rule and per-file details (default shows top 3 rules)
  --score                 output only the score
  --json                  output a single structured JSON report
  -y, --yes               skip prompts, scan all workspace projects
  --full                  skip prompts, always run a full scan
  --project <name>        select workspace project (comma-separated for multiple)
  --diff [base]           scan only files changed vs base branch
  --staged                scan only staged files (for pre-commit hooks)
  --offline               skip telemetry
  --fail-on <level>       exit with error on diagnostics: error, warning, none
  --annotations           output diagnostics as GitHub Actions annotations
  --explain <file:line>   diagnose why a rule fired or why a suppression didn't apply
  -h, --help              display help
```

当行内禁用没生效时,`--explain <file:line>` 会告诉你扫描器在那一位置看到的内容,以及为什么附近的 `react-doctor-disable-next-line` 没有命中。同样的提示在 `--verbose` 模式下会随诊断一起显示,在 `--json` 输出里则以 `diagnostic.suppressionHint` 字段呈现。

`--json` 会在 stdout 输出一个可解析的对象,并抑制所有给人看的输出。即便发生错误,也会输出一个带 `ok: false` 的 JSON 对象,所以 stdout 永远是一份合法文档。

### 配置项

| Key                        | Type                             | Default  |
| -------------------------- | -------------------------------- | -------- |
| `ignore.rules`             | `string[]`                       | `[]`     |
| `ignore.files`             | `string[]`                       | `[]`     |
| `ignore.overrides`         | `{ files, rules? }[]`            | `[]`     |
| `lint`                     | `boolean`                        | `true`   |
| `deadCode`                 | `boolean`                        | `true`   |
| `verbose`                  | `boolean`                        | `false`  |
| `diff`                     | `boolean \| string`              |          |
| `failOn`                   | `"error" \| "warning" \| "none"` | `"none"` |
| `customRulesOnly`          | `boolean`                        | `false`  |
| `share`                    | `boolean`                        | `true`   |
| `textComponents`           | `string[]`                       | `[]`     |
| `rawTextWrapperComponents` | `string[]`                       | `[]`     |
| `respectInlineDisables`    | `boolean`                        | `true`   |
| `adoptExistingLintConfig`  | `boolean`                        | `true`   |

`textComponents` 是 `rn-no-raw-text` 规则的"广义豁免口"——把那些自身行为类似于 React Native `<Text>` 的组件(比如自定义的 `Typography`、`NativeTabs.Trigger.Label` 等)列上去,规则会一律把它们当作文本容器处理,不管它们的 children 长什么样。

`rawTextWrapperComponents` 是更窄的豁免口,适用于那些本身不是文本元素、但内部安全地把字符串 children 转交给 `<Text>` 渲染的组件(比如 `heroui-native` 的 `Button`,它会把 children 字符串化后通过一个 `ButtonLabel` 渲染)。列入 `rawTextWrapperComponents` 的组件,只在 children 完全可字符串化时才会抑制 `rn-no-raw-text`。如果一个 wrapper 包含混合 children——比如 `<Button>Save<Icon /></Button>`——还是会报警,因为它没办法把原始文本和兄弟 JSX 元素安全地一并路由。

## Node.js API

```js
import { diagnose, toJsonReport, summarizeDiagnostics } from "react-doctor/api";

const result = await diagnose("./path/to/your/react-project");

console.log(result.score); // { score: 82, label: "Great" } 或 null
console.log(result.diagnostics); // Diagnostic[]
console.log(result.project); // 检测到的框架、React 版本等
```

`diagnose` 接受第二个参数:`{ lint?: boolean, deadCode?: boolean }`。

```js
const report = toJsonReport(result, { version: "1.0.0" });
const counts = summarizeDiagnostics(result.diagnostics);
```

`react-doctor/api` 还导出了 `JsonReport`、`JsonReportSummary`、`JsonReportProjectEntry`、`JsonReportMode`,以及更底层的 `buildJsonReport` 与 `buildJsonReportError` 构造器。完整类型见 [`packages/react-doctor/src/api.ts`](https://github.com/millionco/react-doctor/blob/main/packages/react-doctor/src/api.ts)。

## 排行榜

被 React Doctor 扫描过的头部 React 代码库,按分数排序。数据从 [millionco/react-doctor-benchmarks](https://github.com/millionco/react-doctor-benchmarks) 自动同步。

<!-- LEADERBOARD:START -->
<!-- prettier-ignore -->
| #  | Repo | Score |
| -- | ---- | ----: |
| 1  | [executor](https://github.com/RhysSullivan/executor) | 96 |
| 2  | [nodejs.org](https://github.com/nodejs/nodejs.org) | 86 |
| 3  | [tldraw](https://github.com/tldraw/tldraw) | 70 |
| 4  | [t3code](https://github.com/pingdotgg/t3code) | 68 |
| 5  | [better-auth](https://github.com/better-auth/better-auth) | 64 |
| 6  | [excalidraw](https://github.com/excalidraw/excalidraw) | 63 |
| 7  | [mastra](https://github.com/mastra-ai/mastra) | 63 |
| 8  | [payload](https://github.com/payloadcms/payload) | 60 |
| 9  | [typebot](https://github.com/baptisteArno/typebot.io) | 57 |
| 10 | [plane](https://github.com/makeplane/plane) | 56 |

<!-- LEADERBOARD:END -->

完整榜单见 [leaderboard 页面](https://www.react.doctor/leaderboard)。

## 资源 & 参与贡献

想先试试? 看 [在线演示](https://react.doctor)。

想参与贡献? clone 仓库,装依赖、build,然后提 PR:

```bash
git clone https://github.com/millionco/react-doctor
cd react-doctor
pnpm install
pnpm build
node packages/react-doctor/bin/react-doctor.js /path/to/your/react-project
```

发现 bug? 去 [issue tracker](https://github.com/millionco/react-doctor/issues) 提一个。

### 协议

React Doctor 以 MIT 协议开源。
