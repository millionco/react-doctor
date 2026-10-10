import { CODE_GRADING_PORT } from "./constants.js";
import { createCodeGradingServer } from "./create-code-grading-server.js";

const server = createCodeGradingServer({ apiKey: process.env.CODE_GRADING_API_KEY ?? "" });
server.listen(CODE_GRADING_PORT, "127.0.0.1", () => {
  process.stdout.write(`Code grading API: http://127.0.0.1:${CODE_GRADING_PORT}/v1/check\n`);
});
