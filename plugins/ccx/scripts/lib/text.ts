// Render-time guards for "one-liner" fields — the INDEX/threads dashboards stay a single pane
// even when a STATE's summary/Status has grown into a paragraph (detail belongs in the STATE).

/** Clip to at most `max` chars; overlong input is cut at max-1 (right-trimmed) + `…`.
 *  Never splits a surrogate pair — a cut landing inside one drops the dangling half. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // lone high surrogate
  return cut.trimEnd() + "…";
}
