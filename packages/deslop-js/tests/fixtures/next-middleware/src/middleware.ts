import { authCheck } from "./auth";
export const middleware = (request: unknown) => authCheck(request);
