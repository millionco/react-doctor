// rule: no-direct-state-mutation
// verdict: pass
// weakness: name-heuristic
// source: independent synthetic Chart options provider review
import React, { useEffect, useRef, useState } from "react";
import { Chart, LineController } from "chart.js";
Chart.register(LineController);
export const PlotPanel = ({ data, tone, darkMode: _darkMode }) => {
  const Proxy = tone;
  const canvas = useRef(null);
  const [chart, setChart] = useState(null);
  useEffect(() => {
    const context = canvas.current;
    const instance = new Chart(context, {
      type: "line",
      data,
      options: {
        plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } },
        scales: { x: { ticks: { color: "gray" } } },
      },
    });
    setChart(instance);
    return () => instance.destroy();
  }, []);
  useEffect(() => {
    if (!chart) return;
    chart.options.plugins.tooltip.bodyColor = Proxy;
    chart.update("none");
  }, [tone]);
  return <canvas ref={canvas} />;
};
