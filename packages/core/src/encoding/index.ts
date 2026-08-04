import { readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { GateResult } from "@canonpack/types";
import { type GitRunner, stagedFiles, trackedFiles } from "../git/index.js";

/**
 * verify:encoding (content/canonical-tasks.md): scan tracked (or staged-only)
 * text files for a leading BOM, U+FFFD replacement characters, and classic
 * mojibake byte sequences; additionally flag non-ASCII "smart" punctuation in
 * machine-parsed files (CHANGELOG.md, ROADMAP.md) where it silently breaks
 * exact-match tooling. Pure function of the filesystem + injectable git seam.
 */

/** U+FFFD REPLACEMENT CHARACTER -- the universal decode-failure marker. */
const REPLACEMENT_CHAR = "�";

/** UTF-8 BOM byte sequence (EF BB BF). */
const UTF8_BOM: readonly number[] = [0xef, 0xbb, 0xbf];

/**
 * Classic "UTF-8 bytes decoded as a single-byte codepage" corruption
 * sequences. Two families:
 *  - utf8-as-latin1: a UTF-8-encoded Latin-1-range codepoint (0xC3 0x80-0xBF)
 *    re-decoded one byte at a time renders as "Ã" + one extra character.
 *  - cp1252-as-utf8: a UTF-8-encoded "smart" punctuation codepoint from the
 *    U+2000 block, when its bytes are decoded as Windows-1252 and re-saved,
 *    then read back as UTF-8, renders as "â€" + one extra character.
 */
export const MOJIBAKE_PATTERNS: ReadonlyMap<string, string> = new Map([
  ["Ã©", "U+00E9 (é) mojibake: utf8-as-latin1"],
  ["Ã¨", "U+00E8 (è) mojibake: utf8-as-latin1"],
  ["Ã ", "U+00E0 (à) mojibake: utf8-as-latin1"],
  ["Ã¢", "U+00E2 (â) mojibake: utf8-as-latin1"],
  ["Ã®", "U+00EE (î) mojibake: utf8-as-latin1"],
  ["Ã¯", "U+00EF (ï) mojibake: utf8-as-latin1"],
  ["Ã´", "U+00F4 (ô) mojibake: utf8-as-latin1"],
  ["Ã¹", "U+00F9 (ù) mojibake: utf8-as-latin1"],
  ["Ã»", "U+00FB (û) mojibake: utf8-as-latin1"],
  ["Ã±", "U+00F1 (ñ) mojibake: utf8-as-latin1"],
  ["Ã§", "U+00E7 (ç) mojibake: utf8-as-latin1"],
  ["Ã¼", "U+00FC (ü) mojibake: utf8-as-latin1"],
  ["Ã¶", "U+00F6 (ö) mojibake: utf8-as-latin1"],
  ["Ã¤", "U+00E4 (ä) mojibake: utf8-as-latin1"],
  ["â€™", "U+2019 (’) mojibake: cp1252-as-utf8"],
  ["â€˜", "U+2018 (‘) mojibake: cp1252-as-utf8"],
  ["â€œ", "U+201C (“) mojibake: cp1252-as-utf8"],
  ["â€\x9d", "U+201D (”) mojibake: cp1252-as-utf8"],
  ["â€“", "U+2013 (–) mojibake: cp1252-as-utf8"],
  ["â€”", "U+2014 (—) mojibake: cp1252-as-utf8"],
  ["â€¦", "U+2026 (…) mojibake: cp1252-as-utf8"],
  ["â€¢", "U+2022 (•) mojibake: cp1252-as-utf8"],
  ["Â©", "U+00A9 (©) mojibake: cp1252-as-utf8"],
  ["Â®", "U+00AE (®) mojibake: cp1252-as-utf8"],
  ["Â°", "U+00B0 (°) mojibake: cp1252-as-utf8"],
  ["Â§", "U+00A7 (§) mojibake: cp1252-as-utf8"],
]);

/** Non-ASCII punctuation flagged only inside machine-parsed files. */
export const NON_ASCII_PUNCTUATION: ReadonlyMap<string, string> = new Map([
  ["‘", "U+2018 left single quotation mark"],
  ["’", "U+2019 right single quotation mark"],
  ["“", "U+201C left double quotation mark"],
  ["”", "U+201D right double quotation mark"],
  ["–", "U+2013 en dash"],
  ["—", "U+2014 em dash"],
  ["…", "U+2026 horizontal ellipsis"],
  ["→", "U+2192 rightwards arrow"],
  ["←", "U+2190 leftwards arrow"],
  ["↔", "U+2194 left right arrow"],
  ["⇒", "U+21D2 rightwards double arrow"],
]);

/** Filenames whose content is machine-parsed and must stay plain-ASCII punctuation. */
const MACHINE_PARSED_BASENAMES: ReadonlySet<string> = new Set(["CHANGELOG.md", "ROADMAP.md"]);

/** Path segments never scanned, even if somehow tracked. */
const SKIP_SEGMENTS: ReadonlySet<string> = new Set([".git", "node_modules", "dist"]);

export interface EncodingFinding {
  readonly path: string;
  readonly line: number;
  readonly label: string;
  readonly context: string;
}

export interface EvaluateEncodingOptions {
  /** Scan staged files only (index vs HEAD) instead of all tracked files. */
  readonly staged?: boolean;
  /** Injectable git seam (tests). Defaults to the real `git` binary. */
  readonly runner?: GitRunner;
}

export interface EvaluateEncodingResult extends GateResult {
  readonly findings: readonly EncodingFinding[];
}

function isSkippedPath(posixRelPath: string): boolean {
  return posixRelPath.split("/").some((segment) => SKIP_SEGMENTS.has(segment));
}

function startsWithBom(buf: Buffer): boolean {
  return buf.length >= UTF8_BOM.length && UTF8_BOM.every((byte, i) => buf[i] === byte);
}

/** Null-byte heuristic over the first 8KB -- the conventional "is this binary" test. */
function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

function truncateContext(line: string): string {
  return line.length <= 120 ? line : `${line.slice(0, 117)}...`;
}

function scanFile(relPath: string, fullPath: string): EncodingFinding[] {
  let raw: Buffer;
  try {
    raw = readFileSync(fullPath);
  } catch {
    return [];
  }
  if (looksBinary(raw)) {
    return [];
  }

  const findings: EncodingFinding[] = [];
  if (startsWithBom(raw)) {
    findings.push({
      path: relPath,
      line: 1,
      label: "leading UTF-8 BOM",
      context: "leading bytes EF BB BF",
    });
  }

  const text = raw.toString("utf8");
  const lines = text.split(/\r\n|\r|\n/);
  const machineParsed = MACHINE_PARSED_BASENAMES.has(basename(relPath));

  lines.forEach((line, idx) => {
    const lineno = idx + 1;
    const ctx = truncateContext(line);
    if (line.includes(REPLACEMENT_CHAR)) {
      findings.push({
        path: relPath,
        line: lineno,
        label: "U+FFFD replacement character",
        context: ctx,
      });
    }
    for (const [pattern, label] of MOJIBAKE_PATTERNS) {
      if (line.includes(pattern)) {
        findings.push({ path: relPath, line: lineno, label, context: ctx });
      }
    }
    if (machineParsed) {
      for (const [char, label] of NON_ASCII_PUNCTUATION) {
        if (line.includes(char)) {
          findings.push({
            path: relPath,
            line: lineno,
            label: `non-ASCII punctuation: ${label}`,
            context: ctx,
          });
        }
      }
    }
  });

  return findings;
}

function isFile(fullPath: string): boolean {
  try {
    return statSync(fullPath).isFile();
  } catch {
    return false;
  }
}

/**
 * Evaluate the encoding gate: exit 0 clean, 1 with a file:line finding list,
 * or 2 when the underlying git lookup fails (e.g. git missing on PATH).
 */
export function evaluateEncoding(
  projectRoot: string,
  opts: EvaluateEncodingOptions = {},
): EvaluateEncodingResult {
  const run = opts.runner;

  let relPaths: readonly string[];
  try {
    relPaths =
      opts.staged === true ? stagedFiles(projectRoot, run) : trackedFiles(projectRoot, run);
  } catch (err) {
    return {
      code: 2,
      findings: [],
      message: `verify:encoding: git failed -- ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const root = resolve(projectRoot);
  const findings: EncodingFinding[] = [];
  let scanned = 0;

  for (const rel of relPaths) {
    const posix = rel.replace(/\\/g, "/");
    if (isSkippedPath(posix)) {
      continue;
    }
    const full = resolve(root, posix);
    const relCheck = relative(root, full);
    if (relCheck.startsWith("..") || isAbsolute(relCheck)) {
      continue;
    }
    if (!isFile(full)) {
      continue;
    }
    scanned += 1;
    findings.push(...scanFile(posix, full));
  }

  if (findings.length > 0) {
    const fileCount = new Set(findings.map((f) => f.path)).size;
    const shown = findings
      .slice(0, 50)
      .map((f) => `  ${f.path}:${f.line} [${f.label}] ${f.context}`)
      .join("\n");
    const overflow = findings.length > 50 ? `\n  ... and ${findings.length - 50} more` : "";
    return {
      code: 1,
      findings,
      message:
        `verify:encoding: ${findings.length} finding(s) across ${fileCount} file(s).\n` +
        `${shown}${overflow}`,
    };
  }

  return {
    code: 0,
    findings,
    message: `verify:encoding: ${scanned} file(s) clean -- no BOM/U+FFFD/mojibake detected.`,
  };
}
