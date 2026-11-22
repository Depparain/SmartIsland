import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { invoke } from "@tauri-apps/api/core";

window.addEventListener("error", (e) => {
  invoke("frontend_log", { message: `[JS-ERROR] ${e.message} at ${e.filename}:${e.lineno}` }).catch(() => {});
});

window.addEventListener("unhandledrejection", (e) => {
  invoke("frontend_log", { message: `[JS-PROMISE-ERROR] ${e.reason}` }).catch(() => {});
});

invoke("frontend_log", { message: "[FRONTEND] React app mounting successfully!" }).catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
