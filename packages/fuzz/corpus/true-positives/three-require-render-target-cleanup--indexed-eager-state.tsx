// rule: three-require-render-target-cleanup
// weakness: eager-hook-allocation
// source: lifecycle audit
import { useState } from "react";
import { WebGLRenderTarget } from "three";

export const Scene = () => useState(new WebGLRenderTarget(1, 1))[0].width;
