import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { buildTestProject } from "../regressions/_helpers.js";
import { BASIC_REACT_DIRECTORY } from "./_helpers.js";

const CPU_LOOP_SCRIPT =
  "let x=0;const end=Date.now()+400;while(Date.now()<end){x+=Math.sqrt(x+1);}process.stdout.write(String(x>0));";

const timeChild = (priority: number | null): Promise<number> =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, ["-e", CPU_LOOP_SCRIPT], { stdio: "ignore" });
    if (priority !== null && child.pid !== undefined) {
      try {
        os.setPriority(child.pid, priority);
      } catch {}
    }
    child.once("close", () => resolve(Date.now() - startedAt));
  });

const snapshotProcesses = (): string => {
  if (process.platform === "win32") return "n/a";
  try {
    const rows = execFileSync("ps", ["-eo", "rss=,comm="], { encoding: "utf8" })
      .split("\n")
      .map((row) => row.trim())
      .filter((row) => row.length > 0);
    let nodeCount = 0;
    let nodeRssMb = 0;
    let totalRssMb = 0;
    for (const row of rows) {
      const [rss, ...command] = row.split(/\s+/);
      const rssMb = Number(rss) / 1024;
      totalRssMb += rssMb;
      if (command.join(" ").includes("node")) {
        nodeCount += 1;
        nodeRssMb += rssMb;
      }
    }
    return `procs=${rows.length} node=${nodeCount} nodeRssMb=${Math.round(nodeRssMb)} totalRssMb=${Math.round(totalRssMb)} freeMemMb=${Math.round(os.freemem() / 1048576)}`;
  } catch (error) {
    return `ps failed: ${String(error)}`;
  }
};

export const runPoolTimingProbe = async (label: string): Promise<void> => {
  const debugLogPath = path.join(
    os.tmpdir(),
    `rd-pool-timing-${label}-${process.pid}-${Date.now()}.ndjson`,
  );
  process.env.REACT_DOCTOR_DEBUG_POOL_LOG = debugLogPath;
  const { runOxlint } = await import("@react-doctor/core");
  const lines: string[] = [];
  const log = (message: string): void => {
    lines.push(`[pool-timing:${label}] ${message}`);
  };
  log(
    `host cores=${os.availableParallelism()} loadavg=${os
      .loadavg()
      .map((value) => value.toFixed(2))
      .join(
        ",",
      )} freeMemMb=${Math.round(os.freemem() / 1048576)} totalMemMb=${Math.round(os.totalmem() / 1048576)} node=${process.version} execArgv=${JSON.stringify(process.execArgv)} priority=${os.getPriority()}`,
  );
  log(`processes before: ${snapshotProcesses()}`);
  const normalMs = await timeChild(null);
  const loweredMs = await timeChild(10);
  const normalAgainMs = await timeChild(null);
  log(`cpu-loop child: normal=${normalMs}ms nice10=${loweredMs}ms normal=${normalAgainMs}ms`);
  for (let index = 0; index < 3; index += 1) {
    const cpuStart = process.cpuUsage();
    const startedAt = Date.now();
    const diagnostics = await runOxlint({
      rootDirectory: BASIC_REACT_DIRECTORY,
      project: buildTestProject({
        rootDirectory: BASIC_REACT_DIRECTORY,
        tanstackQueryVersion: "^5.66.0",
        mobxVersion: null,
        styledComponentsVersion: null,
      }),
    });
    const cpu = process.cpuUsage(cpuStart);
    log(
      `runOxlint #${index + 1}: wall=${Date.now() - startedAt}ms parentCpu=${Math.round((cpu.user + cpu.system) / 1000)}ms diagnostics=${diagnostics.length} loadavg=${os.loadavg()[0]?.toFixed(2)}`,
    );
    log(`processes after #${index + 1}: ${snapshotProcesses()}`);
  }
  if (fs.existsSync(debugLogPath)) {
    for (const line of fs.readFileSync(debugLogPath, "utf8").split("\n")) {
      if (line.length > 0) log(line);
    }
  } else {
    log("no debug log written");
  }
  console.error(lines.join("\n"));
};
