import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildOxlintTimingArguments } from "./build-oxlint-timing-arguments.js";

export interface CaptureOxlintRuleTimingsInput {
  argumentsList: readonly string[];
  environment: NodeJS.ProcessEnv;
  nodeBinaryPath: string;
  rootDirectory: string;
  timingDirectory: string;
}

export const captureOxlintRuleTimings = (input: CaptureOxlintRuleTimingsInput): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const timingEnvironment = { ...input.environment };
    timingEnvironment.REACT_DOCTOR_RULE_TIMINGS_DIR = undefined;
    const timingChild = spawn(
      input.nodeBinaryPath,
      buildOxlintTimingArguments(input.argumentsList),
      {
        cwd: input.rootDirectory,
        env: timingEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdoutBuffers: Buffer[] = [];
    const stderrBuffers: Buffer[] = [];
    timingChild.stdout.on("data", (buffer: Buffer) => stdoutBuffers.push(buffer));
    timingChild.stderr.on("data", (buffer: Buffer) => stderrBuffers.push(buffer));
    timingChild.on("error", reject);
    timingChild.on("close", (_code, signal) => {
      if (signal) {
        reject(new Error(`Oxlint timing pass was killed by ${signal}`));
        return;
      }
      const timingOutput = `${Buffer.concat(stdoutBuffers).toString("utf8")}\n${Buffer.concat(
        stderrBuffers,
      ).toString("utf8")}`;
      if (!timingOutput.includes("Rule timings:")) {
        resolve();
        return;
      }
      fs.mkdirSync(input.timingDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(input.timingDirectory, `oxlint-${timingChild.pid ?? process.pid}.timings.txt`),
        timingOutput,
      );
      resolve();
    });
  });
