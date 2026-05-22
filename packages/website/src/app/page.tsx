import type { Metadata } from "next";
import Terminal from "@/components/terminal";

export const metadata: Metadata = {
  title: "React Doctor",
  description: "Your agent writes bad React, this catches it. Diagnose and fix React codebases.",
};

const Home = () => <Terminal />;

export default Home;
