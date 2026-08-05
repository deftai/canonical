import { existsSync, statSync } from "node:fs";
import { parseArgs, renderJson } from "../args/index.js";
import { validateState } from "../xbrief/index.js";

/** `state:validate` handler. Contract: content/canonical-tasks.md. */

function emit(json: boolean, code: number, payload: Record<string, unknown>, text: string): number {
  if (json) {
    process.stdout.write(`${renderJson(payload)}\n`);
  } else if (code === 0) {
    process.stdout.write(text);
  } else {
    process.stderr.write(text);
  }
  return code;
}

export function run(argv: string[]): number {
  const parsed = parseArgs(argv, { valueFlags: ["project-root"], boolFlags: ["json"] });
  const json = parsed.flags.json === true;
  if (parsed.error !== undefined) {
    return emit(
      json,
      2,
      { ok: false, error: parsed.error },
      `canon: state-validate: ${parsed.error}\n`,
    );
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    const message = `project root not found: ${projectRoot}`;
    return emit(json, 2, { ok: false, error: message }, `canon: state-validate: ${message}\n`);
  }

  const report = validateState(projectRoot);
  const findings = report.findings.map((f) => ({ file: f.file, code: f.code, message: f.message }));

  if (report.ok) {
    const noun = report.scanned === 1 ? "scope file" : "scope files";
    return emit(
      json,
      0,
      { ok: true, scanned: report.scanned, findings },
      `canon: state ok (${report.scanned} ${noun} scanned)\n`,
    );
  }

  const lines = report.findings.map((f) => `${f.file}: [${f.code}] ${f.message}\n`).join("");
  const violationNoun = report.findings.length === 1 ? "violation" : "violations";
  const scannedNoun = report.scanned === 1 ? "scope file" : "scope files";
  const summary = `canon: state-validate found ${report.findings.length} ${violationNoun} across ${report.scanned} ${scannedNoun}\n`;
  return emit(json, 1, { ok: false, scanned: report.scanned, findings }, `${lines}${summary}`);
}
