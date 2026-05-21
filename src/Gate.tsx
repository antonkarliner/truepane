// Temporary client-side beta password gate. Opt-in: only active when
// VITE_GATE_PASSWORD_HASH is set (otherwise it renders children directly, so
// the open-source build has no gate). This is a soft gate to keep the beta
// private — not real security (it's a static client app). Remove after beta.
import { useState, type FormEvent, type ReactNode } from "react";

const GATE_HASH = import.meta.env.VITE_GATE_PASSWORD_HASH;
const STORAGE_KEY = "gate-ok";

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function Gate({ children }: { children: ReactNode }) {
  const gateEnabled = Boolean(GATE_HASH);
  const [unlocked, setUnlocked] = useState(
    () => !gateEnabled || sessionStorage.getItem(STORAGE_KEY) === "1",
  );
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if ((await sha256Hex(pw)) === GATE_HASH) {
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* ignore */
      }
      setUnlocked(true);
    } else {
      setError(true);
    }
  };

  return (
    <div className="gate">
      <form className="gate__card" onSubmit={submit}>
        <div className="gate__title">Private beta</div>
        <p className="gate__sub">Enter the access password to continue.</p>
        <input
          className="text-input"
          type="password"
          value={pw}
          autoFocus
          placeholder="Password"
          onChange={(e) => {
            setPw(e.target.value);
            setError(false);
          }}
        />
        {error && <div className="gate__error">Incorrect password.</div>}
        <button className="primary" type="submit">
          Enter
        </button>
      </form>
    </div>
  );
}
