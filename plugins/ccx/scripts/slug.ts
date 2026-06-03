// CLI wrapper over identity.slugify — start-thread normalizes its topic through this, so skills
// and scripts share ONE identity implementation (never re-implement slugging in skill prose).
import { slugify } from "./lib/identity";

const topic = process.argv.slice(2).join(" ");
if (!topic.trim()) {
  console.error("usage: bun slug.ts <topic words…>");
  process.exit(1);
}
console.log(slugify(topic));
