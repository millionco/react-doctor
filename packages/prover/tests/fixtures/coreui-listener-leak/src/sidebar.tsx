import { useEffect, useState } from "react";

interface SidebarProperties {
  visible: boolean;
}

export const Sidebar = ({ visible }: SidebarProperties) => {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    window.addEventListener("resize", () => setMobile(window.innerWidth < 768));
    return () => {
      window.removeEventListener("resize", () => setMobile(window.innerWidth < 768));
    };
  }, []);

  return <aside>{visible && mobile ? "mobile" : "desktop"}</aside>;
};
