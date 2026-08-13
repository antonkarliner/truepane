import { StrictMode, useEffect, useState } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App";
import { GUIDE_REGISTRY, GuidePage, type GuideSlug } from "./GuidePage";
import { applyTheme, initialTheme, type Theme } from "./theme";
import { Welcome } from "./Welcome";
import "./styles.css";

function initializeSeoCopyButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".seo-content__copy").forEach((button) => {
    button.addEventListener("click", async () => {
      const command = button.closest(".seo-content__code-wrap")?.querySelector("code")?.textContent;
      if (!command) return;

      try {
        await navigator.clipboard.writeText(command);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Copy failed";
      }

      window.setTimeout(() => {
        button.textContent = "Copy";
      }, 1800);
    });
  });
}

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
  const guideSlug = route.startsWith("/guides/") ? route.slice("/guides/".length) : null;
  const socialImage = new URL(guideSlug ? `/og/guides/${guideSlug}.png` : "/og-image.png", window.location.origin).href;
  const socialImageAlt = guide
    ? `${guide.title.replace(/ · Truepane$/, "")} — Truepane guide`
    : "Truepane editor composing a store screenshot set";

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

  const socialMetadata = [
    ['meta[property="og:title"]', "property", "og:title", metadata.title],
    ['meta[property="og:description"]', "property", "og:description", metadata.description],
    ['meta[property="og:image"]', "property", "og:image", socialImage],
    ['meta[property="og:image:alt"]', "property", "og:image:alt", socialImageAlt],
    ['meta[name="twitter:title"]', "name", "twitter:title", metadata.title],
    ['meta[name="twitter:description"]', "name", "twitter:description", metadata.description],
    ['meta[name="twitter:image"]', "name", "twitter:image", socialImage],
    ['meta[name="twitter:image:alt"]', "name", "twitter:image:alt", socialImageAlt],
  ] as const;
  for (const [selector, attribute, name, content] of socialMetadata) {
    let meta = document.querySelector<HTMLMetaElement>(selector);
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute(attribute, name);
      document.head.append(meta);
    }
    meta.content = content;
  }
}

initialTheme();
initializeSeoCopyButtons();
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

  if (route === "/editor") {
    // A full navigation, not a client-side route change. `loadProject` memoizes
    // per page session (so the localStorage migration runs exactly once), which
    // means a remounted <App/> would restore the state as of the *original*
    // page load and then persist that stale snapshot over newer edits. App
    // flushes the pending save before calling this.
    return <App onExitEditor={() => window.location.assign("/")} />;
  }
  if (route.startsWith("/guides/")) {
    return <GuideExperience slug={route.slice("/guides/".length) as GuideSlug} />;
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

function GuideExperience({ slug }: { slug: GuideSlug }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  };

  return <GuidePage slug={slug} theme={theme} onToggleTheme={toggleTheme} />;
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
