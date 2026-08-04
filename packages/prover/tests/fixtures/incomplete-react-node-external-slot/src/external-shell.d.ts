declare module "external-shell" {
  import type { ReactNode } from "react";

  export const ExternalShell: (properties: { children: ReactNode }) => ReactNode;
}
