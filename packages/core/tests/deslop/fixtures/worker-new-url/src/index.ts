const workerUrl = new URL("./worker.js", import.meta.url);
const worker = new Worker(workerUrl);

export const start = () => worker.postMessage("start");
