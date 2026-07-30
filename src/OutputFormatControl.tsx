import { useEffect, useState, type KeyboardEvent } from "react";
import { Field } from "./components";
import { PLATFORMS, dimForSettings } from "./core/render";
import {
  BUILTIN_OUTPUTS,
  normalizeOutput,
  validateCustomOutputDimensions,
} from "./core/output";
import type { Settings } from "./core/types";

export function OutputFormatControl({
  settings,
  updateSettings,
}: {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
}) {
  const platform = settings.platform || "ios";
  const outputId = settings.output?.id ?? platform;
  const dim = dimForSettings(settings);
  const customOutput = settings.output?.kind === "custom" ? settings.output : null;
  const [width, setWidth] = useState(String(customOutput?.width ?? dim.W));
  const [height, setHeight] = useState(String(customOutput?.height ?? dim.H));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!customOutput) return;
    setWidth(String(customOutput.width));
    setHeight(String(customOutput.height));
  }, [customOutput?.width, customOutput?.height]);

  const selectOutput = (id: string) => {
    setError("");
    const builtin = BUILTIN_OUTPUTS.find((output) => output.id === id);
    if (builtin?.kind === "native") {
      updateSettings({ platform: builtin.frame, output: undefined });
      return;
    }
    if (builtin) {
      updateSettings({
        platform: builtin.frame,
        targets: Array.from(new Set([...(settings.targets ?? []), builtin.frame])),
        output: { ...builtin },
      });
      return;
    }
    const initialWidth = customOutput?.width ?? dim.W;
    const initialHeight = customOutput?.height ?? dim.H;
    setWidth(String(initialWidth));
    setHeight(String(initialHeight));
    updateSettings({
      output: normalizeOutput({
        id: "custom",
        label: "Custom output",
        width: initialWidth,
        height: initialHeight,
        store: settings.output?.store ?? "playstore",
        frame: platform,
      }, platform),
    });
  };

  const commitDimensions = () => {
    if (!customOutput) return;
    const result = validateCustomOutputDimensions(width, height);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError("");
    updateSettings({
      output: normalizeOutput({ ...customOutput, ...result }, platform),
    });
  };

  const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.currentTarget.blur();
  };

  const selectFrame = (frame: string) => {
    if (!customOutput) return;
    updateSettings({
      platform: frame,
      targets: Array.from(new Set([...(settings.targets ?? []), frame])),
      output: { ...customOutput, frame },
    });
  };

  return (
    <div className="format-control">
      <Field label="Format">
        <select
          className="text-input"
          aria-label="Output format"
          value={outputId}
          onChange={(event) => selectOutput(event.target.value)}
        >
          {BUILTIN_OUTPUTS.map((output) => (
            <option key={output.id} value={output.id}>
              {output.label.replace(" screenshot", "")} · {output.width} × {output.height}
            </option>
          ))}
          <option value="custom">Custom size…</option>
        </select>
      </Field>

      {customOutput && (
        <>
          <div className="output-size-grid">
            <Field label="Width">
              <input
                className="text-input"
                type="number"
                inputMode="numeric"
                min="320"
                max="8192"
                value={width}
                onChange={(event) => setWidth(event.target.value)}
                onBlur={commitDimensions}
                onKeyDown={commitOnEnter}
              />
            </Field>
            <Field label="Height">
              <input
                className="text-input"
                type="number"
                inputMode="numeric"
                min="320"
                max="8192"
                value={height}
                onChange={(event) => setHeight(event.target.value)}
                onBlur={commitDimensions}
                onKeyDown={commitOnEnter}
              />
            </Field>
          </div>
          <Field label="Device frame" hint="The frame can differ from the custom canvas size.">
            <select
              className="text-input"
              aria-label="Custom output device frame"
              value={customOutput.frame}
              onChange={(event) => selectFrame(event.target.value)}
            >
              {PLATFORMS.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
              ))}
            </select>
          </Field>
          {error && <div className="field__hint output-size-error" role="alert">{error}</div>}
        </>
      )}
    </div>
  );
}
