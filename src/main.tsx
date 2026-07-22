import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Welcome } from "./Welcome";
import "./styles.css";

type Route = "/" | "/editor";

function currentRoute(): Route {
  return window.location.pathname === "/editor" ? "/editor" : "/";
}

function applyRouteToDocument(route: Route): void {
  document.body.dataset.route = route === "/editor" ? "editor" : "home";
}

const startingRoute = currentRoute();
applyRouteToDocument(startingRoute);

function RootExperience() {
  const [route, setRoute] = useState<Route>(startingRoute);

  useEffect(() => applyRouteToDocument(route), [route]);

  useEffect(() => {
    if (window.location.pathname !== "/" && window.location.pathname !== "/editor") {
      window.history.replaceState(null, "", "/");
    }

    const handlePopState = () => setRoute(currentRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  if (route === "/editor") return <App />;

  return (
    <Welcome
      onOpenEditor={() => {
        window.history.pushState(null, "", "/editor");
        setRoute("/editor");
      }}
    />
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <RootExperience />
  </StrictMode>,
);
