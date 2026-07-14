import { useState, useEffect, useMemo, memo } from "react";
import { motion } from "framer-motion";

const MemoChild = memo(({ onClick }: { onClick: () => void }) => (
  <button onClick={onClick}>click</button>
));

const ParentWithInlinePropOnMemo = () => <MemoChild onClick={() => console.log("inline")} />;

const SimpleMemoComponent = ({ count }: { count: number }) => {
  const doubled = useMemo(() => count * 2, [count]);
  return <div>{doubled}</div>;
};

const LayoutAnimationComponent = () => (
  <motion.div animate={{ width: 100, height: 200 }}>animated</motion.div>
);

const TransitionAllComponent = () => <div style={{ transition: "all 0.3s ease" }}>styled</div>;

const LargeBlurComponent = () => <div style={{ filter: "blur(20px)" }}>blurred</div>;

const ScaleFromZeroComponent = () => <motion.div initial={{ scale: 0 }}>scale</motion.div>;

const PermanentWillChangeComponent = () => <div style={{ willChange: "transform" }}>permanent</div>;

const MemoItemList = memo(({ items }: { items: string[] }) => (
  <ul>
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
));

const DefaultPropComponent = ({ items = [] }: { items?: string[] }) => (
  <MemoItemList items={items} />
);

const SvgAnimationComponent = () => (
  <svg animate={{ rotate: 45 }}>
    <circle r={10} />
  </svg>
);

const LoadingStateComponent = () => {
  const [isLoading, setIsLoading] = useState(false);
  return <div>{isLoading ? "Loading..." : "Done"}</div>;
};

const HydrationFlickerComponent = () => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return <div>{mounted ? "client" : "server"}</div>;
};

const GlobalCssVarComponent = () => {
  requestAnimationFrame(() => {
    document.documentElement.style.setProperty("--scroll-y", "100px");
  });
  return <div />;
};

const ScriptWithoutDeferComponent = () => (
  <div>
    <script src="https://cdn.example.com/analytics.js" />
  </div>
);

export {
  MemoChild,
  ParentWithInlinePropOnMemo,
  SimpleMemoComponent,
  LayoutAnimationComponent,
  TransitionAllComponent,
  LargeBlurComponent,
  ScaleFromZeroComponent,
  PermanentWillChangeComponent,
  DefaultPropComponent,
  SvgAnimationComponent,
  LoadingStateComponent,
  HydrationFlickerComponent,
  GlobalCssVarComponent,
  ScriptWithoutDeferComponent,
};
