import type { Metadata } from "next";
import Terminal from "@/components/terminal";

export const metadata: Metadata = {
  title: "React Doctor",
  description: "Let coding agents diagnose and fix your React code.",
};

const Home = () => <Terminal />;

export default Home;
