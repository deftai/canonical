import { describe, expect, it } from "vitest";
import {
  CLI_MODULE_VERBS,
  dispatch,
  registeredVerbs,
  resolveCanonicalVerb,
  VERB_ALIASES,
} from "./dispatch.js";

describe("verb registry", () => {
  it("resolves every canonical stem to itself", () => {
    for (const verb of CLI_MODULE_VERBS) {
      expect(resolveCanonicalVerb(verb)).toBe(verb);
    }
  });

  it("resolves every alias to a registered stem", () => {
    for (const [alias, stem] of Object.entries(VERB_ALIASES)) {
      expect(resolveCanonicalVerb(alias)).toBe(stem);
      expect((CLI_MODULE_VERBS as readonly string[]).includes(stem)).toBe(true);
    }
  });

  it("returns null for unknown verbs", () => {
    expect(resolveCanonicalVerb("nope")).toBeNull();
  });

  it("registeredVerbs has no duplicates", () => {
    const verbs = registeredVerbs();
    expect(new Set(verbs).size).toBe(verbs.length);
  });
});

describe("dispatch", () => {
  const capture = () => {
    const buf = { out: "", err: "" };
    return {
      io: {
        writeOut: (t: string) => {
          buf.out += t;
        },
        writeErr: (t: string) => {
          buf.err += t;
        },
      },
      out: () => buf.out,
      err: () => buf.err,
    };
  };

  it("prints help on no args with exit 0", async () => {
    const c = capture();
    expect(await dispatch([], c.io)).toBe(0);
    expect(c.out()).toContain("Verbs:");
  });

  it("prints version", async () => {
    const c = capture();
    expect(await dispatch(["--version"], c.io)).toBe(0);
    expect(c.out()).toMatch(/canon \d/);
  });

  it("unknown verb exits 2", async () => {
    const c = capture();
    expect(await dispatch(["definitely-not-a-verb"], c.io)).toBe(2);
    expect(c.err()).toContain("unknown verb");
  });

  it("routes space-separated subcommand form", async () => {
    // scope new -> scope:new -> scope-new (stub exits 2 with its own message,
    // proving the route resolved rather than 'unknown verb')
    const c = capture();
    const code = await dispatch(["scope", "new"], c.io);
    expect(code).toBeTypeOf("number");
    expect(c.err()).not.toContain("unknown verb");
  });
});
