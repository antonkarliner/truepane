export interface BulkImportFile {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface BulkImportSlot {
  slideIndex: number;
  target: string;
  language: string;
}

export type BulkImportReason =
  | "explicit-path"
  | "filename-and-dimensions"
  | "bad-extension"
  | "unknown-target"
  | "unknown-locale"
  | "missing-slide-number"
  | "slide-out-of-range"
  | "ambiguous-target"
  | "duplicate-slot"
  | "occupied-slot";

export interface BulkImportAssignment {
  file: BulkImportFile;
  slot: BulkImportSlot;
  reason: "explicit-path" | "filename-and-dimensions";
  conflict?: "duplicate-slot" | "occupied-slot";
}

export interface BulkImportUnmapped {
  file: BulkImportFile;
  reason: Exclude<BulkImportReason, BulkImportAssignment["reason"] | "duplicate-slot" | "occupied-slot">;
}

export interface BulkImportProposal {
  assignments: BulkImportAssignment[];
  unmapped: BulkImportUnmapped[];
}

export interface BulkImportInventory {
  slideCount: number;
  targets: string[];
  languages: string[];
  occupied?: Set<string>;
}

export function bulkSlotKey(slot: BulkImportSlot): string {
  return `${slot.target}/${slot.language || "source"}/${slot.slideIndex}`;
}

const TARGET_TOKENS: Record<string, string[]> = {
  ios: ["ios", "iphone"],
  ipad: ["ipad"],
  android: ["android", "android-phone"],
  "android-tablet": ["android-tablet"],
};

const TARGET_DIMENSIONS: Record<string, [number, number][]> = {
  ios: [[1320, 2868], [1290, 2796], [1179, 2556]],
  ipad: [[2064, 2752], [2048, 2732]],
  android: [[1080, 2400], [1080, 2340]],
  "android-tablet": [[1600, 2560], [2560, 1600]],
};

function targetFromDimensions(file: BulkImportFile, allowed: string[]): string[] {
  return allowed.filter((target) =>
    (TARGET_DIMENSIONS[target] ?? []).some(([w, h]) =>
      (file.width === w && file.height === h) || (file.width === h && file.height === w),
    ),
  );
}

function targetFromName(name: string, allowed: string[]): string[] {
  const lower = name.toLowerCase();
  return allowed.filter((target) =>
    (TARGET_TOKENS[target] ?? [target]).some((token) =>
      new RegExp(`(^|[/_.-])${token.replace("-", "[-_]")}([/_.-]|$)`).test(lower),
    ),
  );
}

export function mapBulkImport(
  files: BulkImportFile[],
  inventory: BulkImportInventory,
): BulkImportProposal {
  const assignments: BulkImportAssignment[] = [];
  const unmapped: BulkImportUnmapped[] = [];
  const claimed = new Set<string>();
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  for (const file of ordered) {
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
      unmapped.push({ file, reason: "bad-extension" });
      continue;
    }
    const parts = file.name.replace(/\\/g, "/").split("/").filter(Boolean);
    const basename = parts[parts.length - 1] ?? file.name;
    const number = basename.match(/^(\d{1,3})(?:[-_. ]|$)/)?.[1];
    if (!number) {
      unmapped.push({ file, reason: "missing-slide-number" });
      continue;
    }
    const slideIndex = Number(number) - 1;
    if (slideIndex < 0 || slideIndex >= inventory.slideCount) {
      unmapped.push({ file, reason: "slide-out-of-range" });
      continue;
    }

    let target: string | undefined;
    let language = "";
    let reason: BulkImportAssignment["reason"] = "filename-and-dimensions";
    if (parts.length >= 3 && inventory.targets.includes(parts[0])) {
      target = parts[0];
      const locale = parts[1];
      if (locale !== "source" && !inventory.languages.includes(locale)) {
        unmapped.push({ file, reason: "unknown-locale" });
        continue;
      }
      language = locale === "source" ? "" : locale;
      reason = "explicit-path";
    } else if (parts.length >= 3 && !inventory.targets.includes(parts[0])) {
      unmapped.push({ file, reason: "unknown-target" });
      continue;
    } else {
      const nameTargets = targetFromName(file.name, inventory.targets);
      const dimTargets = targetFromDimensions(file, inventory.targets);
      const candidates = nameTargets.length ? nameTargets : dimTargets;
      if (candidates.length !== 1) {
        unmapped.push({ file, reason: "ambiguous-target" });
        continue;
      }
      target = candidates[0];
      language = inventory.languages.find((code) =>
        new RegExp(`(^|[/_.-])${code}([/_.-]|$)`, "i").test(file.name),
      ) ?? "";
    }

    if (!target) {
      unmapped.push({ file, reason: "ambiguous-target" });
      continue;
    }
    const slot = { slideIndex, target, language };
    const key = bulkSlotKey(slot);
    const conflict = claimed.has(key)
      ? "duplicate-slot"
      : inventory.occupied?.has(key)
        ? "occupied-slot"
        : undefined;
    assignments.push({ file, slot, reason, conflict });
    claimed.add(key);
  }
  return { assignments, unmapped };
}
