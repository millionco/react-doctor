// no-multiple-unlabeled-navigation-landmarks | wrapper-transparency | OSS: alan2207/bulletproof-react
import type { ReactNode } from "react";

interface DrawerContentProps {
  children: ReactNode;
}

const DrawerContent = ({ children }: DrawerContentProps) => children;

export const ResponsiveNavigation = () => (
  <main>
    <aside className="hidden sm:flex">
      <nav>Desktop</nav>
    </aside>
    <DrawerContent>
      <nav>Mobile</nav>
    </DrawerContent>
  </main>
);
