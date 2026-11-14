import type { ToolchainRequirement } from "./model";
export type Version = [number, number, number];
interface Interval {
  low: Version;
  high?: Version;
  lowInclusive: boolean;
  highInclusive: boolean;
  exclude: Version[];
}
export function numericVersion(text: string): Version | undefined {
  const token = text.match(
    /(?:^|\b)(?:go|v)?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?=$|\s|\[|\)|["'])/,
  );
  if (!token) return undefined;
  return [Number(token[1]), Number(token[2] ?? 0), Number(token[3] ?? 0)];
}
export const compare = (a: Version, b: Version): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const any = (): Interval => ({
  low: [0, 0, 0],
  lowInclusive: true,
  highInclusive: false,
  exclude: [],
});
function intersect(a: Interval, b: Interval): Interval | undefined {
  const lowCmp = compare(a.low, b.low);
  const low = lowCmp > 0 ? a.low : b.low;
  const lowInclusive =
    lowCmp === 0
      ? a.lowInclusive && b.lowInclusive
      : lowCmp > 0
        ? a.lowInclusive
        : b.lowInclusive;
  const highCmp = a.high && b.high ? compare(a.high, b.high) : a.high ? -1 : 1;
  const high = !a.high
    ? b.high
    : !b.high
      ? a.high
      : highCmp < 0
        ? a.high
        : b.high;
  const highInclusive = !a.high
    ? b.highInclusive
    : !b.high
      ? a.highInclusive
      : highCmp === 0
        ? a.highInclusive && b.highInclusive
        : highCmp < 0
          ? a.highInclusive
          : b.highInclusive;
  if (
    high &&
    (compare(low, high) > 0 ||
      (compare(low, high) === 0 && (!lowInclusive || !highInclusive)))
  )
    return undefined;
  const exclude = [...a.exclude, ...b.exclude];
  if (
    high &&
    compare(low, high) === 0 &&
    exclude.some((v) => compare(v, low) === 0)
  )
    return undefined;
  return { low, lowInclusive, high, highInclusive, exclude };
}
function atom(input: string, partialPrefix: boolean): Interval[] | undefined {
  const match = input
    .trim()
    .match(
      /^(>=|<=|>|<|===|==|=|!=|~=|~|\^)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i,
    );
  if (!match) return /^(?:\*|x)$/i.test(input.trim()) ? [any()] : undefined;
  let op = match[1] || "";
  if (op === "===") return undefined;
  const count = match[3] === undefined ? 1 : match[4] === undefined ? 2 : 3;
  const wild =
    match[3] === "*" || match[3] === "x"
      ? 1
      : match[4] === "*" || match[4] === "x"
        ? 2
        : undefined;
  const version: Version = [
    Number(match[2]),
    Number(match[3]) || 0,
    Number(match[4]) || 0,
  ];
  if (
    (op === "" || op === "=" || op === "==") &&
    (wild !== undefined || (partialPrefix && count < 3))
  ) {
    const prefix = wild ?? count;
    const high: Version = [...version];
    high[prefix - 1]++;
    for (let i = prefix; i < 3; i++) high[i] = 0;
    return [{ ...any(), low: version, high }];
  }
  if (wild !== undefined) return undefined;
  if (op === "~=" && count < 2) return undefined;
  if (op === "~" || op === "~=" || op === "^") {
    const high: Version = [...version];
    let index =
      op === "~="
        ? count - 2
        : op === "~"
          ? Math.min(1, count - 1)
          : version[0] > 0
            ? 0
            : version[1] > 0
              ? 1
              : count - 1;
    index = Math.max(0, index);
    high[index]++;
    for (let i = index + 1; i < 3; i++) high[i] = 0;
    return [{ ...any(), low: version, high }];
  }
  if (op === "!=") return [{ ...any(), exclude: [version] }];
  if (op === ">=") return [{ ...any(), low: version }];
  if (op === ">") return [{ ...any(), low: version, lowInclusive: false }];
  if (op === "<=") return [{ ...any(), high: version, highInclusive: true }];
  if (op === "<") return [{ ...any(), high: version }];
  op = "=";
  return [{ ...any(), low: version, high: version, highInclusive: true }];
}
export function intervals(
  expression: string,
  prefix = false,
): Interval[] | undefined {
  if (expression.length > 500) return undefined;
  const alternatives = expression.trim().split(/\s*\|\|\s*/);
  if (alternatives.length > 20) return undefined;
  const results: Interval[] = [];
  for (const alternative of alternatives) {
    const normalized = alternative.replace(
      /(>=|<=|!=|==|~=|>|<|=|~|\^)\s+/g,
      "$1",
    );
    const parts = normalized.split(/\s*,\s*|\s+/).filter(Boolean);
    if (!parts.length) return undefined;
    let current: Interval[] = [any()];
    for (const part of parts) {
      const values = atom(part, prefix || !/[<>=!~^]/.test(part));
      if (!values) return undefined;
      current = current.flatMap((a) =>
        values.flatMap((b) => {
          const result = intersect(a, b);
          return result ? [result] : [];
        }),
      );
    }
    results.push(...current);
  }
  return results;
}
function contains(v: Version, range: Interval): boolean {
  return (
    (compare(v, range.low) > 0 ||
      (compare(v, range.low) === 0 && range.lowInclusive)) &&
    (!range.high ||
      compare(v, range.high) < 0 ||
      (compare(v, range.high) === 0 && range.highInclusive)) &&
    !range.exclude.some((e) => compare(v, e) === 0)
  );
}
export function satisfies(
  version: string,
  requirement: ToolchainRequirement,
): boolean | undefined {
  const parsed = numericVersion(version);
  if (!parsed) return undefined;
  if (requirement.syntax === "dotnet") {
    const requested = numericVersion(requirement.expression);
    if (!requested) return undefined;
    const option = String(requirement.options?.rollForward ?? "patch");
    if (
      ![
        "disable",
        "patch",
        "latestPatch",
        "feature",
        "latestFeature",
        "minor",
        "latestMinor",
        "major",
        "latestMajor",
      ].includes(option)
    )
      return undefined;
    if (option === "disable") return compare(parsed, requested) === 0;
    if (compare(parsed, requested) < 0) return false;
    if (["patch", "latestPatch"].includes(option))
      return (
        parsed[0] === requested[0] &&
        parsed[1] === requested[1] &&
        Math.floor(parsed[2] / 100) === Math.floor(requested[2] / 100)
      );
    if (["feature", "latestFeature"].includes(option))
      return parsed[0] === requested[0] && parsed[1] === requested[1];
    if (["minor", "latestMinor"].includes(option))
      return parsed[0] === requested[0];
    return true;
  }
  const range = intervals(
    requirement.expression,
    requirement.syntax === "prefix",
  );
  if (!range) return undefined;
  return range.some((r) => contains(parsed, r));
}
export function conflicting(requirements: ToolchainRequirement[]): boolean {
  let current: Interval[] = [any()];
  for (const requirement of requirements.filter(
    (r) =>
      r.kind === "version" &&
      r.role === "required" &&
      !r.profile &&
      r.syntax !== "dotnet",
  )) {
    const next = intervals(
      requirement.expression,
      requirement.syntax === "prefix",
    );
    if (!next) continue;
    current = current.flatMap((a) =>
      next.flatMap((b) => {
        const result = intersect(a, b);
        return result ? [result] : [];
      }),
    );
    if (!current.length) return true;
  }
  return false;
}
