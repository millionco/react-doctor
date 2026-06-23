import { work } from "worker-loader!./worker";
import { raw } from "./query?raw";
import { section } from "./frag#section";

export const run = (): number => work() + raw() + section();
