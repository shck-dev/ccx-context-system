// The ONE place thread identity lives. (In the source repo this transform was copy-pasted into
// four files — start-ticket, worktree, record-session-ticket, statusline; here it has one home.)
// v1 = ticket_system "none": a thread id is a free-form topic normalized to a kebab slug.
// A linear/github adapter would extend THIS module (ticket-id pattern, display↔slug, branch
// extraction) — nothing else should ever re-implement identity.

export function slugify(topic: string): string {
  const slug = topic
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "thread";
}

/** Loose identity: slugs that differ only by case/separators name the SAME thread
 *  (CP-1758 ≡ cp-1758 ≡ cp1758). Ticket adapters extend from here. */
export function normalizeForMatch(slug: string): string {
  return slug.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Graph/INDEX label for a slug. v1: the slug itself. */
export function displayName(slug: string): string {
  return slug;
}
