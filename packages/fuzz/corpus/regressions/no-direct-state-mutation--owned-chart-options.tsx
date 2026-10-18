// rule: no-direct-state-mutation
// verdict: pass
// weakness: library-idiom
// source: independently synthetic chart options state role
import React, { useEffect, useRef, useState } from "react";
import { Chart, LineController } from "chart.js";
Chart.register(LineController);
export const PlotPanel = ({ data, tone }) => {
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
  }, [data]);
  useEffect(() => {
    if (!chart) return;
    chart.options.plugins.tooltip.bodyColor = tone;
    chart.update("none");
  }, [tone, chart]);
  return <canvas ref={canvas} />;
};
