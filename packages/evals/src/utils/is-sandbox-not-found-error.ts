import { APIError } from "@vercel/sandbox";

import { HTTP_NOT_FOUND_STATUS } from "../constants.js";

export const isSandboxNotFoundError = (error: unknown): boolean =>
  error instanceof APIError && error.response.status === HTTP_NOT_FOUND_STATUS;
