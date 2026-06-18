import { Outlet } from "react-router";
import { Header } from "./components/header";

export default function Root() {
  return (
    <div>
      <Header />
      <Outlet />
    </div>
  );
}
