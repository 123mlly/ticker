import React, { useDeferredValue, useSyncExternalStore } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getLocale, subscribeLocale } from "./i18n";
import "./styles.css";

function LocaleRoot() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  const shown = useDeferredValue(locale);
  return <App locale={shown} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LocaleRoot />
  </React.StrictMode>,
);
