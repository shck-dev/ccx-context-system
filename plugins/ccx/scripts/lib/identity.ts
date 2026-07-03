// The ONE place thread identity lives. (In the source repo this transform was copy-pasted into
// four files — start-ticket, worktree, record-session-ticket, statusline; here it has one home.)
// v1 = ticket_system "none": a thread id is a free-form topic normalized to a kebab slug.
// A linear/github adapter would extend THIS module (ticket-id pattern, display↔slug, branch
// extraction) — nothing else should ever re-implement identity.

export function slugify(topic: string): string {
  let slug = topic
    .trim()
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const last = slug.charCodeAt(slug.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) slug = slug.slice(0, -1); // truncation split a surrogate pair
  slug = slug.replace(/-+$/, "");
  return slug || "thread";
}

/** Loose identity: slugs that differ only by case/separators name the SAME thread
 *  (CP-1758 ≡ cp-1758 ≡ cp1758). Ticket adapters extend from here. */
export function normalizeForMatch(slug: string): string {
  return slug.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Graph/INDEX label for a slug. v1: the slug itself. */
export function displayName(slug: string): string {
  return slug;
}
