export type Representation = "html" | "markdown";

type MediaRange = {
  type: string;
  subtype: string;
  quality: number;
  order: number;
  specificity: number;
};

const REPRESENTATIONS: Array<{ representation: Representation; type: string; subtype: string }> = [
  { representation: "html", type: "text", subtype: "html" },
  { representation: "markdown", type: "text", subtype: "markdown" },
];

function parseQuality(value: string): number | null {
  if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)) return null;
  return Number(value);
}

function parseAccept(accept: string): MediaRange[] {
  const ranges: MediaRange[] = [];
  for (const [order, rawRange] of accept.split(",").entries()) {
    const [rawMediaType, ...rawParameters] = rawRange.split(";");
    const [type, subtype, extra] = rawMediaType.trim().toLowerCase().split("/");
    if (!type || !subtype || extra || (type === "*" && subtype !== "*")) continue;

    let quality = 1;
    let valid = true;
    for (const rawParameter of rawParameters) {
      const [rawName, rawValue, extraValue] = rawParameter.trim().split("=");
      if (rawName?.toLowerCase() !== "q") continue;
      const parsed = !extraValue && rawValue ? parseQuality(rawValue.trim()) : null;
      if (parsed === null) {
        valid = false;
        break;
      }
      quality = parsed;
    }
    if (!valid) continue;

    ranges.push({
      type,
      subtype,
      quality,
      order,
      specificity: type === "*" ? 0 : subtype === "*" ? 1 : 2,
    });
  }
  return ranges;
}

export function selectRepresentation(accept: string | null): Representation | null {
  if (!accept?.trim()) return "html";
  const ranges = parseAccept(accept);

  const candidates = REPRESENTATIONS.map((candidate, serverOrder) => {
    const matches = ranges
      .filter((range) => (
        (range.type === "*" || range.type === candidate.type)
        && (range.subtype === "*" || range.subtype === candidate.subtype)
      ))
      .sort((left, right) => right.specificity - left.specificity || left.order - right.order);
    const match = matches[0];
    return {
      representation: candidate.representation,
      quality: match?.quality ?? 0,
      specificity: match?.specificity ?? -1,
      order: match?.order ?? Number.POSITIVE_INFINITY,
      serverOrder,
    };
  })
    .filter((candidate) => candidate.quality > 0)
    .sort((left, right) => (
      right.quality - left.quality
      || right.specificity - left.specificity
      || left.order - right.order
      || left.serverOrder - right.serverOrder
    ));

  return candidates[0]?.representation ?? null;
}

export function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("Vary")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
  if (!existing.some((item) => item.toLowerCase() === value.toLowerCase())) {
    existing.push(value);
  }
  headers.set("Vary", existing.join(", "));
}
