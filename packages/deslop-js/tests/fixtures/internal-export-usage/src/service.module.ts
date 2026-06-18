import { registerModule } from "./module-registry";

export const serviceModule = createModule();

registerModule({
  module: serviceModule,
  token: "Service",
});

export function createModule() {
  return { token: "Service" };
}
