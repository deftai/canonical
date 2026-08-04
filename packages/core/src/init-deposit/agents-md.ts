/**
 * AGENTS.md managed-section helpers -- heavily simplified port of the
 * reference framework's platform/agents-md.ts (sha/session/version-history
 * machinery dropped; canon's marker carries no attributes).
 */

export const AGENTS_MANAGED_OPEN = "<!-- canon:managed-section v1 -->";
export const AGENTS_MANAGED_CLOSE = "<!-- /canon:managed-section -->";

export const AGENTS_MANAGED_BODY =
  "Canon is installed in .canonical/core/. Read .canonical/core/canonical.md before working in this project.";

export function agentsManagedBlock(): string {
  return `${AGENTS_MANAGED_OPEN}\n${AGENTS_MANAGED_BODY}\n${AGENTS_MANAGED_CLOSE}\n`;
}

export interface AgentsMdApplyResult {
  readonly content: string;
  readonly changed: boolean;
}

/**
 * Compute the next AGENTS.md content: absent -> create with just the managed
 * block; present without markers -> append; present with markers -> replace
 * verbatim between them. `existing` is `null` when the file does not exist.
 */
export function applyAgentsMd(existing: string | null): AgentsMdApplyResult {
  const block = agentsManagedBlock();
  if (existing === null) {
    return { content: block, changed: true };
  }

  const openIdx = existing.indexOf(AGENTS_MANAGED_OPEN);
  if (openIdx === -1) {
    const sep = existing.length === 0 ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
    return { content: `${existing}${sep}${block}`, changed: true };
  }

  const closeIdx = existing.indexOf(AGENTS_MANAGED_CLOSE, openIdx);
  if (closeIdx === -1) {
    // Malformed open marker with no matching close -- treat as if absent and
    // append a fresh, well-formed block rather than guessing at repair.
    const sep = existing.endsWith("\n") ? "\n" : "\n\n";
    return { content: `${existing}${sep}${block}`, changed: true };
  }

  const end = closeIdx + AGENTS_MANAGED_CLOSE.length;
  const before = existing.slice(0, openIdx);
  let after = existing.slice(end);
  if (after.startsWith("\n")) {
    after = after.slice(1);
  }
  const content = `${before}${block}${after}`;
  return { content, changed: content !== existing };
}
