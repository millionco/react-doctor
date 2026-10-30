import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

interface ChartOptionsTestCase {
  name: string;
  code: string;
  options: RunRuleOptions;
  expectedCount: number;
}

const cases: ReadonlyArray<ChartOptionsTestCase> = [
  {
    name: "canonical-chart-effect-local-instance",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/canonical-chart-effect-local-instance.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 0,
  },
  {
    name: "canonical-tooltip-background-option",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.backgroundColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/canonical-tooltip-background-option.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 0,
  },
  {
    name: "canonical-scale-tick-color-option",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.scales.x.ticks.color = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/canonical-scale-tick-color-option.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 0,
  },
  {
    name: "canonical-import-local-rename",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart as PlotConstructor, LineController } from "chart.js";\nPlotConstructor.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new PlotConstructor(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/canonical-import-local-rename.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 0,
  },
  {
    name: "conditional-options-branches-and-final-update",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    if (darkMode) { chart.options.plugins.tooltip.bodyColor = tone.dark; } else { chart.options.plugins.tooltip.bodyColor = tone.light; }\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/conditional-options-branches-and-final-update.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 0,
  },
  {
    name: "second-null-setter-feed",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  const reset = () => setChart(null);\n  return <canvas ref={canvas} onClick={reset} />;\n};\n',
    options: {
      filename: "/private/react-doctor-synthetic/opaque-chart-state/second-null-setter-feed.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "mixed-unknown-second-setter-feed",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  const replace = () => setChart(readExternal());\n  return <canvas ref={canvas} onClick={replace} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/mixed-unknown-second-setter-feed.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "mixed-plain-second-setter-feed",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  const replace = () => setChart({ options: { plugins: { tooltip: {} } } });\n  return <canvas ref={canvas} onClick={replace} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/mixed-plain-second-setter-feed.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "plain-array-aliased-setter-feed",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Array();\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/plain-array-aliased-setter-feed.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "setter-transported-to-unknown-caller",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  registerSetter(setChart);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/setter-transported-to-unknown-caller.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "mutable-construction-alias",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    let instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    instance = readExternal();\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename: "/private/react-doctor-synthetic/opaque-chart-state/mutable-construction-alias.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "two-hop-construction-alias",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    const forwarded = instance;\n    setChart(forwarded);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename: "/private/react-doctor-synthetic/opaque-chart-state/two-hop-construction-alias.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "factory-wrapped-construction",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(wrapInstance(instance));\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/factory-wrapped-construction.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "async-construction-effect",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(async () => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename: "/private/react-doctor-synthetic/opaque-chart-state/async-construction-effect.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "suspension-before-aliased-feed",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(async () => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    await pause();\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/suspension-before-aliased-feed.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "missing-following-sdk-update",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    void tone;\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/missing-following-sdk-update.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "handle-derived-react-render-data",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <><canvas ref={canvas} /><span>{chart?.options.plugins.tooltip.bodyColor}</span></>;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/handle-derived-react-render-data.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "state-handle-transport",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    inspectChart(chart);\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename: "/private/react-doctor-synthetic/opaque-chart-state/state-handle-transport.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "instance-alias-transport",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    publishInstance(instance);\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename: "/private/react-doctor-synthetic/opaque-chart-state/instance-alias-transport.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "local-same-name-constructor-returns-plain",
    code: 'import React, { useEffect, useRef, useState } from "react";\nconst Chart = class { constructor() { return { options: { plugins: { tooltip: {} } } }; } };\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/local-same-name-constructor-returns-plain.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "default-import-not-selected-chart-export",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport Chart, { LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/default-import-not-selected-chart-export.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "type-only-chart-provider",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport type { Chart } from "chart.js";\nimport { LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename: "/private/react-doctor-synthetic/opaque-chart-state/type-only-chart-provider.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "shadowed-react-state-hook",
    code: 'import React, { useEffect, useRef, useState as reactUseState } from "react";\nconst useState = initial => [initial, next => next];\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename: "/private/react-doctor-synthetic/opaque-chart-state/shadowed-react-state-hook.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 0,
  },
  {
    name: "source-visible-sdk-method-replacement",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nChart.prototype.update = replacement;\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/source-visible-sdk-method-replacement.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "instance-options-replaced-through-alias",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    const optionsAlias = instance;\n    optionsAlias.options = readExternal();\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/instance-options-replaced-through-alias.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "accessor-on-selected-options-path",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { get plugins() { return externalPlugins; }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/accessor-on-selected-options-path.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "spread-in-selected-options-parent",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { ...extraOptions, plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/spread-in-selected-options-parent.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "computed-options-write",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options[readKey()] = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename: "/private/react-doctor-synthetic/opaque-chart-state/computed-options-write.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "array-mutator-on-handle-data",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.data.datasets.push(data);\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/array-mutator-on-handle-data.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "reflective-provider-constructor",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = Reflect.construct(Chart, [context, data]);\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/reflective-provider-constructor.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "known-commonjs-provider-write",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nconst ReactModule = require("react");\nReactModule.useState = replacement;\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/known-commonjs-provider-write.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "legacy-direct-constructor-initializer",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(new Chart(null, { type: "line", data, options: {} }));\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/legacy-direct-constructor-initializer.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 0,
  },
  {
    name: "visible-registered-controller-prototype-replacement",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nLineController.prototype.initialize = replacement;\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/visible-registered-controller-prototype-replacement.tsx",
      forceJsx: true,
      includeLocations: true,
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
    expectedCount: 1,
  },
  {
    name: "explicit-pure-preact-profile-conflicts-react-premise",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/explicit-pure-preact-profile-conflicts-react-premise.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: ["pure-preact"],
          framework: "unknown",
          reactVersion: null,
          reactMajorVersion: null,
          preactVersion: "10.27.2",
          preactMajorVersion: 10,
          hasReactNativeWorkspace: false,
          hasReactCompiler: false,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "canonical-react-provider-with-no-project-settings",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/canonical-react-provider-with-no-project-settings.tsx",
      forceJsx: true,
      includeLocations: true,
    },
    expectedCount: 0,
  },
  {
    name: "canonical-react-provider-major17-no-extra-version-gate",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/canonical-react-provider-major17-no-extra-version-gate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: ["react"],
          framework: "unknown",
          reactVersion: "17.0.2",
          reactMajorVersion: 17,
          preactVersion: null,
          preactMajorVersion: null,
          hasReactNativeWorkspace: false,
          hasReactCompiler: false,
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "explicit-native-project-declines-new-chart-role",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/explicit-native-project-declines-new-chart-role.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: ["react"],
          framework: "unknown",
          reactVersion: "19.0.0",
          reactMajorVersion: 19,
          preactVersion: null,
          preactMajorVersion: null,
          hasReactNativeWorkspace: true,
          hasReactCompiler: false,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "explicit-compiler-project-declines-new-chart-role",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/explicit-compiler-project-declines-new-chart-role.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: ["react"],
          framework: "unknown",
          reactVersion: "19.0.0",
          reactMajorVersion: 19,
          preactVersion: null,
          preactMajorVersion: null,
          hasReactNativeWorkspace: false,
          hasReactCompiler: true,
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "explicit-preact-version-declines-new-chart-role",
    code: 'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n',
    options: {
      filename:
        "/private/react-doctor-synthetic/opaque-chart-state/explicit-preact-version-declines-new-chart-role.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: ["react"],
          framework: "unknown",
          reactVersion: "19.0.0",
          reactMajorVersion: 19,
          preactVersion: "10.26.4",
          preactMajorVersion: 10,
          hasReactNativeWorkspace: false,
          hasReactCompiler: false,
        },
      },
    },
    expectedCount: 1,
  },
];

describe("no-direct-state-mutation owned chart options", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noDirectStateMutation, testCase.code, testCase.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
    });
  }
});
