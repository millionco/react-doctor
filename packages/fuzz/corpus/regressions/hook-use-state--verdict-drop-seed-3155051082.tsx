// rule: hook-use-state
// weakness: control-flow
// source: strict fuzz seed 1326001, derived seed 3155051082
import { useState } from "react";

export const useStateTupleSeed3155051082 = () => useState(0);
