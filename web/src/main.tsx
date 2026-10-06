import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyLook } from "./core.ts";
import "./styles.css";

applyLook();
createRoot(document.getElementById("root")!).render(<App />);
