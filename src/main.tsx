import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { GuidePage, type GuideSlug } from "./GuidePage";
import { Welcome } from "./Welcome";
import "./styles.css";

type Route = "/" | "/editor" | `/guides/${GuideSlug}`;

function currentRoute(): Route {
  if (window.location.pathname === "/editor") return "/editor";
  if (
    window.location.pathname === "/guides/create-app-store-screenshots-with-codex-or-claude-code"
    || window.location.pathname === "/guides/update-localized-app-store-screenshots-without-uploading"
  ) {
    return window.location.pathname as Route;
  }
  return "/";
}

function applyRouteToDocument(route: Route): void {
  document.body.dataset.route = route.startsWith("/guides/") ? "guide" : route === "/editor" ? "editor" : "home";
  document.title = route === "/guides/create-app-store-screenshots-with-codex-or-claude-code"
    ? "Create App Store screenshots with Codex or Claude Code · Truepane"
    : route === "/guides/update-localized-app-store-screenshots-without-uploading"
      ? "Update localized App Store screenshots locally · Truepane"
      : "Truepane - App Store Screenshot Generator for Indie Apps";
}

const startingRoute = currentRoute();
applyRouteToDocument(startingRoute);

function RootExperience() {
  const [route, setRoute] = useState<Route>(startingRoute);

  useEffect(() => applyRouteToDocument(route), [route]);

  useEffect(() => {
    if (currentRoute() === "/" && window.location.pathname !== "/") {
      window.history.replaceState(null, "", "/");
    }

    const handlePopState = () => setRoute(currentRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  if (route === "/editor") return <App />;
  if (route.startsWith("/guides/")) {
    return <GuidePage slug={route.slice("/guides/".length) as GuideSlug} />;
  }

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
