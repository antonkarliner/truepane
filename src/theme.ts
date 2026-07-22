export type Theme = "light" | "dark";

const THEME_KEY = "appstore-theme";

function applyFavicon(theme: Theme) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = theme === "dark" ? "/favicon-dark.svg" : "/favicon-light.svg";
}

export function applyTheme(theme: Theme, persist = true): void {
  document.documentElement.dataset.theme = theme;
  applyFavicon(theme);
  if (persist) localStorage.setItem(THEME_KEY, theme);
}

export function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  const theme =
    stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  applyTheme(theme, false);
  return theme;
}
