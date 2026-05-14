import type { Metadata } from "next";
import Terminal from "@/components/terminal";

export const metadata: Metadata = {
  title: "React Doctor - AI-Powered React Code Reviews",
  description: "AI-powered React code reviews. Catch bugs, performance issues, and best practices violations in your React code.",
};

const Home = () => <Terminal />;

export default Home;
