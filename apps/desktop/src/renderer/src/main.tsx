import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

function BootFailure({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ padding: 32, fontFamily: "Inter, sans-serif", color: "#cad3f5" }}>
      <h1>{title}</h1>
      <pre style={{ whiteSpace: "pre-wrap" }}>{detail}</pre>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

window.addEventListener("error", (event) => {
  console.error("Renderer error", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("Renderer rejection", event.reason);
});

createRoot(root).render(
  <React.StrictMode>
    {window.capsule ? (
      <App />
    ) : (
      <BootFailure
        title="Desktop bridge missing"
        detail="The preload script did not expose window.capsule. Stop other Capsule windows and run pnpm dev again."
      />
    )}
  </React.StrictMode>,
);
