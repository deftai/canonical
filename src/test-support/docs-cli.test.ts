import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CLI_FLAG_TABLE,
  extractAgentActionsSection,
  extractCollectionFeedbackSection,
  extractDocsCliUsage,
  extractPhase8,
  extractUnreleased,
  extractUserDialogueSection,
  hasForbiddenNameFlag,
} from "./docs-cli.js";
import { cleanupTempDirs, tempDir } from "./temp.js";

afterAll(() => cleanupTempDirs());

describe("docs-cli helpers", () => {
  it("FLOW-5: extractDocsCliUsage pairs verbs and flags from a temp content dir", () => {
    const dir = tempDir("docs-cli-");
    writeFileSync(
      join(dir, "sample.md"),
      [
        "### `collection:status`",
        "**Does:** Print status. `--live` refreshes when credentials exist.",
        "",
        "### `collection:opt-in`",
        "**Does:** `-- --confirm [--scopes=usage] [--email=…]`. Prefer `collection:identity --update`.",
        "",
        "| Status | `task -x collection:status` (`--json` when needed) |",
        "",
        "`task -x feedback -- --kind=bug --disclosure-accepted`",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(join(dir, "other.md"), "# no collection verbs\n", "utf8");

    const { verbs, pairs } = extractDocsCliUsage(dir);
    expect(verbs).toEqual([
      "collection:identity",
      "collection:opt-in",
      "collection:status",
      "feedback",
    ]);
    expect(pairs).toContainEqual({
      verb: "collection:status",
      flag: "live",
      file: "sample.md",
    });
    expect(pairs).toContainEqual({
      verb: "collection:opt-in",
      flag: "scopes",
      file: "sample.md",
    });
    expect(pairs).toContainEqual({
      verb: "collection:opt-in",
      flag: "confirm",
      file: "sample.md",
    });
    // Foreign-verb backtick on the opt-in Does line must not attach --update to opt-in.
    expect(pairs).not.toContainEqual({
      verb: "collection:opt-in",
      flag: "update",
      file: "sample.md",
    });
    expect(pairs).toContainEqual({
      verb: "feedback",
      flag: "disclosure-accepted",
      file: "sample.md",
    });
    expect(pairs).toContainEqual({
      verb: "collection:identity",
      flag: "update",
      file: "sample.md",
    });

    for (const p of pairs.filter((x) => x.flag !== "live" && x.flag !== "scopes")) {
      const table = CLI_FLAG_TABLE[p.verb];
      expect(table, `CLI table missing verb ${p.verb}`).toBeDefined();
      expect(table?.has(p.flag), `${p.verb} --${p.flag}`).toBe(true);
    }
  });

  it("extracts User dialogue, Agent actions, Collection & Feedback, Phase 8, Unreleased", () => {
    const feedback = [
      "# Feedback",
      "",
      "## User dialogue (say this to the human)",
      "",
      "Say this only.",
      "",
      "---",
      "",
      "## Agent actions (silent)",
      "",
      "`task -x collection:decline`",
      "",
    ].join("\n");
    expect(extractUserDialogueSection(feedback)).toBe(
      "## User dialogue (say this to the human)\n\nSay this only.\n",
    );
    expect(extractAgentActionsSection(feedback)).toMatch(/^## Agent actions/);
    expect(extractAgentActionsSection(feedback)).toContain("collection:decline");

    const tasks = [
      "## Earlier",
      "",
      "## Collection & Feedback",
      "",
      "### `collection:status`",
      "**Does:** status line",
      "",
      "## Out of Scope",
      "",
      "skip",
      "",
    ].join("\n");
    const collection = extractCollectionFeedbackSection(tasks);
    expect(collection).toMatch(/^## Collection & Feedback/);
    expect(collection).toContain("collection:status");
    expect(collection).not.toContain("## Out of Scope");

    const manual = [
      "## Phase 7 — other",
      "",
      "## Phase 8 — Collection",
      "",
      "```bash",
      "task -x collection:status",
      "```",
      "",
      "---",
      "",
      "### Pass criteria summary",
      "",
      "| 1 | ok |",
      "",
    ].join("\n");
    const phase8 = extractPhase8(manual);
    expect(phase8).toMatch(/^## Phase 8/);
    expect(phase8).toContain("collection:status");
    expect(phase8).not.toContain("Pass criteria");

    expect(extractUnreleased("# Changelog\n\n## [0.1.0]\n\n- x\n")).toBeNull();
    const unreleased = extractUnreleased(
      "# Changelog\n\n## [Unreleased]\n\n- contact not stored locally\n\n## [0.1.0]\n\n- x\n",
    );
    expect(unreleased).toMatch(/^## \[Unreleased\]/);
    expect(unreleased).toContain("contact not stored locally");
    expect(unreleased).not.toContain("## [0.1.0]");
  });

  it("hasForbiddenNameFlag matches --name but not --first-name / --last-name", () => {
    expect(hasForbiddenNameFlag("`--name=…`")).toBe(true);
    expect(hasForbiddenNameFlag("[--name=…]")).toBe(true);
    expect(hasForbiddenNameFlag("--first-name=Ada --last-name=Lovelace")).toBe(false);
    expect(hasForbiddenNameFlag("no flags here")).toBe(false);
  });

  it("FLOW-1 pin fixture matches extractUserDialogueSection on content/feedback.md", () => {
    const root = process.cwd();
    const feedback = readFileSync(join(root, "content/feedback.md"), "utf8");
    const pin = readFileSync(
      join(root, "src/test-support/feedback-user-dialogue.fixture.txt"),
      "utf8",
    );
    expect(extractUserDialogueSection(feedback)).toBe(pin);
  });
});
