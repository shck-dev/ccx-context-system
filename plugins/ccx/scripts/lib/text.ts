// Render-time guards for "one-liner" fields — the INDEX/threads dashboards stay a single pane
// even when a STATE's summary/Status has grown into a paragraph (detail belongs in the STATE).

/** Clip to at most `max` chars; overlong input is cut at max-1 (right-trimmed) + `…`. */
export function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}
