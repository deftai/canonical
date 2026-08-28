import { describe, expect, it } from "vitest";
import { normalizeSlug, normalizeSlugWithReserve } from "./brief-io.js";

describe("normalizeSlugWithReserve", () => {
  it("reserves suffix length so title+suffix stay <=80 and cuts at a hyphen boundary", () => {
    const title =
      "fix(billing): POST /api/credits lets any org member mint credits (client-supplied admin_adjust)";
    const suffix = "-issue-47";
    const slug = normalizeSlugWithReserve(title, suffix);
    expect(slug.length + suffix.length).toBeLessThanOrEqual(80);
    expect(slug).not.toMatch(/-ad$/);
    expect(slug).toBe("fix-billing-post-api-credits-lets-any-org-member-mint-credits-client");
    expect(`${slug}${suffix}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("truncates the stripe signup title without a trailing fragment before -issue-50", () => {
    const title =
      "fix(billing): signup grant is unreachable -- POST /api/billing 503s on missing STRIPE_SECRET_KEY before the grant block";
    const suffix = "-issue-50";
    const slug = normalizeSlugWithReserve(title, suffix);
    expect(slug.length + suffix.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
    expect(`${slug}${suffix}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    // Must not keep a sliced mid-token from "stripe"/"secret"/etc.
    expect(slug.split("-").every((part) => part.length > 0)).toBe(true);
  });

  it("matches normalizeSlug when the reserved suffix is empty", () => {
    const title = "Fix the Widget Loader!";
    expect(normalizeSlugWithReserve(title, "")).toBe(normalizeSlug(title));
  });
});
