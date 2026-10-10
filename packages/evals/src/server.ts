import { CODE_GRADING_PORT } from "./constants.js";
import { createCodeGradingServer } from "./create-code-grading-server.js";
import { createVercelGradingAdmission } from "./utils/create-vercel-grading-admission.js";

if (process.env.VERCEL !== "1" || process.env.NODE_ENV !== "production")
  throw new Error("This entrypoint requires Vercel production mode; use grade:serve locally");

const server = createCodeGradingServer({
  apiKey: process.env.CODE_GRADING_API_KEY ?? "",
  checkAdmission: createVercelGradingAdmission({
    host: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "",
  }),
});

server.listen(CODE_GRADING_PORT);
