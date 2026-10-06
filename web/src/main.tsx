import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyLook } from "./core.ts";
import "./styles.css";
import { installGestures } from "./gestures.ts";

applyLook();

// Once a page is scrolled, its header fades the content into it (Android's scroll edge).
document.addEventListener("scroll", e => {
  const el = e.target as HTMLElement;
  if (el.classList?.contains("scroll")) el.parentElement?.classList.toggle("scrolled", el.scrollTop > 4);
}, { capture: true, passive: true });

installGestures();

createRoot(document.getElementById("root")!).render(<App />);
