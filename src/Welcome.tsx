import { useEffect, useRef, useState } from "react";
import { FileCodeIcon, MoonIcon, ShieldCheckIcon, SunIcon } from "@phosphor-icons/react";
import { applyTheme, initialTheme, type Theme } from "./theme";

type SetupClient = "codex" | "claude" | "agent";

const setupDetails: Record<SetupClient, { label: string; intro: string; copy: string; next: string }> = {
  codex: {
    label: "Codex",
    intro: "Add this block to ~/.codex/config.toml:",
    copy: `[mcp_servers.truepane]\ncommand = "npx"\nargs = ["-y", "truepane-mcp"]`,
    next: "Restart Codex, then ask it to list the available Truepane tools.",
  },
  claude: {
    label: "Claude Code",
    intro: "Run this command in your terminal:",
    copy: "claude mcp add truepane -- npx -y truepane-mcp",
    next: "Restart Claude Code, then ask it to create a Truepane screenshot project.",
  },
  agent: {
    label: "Ask your agent",
    intro: "Copy this prompt into any MCP-capable agent:",
    copy:
      "Set up the Truepane MCP server for this client. It is a local stdio server published as the npm package truepane-mcp and should run with `npx -y truepane-mcp`. Use this client's standard MCP configuration, then verify that the Truepane tools are available. Do not install or modify anything unrelated.",
    next: "Let your agent complete the setup, then ask it to create a Truepane screenshot project.",
  },
};

function TruepaneBrand() {
  return (
    <div className="welcome-brand" aria-label="Truepane">
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="welcome-brand-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e07828" />
              <stop offset="100%" stopColor="#8840b8" />
            </linearGradient>
          </defs>
          <rect x="4" y="8" width="5.5" height="16" rx="1.6" fill="#f0e4cc" />
          <rect x="13.25" y="6" width="5.5" height="20" rx="1.6" fill="url(#welcome-brand-gradient)" />
          <rect x="22.5" y="8" width="5.5" height="16" rx="1.6" fill="#7060a8" />
        </svg>
      </span>
      <span>Truepane</span>
    </div>
  );
}

function ClientIcon({ client }: { client: SetupClient }) {
  if (client === "codex") {
    return <img src="/codex-openai.svg" alt="" aria-hidden="true" />;
  }
  if (client === "claude") {
    return <img src="/claude-code.png" alt="" aria-hidden="true" />;
  }
  return <span className="setup-client__prompt" aria-hidden="true">Aa</span>;
}

function SetupModal({ onClose }: { onClose: () => void }) {
  const [client, setClient] = useState<SetupClient>("codex");
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const details = setupDetails[client];

  useEffect(() => {
    const scrollY = window.scrollY;
    const previousOverflow = document.documentElement.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    document.documentElement.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      window.scrollTo({ top: scrollY });
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const copySetup = async () => {
    await navigator.clipboard.writeText(details.copy);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="setup-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <header className="setup-modal__header">
          <div>
            <h2 id="setup-title">Set up Truepane MCP</h2>
            <p>Choose your AI client or hand the setup to your agent.</p>
          </div>
          <button ref={closeRef} className="setup-close" onClick={onClose} aria-label="Close setup">
            ×
          </button>
        </header>

        <div className="setup-clients" role="tablist" aria-label="AI client">
          {(Object.keys(setupDetails) as SetupClient[]).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={client === id}
              className={client === id ? "active" : ""}
              onClick={() => {
                setClient(id);
                setCopied(false);
              }}
            >
              <ClientIcon client={id} />
              {setupDetails[id].label}
            </button>
          ))}
        </div>

        <div className="setup-step">
          <span className="setup-step__number">1</span>
          <div className="setup-step__content">
            <h3>{client === "agent" ? "Ask your agent" : "Add the server"}</h3>
            <p>{details.intro}</p>
            <div className={`setup-code${client === "agent" ? " setup-code--prompt" : ""}`}>
              <pre><code>{details.copy}</code></pre>
              <button onClick={copySetup}>{copied ? "Copied" : client === "agent" ? "Copy prompt" : "Copy"}</button>
            </div>
          </div>
        </div>

        <div className="setup-step">
          <span className="setup-step__number">2</span>
          <div className="setup-step__content">
            <h3>Start creating</h3>
            <p>{details.next}</p>
          </div>
        </div>

        <div className="setup-assurance">Runs locally. No API keys. Nothing uploaded.</div>

        <footer className="setup-modal__footer">
          <a href="https://github.com/antonkarliner/truepane/tree/main/packages/truepane-mcp" target="_blank" rel="noopener noreferrer">
            View full setup guide
          </a>
          <button className="primary" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}

export function Welcome({ onOpenEditor }: { onOpenEditor: () => void }) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  };

  return (
    <main className="welcome">
      <header className="welcome__header">
        <TruepaneBrand />
        <div className="welcome__actions">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </button>
          <button className="welcome__skip" onClick={onOpenEditor}>Already set up? <span>Open editor</span></button>
        </div>
      </header>

      <div className="welcome__intro">
        <p className="welcome__eyebrow">App Store + Google Play screenshots</p>
        <h1>Build the whole store screenshot set in one place.</h1>
        <p>Compose, localize, preflight, and export every App Store and Google Play asset—visually or with your AI agent.</p>
        <div className="welcome__open-source">
          <a href="https://github.com/antonkarliner/truepane" target="_blank" rel="noopener noreferrer">Free and open source</a>
          <span>Runs locally · no account required</span>
        </div>
        <span>Choose how to start</span>
      </div>

      <div className="welcome__table">
        <section className="welcome-path welcome-path--mcp">
          <p className="welcome-path__label">Recommended</p>
          <h2>Hand the release set to your agent</h2>
          <p>Let Codex, Claude Code, or another MCP-capable agent import captures, compose every slide, localize the set, run preflight, and render only what changed.</p>
          <div className="welcome-command">
            <span>Terminal</span>
            <code>npx -y truepane-mcp</code>
          </div>
          <button className="welcome-path__button welcome-path__button--primary" onClick={() => setSetupOpen(true)}>
            Set up Truepane MCP <span aria-hidden="true">→</span>
          </button>
        </section>

        <section className="welcome-path welcome-path--editor">
          <h2>Compose every slide visually</h2>
          <p>Drag, resize, and rotate devices; span one mockup across two slides; reuse brand kits; and preview every target before export.</p>
          <div
            className="welcome-preview welcome-preview--editor-showcase"
            role="img"
            aria-label="Truepane editor with a rotated mobile device spanning two slides"
          >
            <img
              src={theme === "dark" ? "/welcome-editor-preview-dark.png" : "/welcome-editor-preview.png"}
              alt=""
            />
          </div>
          <button className="welcome-path__button" onClick={onOpenEditor}>
            Open web editor <span aria-hidden="true">→</span>
          </button>
        </section>

        <footer className="welcome__footer">
          <div className="welcome__footer-item">
            <FileCodeIcon size={28} weight="light" aria-hidden="true" />
            <span>Projects move between MCP and the web editor as <code>JSON</code>.</span>
          </div>
          <div className="welcome__footer-item welcome__footer-item--privacy">
            <ShieldCheckIcon size={28} weight="light" aria-hidden="true" />
            <span>No API keys. Nothing uploaded.</span>
          </div>
        </footer>
      </div>

      {setupOpen && <SetupModal onClose={() => setSetupOpen(false)} />}
    </main>
  );
}
