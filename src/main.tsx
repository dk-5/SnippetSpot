import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./index.css";

async function bootstrap() {
  const label = getCurrentWindow().label;

  let Root: React.ComponentType;
  if (label === "manager") {
    Root = (await import("./manager/Manager")).Manager;
  } else {
    Root = (await import("./popup/Popup")).Popup;
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}

bootstrap();
