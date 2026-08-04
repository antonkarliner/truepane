import { StrictMode, useEffect, useState } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App";
import { GUIDE_REGISTRY, GuidePage, type GuideSlug } from "./GuidePage";
import { initialTheme } from "./theme";
import { Welcome } from "./Welcome";
import "./styles.css";

type Route = "/" | "/editor" | `/guides/${GuideSlug}`;

function currentRoute(): Route {
  if (window.location.pathname === "/editor") return "/editor";
  const guideSlug = window.location.pathname.startsWith("/guides/")
    ? window.location.pathname.slice("/guides/".length)
    : "";
  if (Object.prototype.hasOwnProperty.call(GUIDE_REGISTRY, guideSlug)) {
    return window.location.pathname as Route;
  }
  return "/";
}

function applyRouteToDocument(route: Route): void {
  document.body.dataset.route = route.startsWith("/guides/") ? "guide" : route === "/editor" ? "editor" : "home";
  const guide = route.startsWith("/guides/")
    ? GUIDE_REGISTRY[route.slice("/guides/".length) as GuideSlug]
    : null;
  const metadata = guide ?? {
    title: route === "/editor"
      ? "Truepane editor · App Store screenshot generator"
      : "Truepane - App Store Screenshot Generator for Indie Apps",
    description: route === "/editor"
      ? "Compose and export App Store and Google Play screenshot sets locally in the Truepane editor."
      : "Create App Store and Google Play screenshots in your browser with device frames, your own background images or generated ones, local canvas rendering, and PNG, strip, or ZIP export.",
  };

  document.title = metadata.title;

  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  canonical.href = new URL(route, window.location.origin).href;

  let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!description) {
    description = document.createElement("meta");
    description.name = "description";
    document.head.append(description);
  }
  description.content = metadata.description;
}

initialTheme();
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

const experience = (
  <StrictMode>
    <RootExperience />
  </StrictMode>
);

if (rootEl.hasChildNodes()) {
  hydrateRoot(rootEl, experience);
} else {
  createRoot(rootEl).render(experience);
}
