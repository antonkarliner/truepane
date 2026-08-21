export type Representation = "html" | "markdown";

type MediaRange = {
  type: string;
  subtype: string;
  parameters: Record<string, string>;
  quality: number;
  order: number;
  specificity: number;
};

const REPRESENTATIONS: Array<{
  representation: Representation;
  type: string;
  subtype: string;
  parameters: Record<string, string>;
}> = [
  { representation: "html", type: "text", subtype: "html", parameters: { charset: "utf-8" } },
  { representation: "markdown", type: "text", subtype: "markdown", parameters: { charset: "utf-8" } },
];
const TOKEN_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function parseQuality(value: string): number | null {
  if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)) return null;
  return Number(value);
}

function splitOutsideQuotes(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (quoted && character === "\\") {
      current += character;
      escaped = true;
    } else if (character === '"') {
      current += character;
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts;
}

function parseParameterValue(rawValue: string): string | null {
  const value = rawValue.trim();
  if (TOKEN_PATTERN.test(value)) return value;
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return null;
}

function parseParameter(rawParameter: string): { name: string; value: string } | null {
  const separator = rawParameter.indexOf("=");
  if (separator <= 0) return null;
  const name = rawParameter.slice(0, separator).trim().toLowerCase();
  const value = parseParameterValue(rawParameter.slice(separator + 1));
  return TOKEN_PATTERN.test(name) && value !== null ? { name, value } : null;
}

function parseAccept(accept: string): MediaRange[] {
  const ranges: MediaRange[] = [];
  for (const [order, rawRange] of splitOutsideQuotes(accept, ",").entries()) {
    const [rawMediaType, ...rawParameters] = splitOutsideQuotes(rawRange, ";");
    const [type, subtype, extra] = rawMediaType.trim().toLowerCase().split("/");
    if (
      !type
      || !subtype
      || extra
      || (type !== "*" && !TOKEN_PATTERN.test(type))
      || (subtype !== "*" && !TOKEN_PATTERN.test(subtype))
      || (type === "*" && subtype !== "*")
    ) continue;

    let quality = 1;
    let valid = true;
    let weightSeen = false;
    const parameters: Record<string, string> = {};
    for (const rawParameter of rawParameters) {
      const parameter = parseParameter(rawParameter.trim());
      if (!parameter) {
        valid = false;
        break;
      }
      const { name, value } = parameter;
      if (name === "q") {
        const parsed = parseQuality(value);
        if (parsed === null || weightSeen) {
          valid = false;
          break;
        }
        quality = parsed;
        weightSeen = true;
      } else if (!weightSeen) {
        if (Object.prototype.hasOwnProperty.call(parameters, name)) {
          valid = false;
          break;
        }
        parameters[name] = name === "charset" ? value.toLowerCase() : value;
      }
    }
    if (!valid) continue;

    ranges.push({
      type,
      subtype,
      parameters,
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
        && Object.entries(range.parameters).every(
          ([name, value]) => candidate.parameters[name] === value,
        )
      ))
      .sort((left, right) => (
        right.specificity - left.specificity
        || Object.keys(right.parameters).length - Object.keys(left.parameters).length
        || left.order - right.order
      ));
    const match = matches[0];
    return {
      representation: candidate.representation,
      quality: match?.quality ?? 0,
      specificity: match?.specificity ?? -1,
      parameterSpecificity: match ? Object.keys(match.parameters).length : -1,
      order: match?.order ?? Number.POSITIVE_INFINITY,
      serverOrder,
    };
  })
    .filter((candidate) => candidate.quality > 0)
    .sort((left, right) => (
      right.quality - left.quality
      || right.specificity - left.specificity
      || right.parameterSpecificity - left.parameterSpecificity
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
