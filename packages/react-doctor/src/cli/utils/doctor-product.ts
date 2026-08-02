export interface DoctorProduct {
  readonly packageName: string;
  readonly displayName: string;
  readonly description: string;
  readonly tagline: string;
  readonly includedTags: readonly string[];
  readonly scoreDisabledMessage?: string;
  readonly requiresReactRuntime: boolean;
}

const REACT_DOCTOR_PRODUCT: DoctorProduct = {
  packageName: "react-doctor",
  displayName: "React Doctor",
  description: "Diagnose React codebase health",
  tagline: "I diagnose your React code for bugs, security & performance.",
  includedTags: [],
  requiresReactRuntime: true,
};

const DOCTOR_PRODUCTS: Record<string, DoctorProduct> = {
  "react-doctor": REACT_DOCTOR_PRODUCT,
  "tui-doctor": {
    packageName: "tui-doctor",
    displayName: "TUI Doctor",
    description: "Diagnose Ink terminal UI code",
    tagline: "I diagnose your Ink terminal UI for bugs and performance.",
    includedTags: ["ink"],
    scoreDisabledMessage: "TUI Doctor scans do not affect the React health score.",
    requiresReactRuntime: true,
  },
  "ui-doctor": {
    packageName: "ui-doctor",
    displayName: "UI Doctor",
    description: "Diagnose React UI design quality",
    tagline: "I diagnose your React UI for design and usability issues.",
    includedTags: ["design"],
    scoreDisabledMessage: "UI Doctor scans do not affect the React health score.",
    requiresReactRuntime: true,
  },
  "threejs-doctor": {
    packageName: "threejs-doctor",
    displayName: "Three.js Doctor",
    description: "Diagnose Three.js and React Three Fiber code",
    tagline: "I diagnose your Three.js code for bugs and performance.",
    includedTags: ["three", "r3f"],
    scoreDisabledMessage: "Three.js Doctor scans do not affect the React health score.",
    requiresReactRuntime: false,
  },
};

export const getDoctorProduct = (): DoctorProduct =>
  DOCTOR_PRODUCTS[process.env.REACT_DOCTOR_PRODUCT ?? ""] ?? REACT_DOCTOR_PRODUCT;
