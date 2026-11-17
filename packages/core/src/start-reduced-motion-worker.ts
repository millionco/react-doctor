import { parentPort, workerData } from "node:worker_threads";
import { checkReducedMotion } from "./check-reduced-motion.js";

export const startReducedMotionWorker = (): void => {
  if (parentPort === null || typeof workerData !== "string") {
    throw new Error("Reduced-motion worker must run as a worker thread with a root directory.");
  }
  parentPort.postMessage(checkReducedMotion(workerData));
  parentPort.close();
};
