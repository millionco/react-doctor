import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { preview } from "vite";

const VIDEO_WIDTH_PX = 1920;
const VIDEO_HEIGHT_PX = 1080;
const VIDEO_FPS = 30;
const VIDEO_FRAME_COUNT = 390;
const PREVIEW_PORT = 4173;
const FRAME_EVENT_NAME = "react-doctor:set-frame";
const CHROMIUM_EXECUTABLE_PATH = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";
const appDirectory = process.cwd();
const outputDirectory = path.join(appDirectory, "output");
const outputPath = path.join(outputDirectory, "react-doctor-three.mp4");

const runCommand = (command, argumentsList) =>
  new Promise((resolve, reject) => {
    const processInstance = spawn(command, argumentsList, { stdio: "inherit" });
    processInstance.once("error", reject);
    processInstance.once("exit", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${exitCode ?? "unknown"}`));
    });
  });

const closeServer = (previewServer) =>
  new Promise((resolve, reject) => {
    previewServer.httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

await mkdir(outputDirectory, { recursive: true });
const frameDirectory = await mkdtemp(path.join(tmpdir(), "react-doctor-three-frames-"));
const previewServer = await preview({
  root: appDirectory,
  preview: { host: "127.0.0.1", port: PREVIEW_PORT, strictPort: true },
});
const browser = await chromium.launch({
  executablePath: CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  args: ["--disable-gpu-sandbox", "--no-sandbox"],
});

try {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: VIDEO_WIDTH_PX, height: VIDEO_HEIGHT_PX },
  });
  await page.goto(`http://127.0.0.1:${PREVIEW_PORT}/?real=true&manual=true`, {
    waitUntil: "networkidle",
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  });

  for (let frame = 0; frame < VIDEO_FRAME_COUNT; frame += 1) {
    await page.evaluate(
      async ({ eventName, nextFrame }) => {
        window.dispatchEvent(new CustomEvent(eventName, { detail: nextFrame }));
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
      },
      { eventName: FRAME_EVENT_NAME, nextFrame: frame },
    );
    await page.screenshot({
      path: path.join(frameDirectory, `frame-${String(frame).padStart(4, "0")}.png`),
      type: "png",
    });
    if ((frame + 1) % VIDEO_FPS === 0) {
      process.stdout.write(
        `Rendered ${(frame + 1) / VIDEO_FPS}s / ${VIDEO_FRAME_COUNT / VIDEO_FPS}s\n`,
      );
    }
  }

  await browser.close();
  await runCommand("ffmpeg", [
    "-y",
    "-framerate",
    String(VIDEO_FPS),
    "-i",
    path.join(frameDirectory, "frame-%04d.png"),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
  process.stdout.write(`${outputPath}\n`);
} finally {
  if (browser.isConnected()) await browser.close();
  await closeServer(previewServer);
  await rm(frameDirectory, { recursive: true, force: true });
}
