import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { QuickSearch } from "./components/QuickSearch";
import { hideSplash } from "./lib/splash";
import "./index.css";

// One bundle, two windows: the main app, or the small hotkey launcher.
const quick = getCurrentWindow().label === "quick";
if (quick) hideSplash(true);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{quick ? <QuickSearch /> : <App />}</React.StrictMode>,
);
