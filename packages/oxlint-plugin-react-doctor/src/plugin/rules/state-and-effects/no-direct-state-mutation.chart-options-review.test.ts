import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

const cases = [
  {
    name: "chart-interface-before",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    interface Chart { readonly brand: string }\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        framework: "unknown",
        reactVersion: "19.0.0",
        reactMajorVersion: 19,
        preactVersion: null,
        preactMajorVersion: null,
        hasReactNativeWorkspace: false,
        hasReactCompiler: false,
      },
    },
  },
  {
    name: "chart-type-alias",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    type Chart = { readonly brand: string };\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        framework: "unknown",
        reactVersion: "19.0.0",
        reactMajorVersion: 19,
        preactVersion: null,
        preactMajorVersion: null,
        hasReactNativeWorkspace: false,
        hasReactCompiler: false,
      },
    },
  },
  {
    name: "chart-interface-after",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    interface Chart { readonly brand: string }\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        framework: "unknown",
        reactVersion: "19.0.0",
        reactMajorVersion: 19,
        preactVersion: null,
        preactMajorVersion: null,
        hasReactNativeWorkspace: false,
        hasReactCompiler: false,
      },
    },
  },
  {
    name: "effect-interface",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  interface useEffect { readonly brand: string }\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        framework: "unknown",
        reactVersion: "19.0.0",
        reactMajorVersion: 19,
        preactVersion: null,
        preactMajorVersion: null,
        hasReactNativeWorkspace: false,
        hasReactCompiler: false,
      },
    },
  },
  {
    name: "local-proxy-value",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const Proxy = tone;\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = Proxy;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        framework: "unknown",
        reactVersion: "19.0.0",
        reactMajorVersion: 19,
        preactVersion: null,
        preactMajorVersion: null,
        hasReactNativeWorkspace: false,
        hasReactCompiler: false,
      },
    },
  },
  {
    name: "local-function-value",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const Function = tone;\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = Function;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        framework: "unknown",
        reactVersion: "19.0.0",
        reactMajorVersion: 19,
        preactVersion: null,
        preactMajorVersion: null,
        hasReactNativeWorkspace: false,
        hasReactCompiler: false,
      },
    },
  },
  {
    name: "local-require-value",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const require = tone;\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = require;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        framework: "unknown",
        reactVersion: "19.0.0",
        reactMajorVersion: 19,
        preactVersion: null,
        preactMajorVersion: null,
        hasReactNativeWorkspace: false,
        hasReactCompiler: false,
      },
    },
  },
  {
    name: "actual-global-eval-declines",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\neval("opaque");\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        framework: "unknown",
        reactVersion: "19.0.0",
        reactMajorVersion: 19,
        preactVersion: null,
        preactMajorVersion: null,
        hasReactNativeWorkspace: false,
        hasReactCompiler: false,
      },
    },
  },
  {
    name: "type-only-chart-declines",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport type { Chart } from "chart.js";\nimport { LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        framework: "unknown",
        reactVersion: "19.0.0",
        reactMajorVersion: 19,
        preactVersion: null,
        preactMajorVersion: null,
        hasReactNativeWorkspace: false,
        hasReactCompiler: false,
      },
    },
  },
  {
    name: "runtime-chart-shadow-declines",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const Chart = replacement;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        framework: "unknown",
        reactVersion: "19.0.0",
        reactMajorVersion: 19,
        preactVersion: null,
        preactMajorVersion: null,
        hasReactNativeWorkspace: false,
        hasReactCompiler: false,
      },
    },
  },
  {
    name: "erased-function-global-declines",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\ntype Function = { readonly brand: string };\nFunction("return 1")();\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        framework: "unknown",
        reactVersion: "19.0.0",
        reactMajorVersion: 19,
        preactVersion: null,
        preactMajorVersion: null,
        hasReactNativeWorkspace: false,
        hasReactCompiler: false,
      },
    },
  },
  {
    name: "erased-require-global-declines",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\ntype require = { readonly brand: string };\nconst ReactModule = require("react");\nReactModule.useState = replacement;\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react"],
        framework: "unknown",
        reactVersion: "19.0.0",
        reactMajorVersion: 19,
        preactVersion: null,
        preactMajorVersion: null,
        hasReactNativeWorkspace: false,
        hasReactCompiler: false,
      },
    },
  },
];

describe("owned Chart options provider boundaries", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const actual = runRule(noDirectStateMutation, scenario.code, {
        filename: "/synthetic/chart-options/provider-review.tsx",
        settings: scenario.settings,
        includeLocations: true,
      });
      expect(actual.parseErrors).toEqual([]);
      expect(actual.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
