import { describe, expect, it } from "vitest";
import {
  AGENTS_MANAGED_BODY,
  AGENTS_MANAGED_CLOSE,
  AGENTS_MANAGED_OPEN,
  applyAgentsMd,
} from "./agents-md.js";

describe("applyAgentsMd", () => {
  it("creates a fresh file when absent", () => {
    const result = applyAgentsMd(null);
    expect(result.changed).toBe(true);
    expect(result.content).toContain(AGENTS_MANAGED_OPEN);
    expect(result.content).toContain(AGENTS_MANAGED_BODY);
    expect(result.content).toContain(AGENTS_MANAGED_CLOSE);
  });

  it("appends the section when present without markers", () => {
    const existing = "# My Project\n\nSome docs here.\n";
    const result = applyAgentsMd(existing);
    expect(result.changed).toBe(true);
    expect(result.content.startsWith(existing)).toBe(true);
    expect(result.content).toContain(AGENTS_MANAGED_OPEN);
  });

  it("replaces the section in place when markers are present", () => {
    const existing = `# My Project\n\n${AGENTS_MANAGED_OPEN}\nstale body\n${AGENTS_MANAGED_CLOSE}\n\nmore docs\n`;
    const result = applyAgentsMd(existing);
    expect(result.changed).toBe(true);
    expect(result.content).toContain(AGENTS_MANAGED_BODY);
    expect(result.content).not.toContain("stale body");
    expect(result.content).toContain("more docs");
    expect(result.content.startsWith("# My Project\n\n")).toBe(true);
  });

  it("is idempotent -- a second apply on its own output reports unchanged", () => {
    const first = applyAgentsMd(null);
    const second = applyAgentsMd(first.content);
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  it("appends a fresh well-formed block when the open marker has no matching close", () => {
    const existing = `# Project\n\n${AGENTS_MANAGED_OPEN}\nunterminated\n`;
    const result = applyAgentsMd(existing);
    expect(result.changed).toBe(true);
    expect(result.content).toContain(AGENTS_MANAGED_CLOSE);
  });
});
