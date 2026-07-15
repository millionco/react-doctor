// rule: no-scale-from-zero
import { div, span as MotionSpan } from "framer-motion/m";

void div;

export const IntrinsicCollision = () => <div initial={{ scale: 0 }} />;

export const ProvenMotionTag = () => <MotionSpan initial={{ scale: 0 }} />;
