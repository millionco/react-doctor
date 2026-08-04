import { createRequire } from "node:module";
import type * as React from "react";

const requireFromInk = createRequire(createRequire(import.meta.url).resolve("ink"));
const inkReact: typeof React = requireFromInk("react");

export const { useEffect, useMemo, useRef, useState, useSyncExternalStore } = inkReact;
