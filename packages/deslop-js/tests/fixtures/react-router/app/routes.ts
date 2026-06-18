import { route, layout, index } from "@react-router/dev/routes";

export default [
  route("/", "./routes/home.tsx"),
  route("/about", "./routes/about.tsx"),
  layout("./dashboard/layout.tsx", [index("./dashboard/page.tsx")]),
];
