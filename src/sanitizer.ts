/**
 * Core sanitization logic — filter thinking/redacted_thinking blocks
 * from assistant messages in a Claude Code session.
 */

import { readdir, stat, copyFile, unlink } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";

/**
 * Decode a Claude Code project directory name back to a file path.
 * Encoding: "/" → "-", "." → "--"
 * So decode: "--" → ".", then "-" → "/"
 */
export function decodeProjectName(encoded: string): string {
  return encoded.replace(/--/g, ".").replace(/-/g, "/");
}
import { isSuspectBlock } from "./signature.js";
import { readSession, writeSession, backupSession } from "./session.js";
import type {
  ContentBlock,
  SessionEvent,
  StripOptions,
  StripResult,
  ScanResult,
  RestoreResult,
  ThinkingBlock,
  RedactedThinkingBlock,
} from "./types.js";

function isThinkingBlock(
  block: ContentBlock
): block is ThinkingBlock | RedactedThinkingBlock {
  return block.type === "thinking" || block.type === "redacted_thinking";
}

/**
 * Filter thinking blocks from a content array.
 *
 * In --suspect-only mode, only blocks without a valid Anthropic signature
 * are removed. Otherwise, all thinking/redacted_thinking blocks are removed.
 */
function filterBlocks(
  blocks: ContentBlock[],
  suspectOnly: boolean
): { filtered: ContentBlock[]; removed: { thinking: number; redacted: number } } {
  let thinking = 0;
  let redacted = 0;

  const filtered = blocks.filter((block) => {
    if (!isThinkingBlock(block)) return true;

    if (suspectOnly) {
      const sig =
        block.type === "thinking" ? (block as ThinkingBlock).signature : undefined;
      if (!isSuspectBlock(sig)) return true; // keep valid Anthropic blocks
    }

    if (block.type === "thinking") thinking++;
    else redacted++;
    return false;
  });

  return { filtered, removed: { thinking, redacted } };
}

/**
 * Sanitize a single session file.
 */
export async function stripFile(
  filePath: string,
  options: StripOptions
): Promise<StripResult> {
  const events = await readSession(filePath);
  let thinkingRemoved = 0;
  let redactedRemoved = 0;
  let linesModified = 0;
  let eventsRemoved = 0;

  const eventsToRemove = new Set<number>();

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type !== "assistant") continue;
    const msg = (event as Record<string, unknown>).message as Record<string, unknown> | undefined;
    if (!msg || !Array.isArray(msg.content)) continue;

    const { filtered, removed } = filterBlocks(
      msg.content as ContentBlock[],
      options.suspectOnly
    );

    if (removed.thinking + removed.redacted > 0) {
      thinkingRemoved += removed.thinking;
      redactedRemoved += removed.redacted;
      linesModified++;

      if (filtered.length === 0) {
        // Content became empty — remove the entire event
        eventsToRemove.add(i);
      } else {
        msg.content = filtered;
      }
    }
  }

  // Remove events with empty content (iterate in reverse to preserve indices)
  for (let i = events.length - 1; i >= 0; i--) {
    if (eventsToRemove.has(i)) {
      events.splice(i, 1);
      eventsRemoved++;
    }
  }

  const result: StripResult = {
    file: filePath,
    totalLines: events.length,
    thinkingRemoved,
    redactedRemoved,
    linesModified,
    eventsRemoved,
    backedUp: false,
    dryRun: options.dryRun,
  };

  if (thinkingRemoved + redactedRemoved === 0) return result;

  if (!options.dryRun) {
    if (options.backup) {
      await backupSession(filePath);
      result.backedUp = true;
    }
    await writeSession(filePath, serializeSession(events));
  }

  return result;
}

import { serializeSession } from "./session.js";

/**
 * Scan a single session file and return counts of thinking blocks.
 */
export async function scanFile(filePath: string): Promise<ScanResult> {
  const events = await readSession(filePath);
  let thinkingBlocks = 0;
  let redactedBlocks = 0;
  let validSignature = 0;
  let suspectBlocks = 0;

  for (const event of events) {
    if (event.type !== "assistant") continue;
    const msg = (event as Record<string, unknown>).message as Record<string, unknown> | undefined;
    if (!msg || !Array.isArray(msg.content)) continue;

    for (const block of msg.content as ContentBlock[]) {
      if (block.type === "thinking") {
        thinkingBlocks++;
        if (isSuspectBlock((block as ThinkingBlock).signature)) {
          suspectBlocks++;
        } else {
          validSignature++;
        }
      } else if (block.type === "redacted_thinking") {
        redactedBlocks++;
        suspectBlocks++; // redacted blocks from third-party are always suspect
      }
    }
  }

  return {
    file: filePath,
    thinkingBlocks,
    redactedBlocks,
    validSignature,
    suspectBlocks,
  }
}

/**
 * Find all .jsonl session files in a directory.
 */
async function findSessionFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries
    .filter((e) => e.endsWith(".jsonl"))
    .map((e) => join(dir, e));
}

/**
 * Resolve the Claude Code projects directory.
 */
export function getProjectsDir(): string {
  return resolve(homedir(), ".claude", "projects");
}

/**
 * List all project directories under ~/.claude/projects/.
 */
export async function listProjects(): Promise<string[]> {
  const dir = getProjectsDir();
  try {
    const entries = await readdir(dir);
    const projects: string[] = [];
    for (const e of entries) {
      const full = join(dir, e);
      const s = await stat(full);
      if (s.isDirectory()) projects.push(full);
    }
    return projects;
  } catch {
    return [];
  }
}

/**
 * Strip all session files in a project directory.
 */
export async function stripProject(
  projectDir: string,
  options: StripOptions
): Promise<StripResult[]> {
  const projectName = decodeProjectName(basename(projectDir));
  const files = await findSessionFiles(projectDir);
  const results: StripResult[] = [];
  for (const f of files) {
    const r = await stripFile(f, options);
    r.project = projectName;
    results.push(r);
  }
  return results;
}

/**
 * Scan all session files in a project directory.
 */
export async function scanProject(projectDir: string): Promise<ScanResult[]> {
  const projectName = decodeProjectName(basename(projectDir));
  const files = await findSessionFiles(projectDir);
  const results: ScanResult[] = [];
  for (const f of files) {
    const r = await scanFile(f);
    r.project = projectName;
    results.push(r);
  }
  return results;
}

/**
 * Restore a single session file from its .bak backup.
 */
export async function restoreFile(filePath: string): Promise<RestoreResult> {
  const bakPath = `${filePath}.bak`;
  const exists = await stat(bakPath).catch(() => null);
  if (!exists) {
    return { file: filePath, restored: false, reason: "no backup file found" };
  }
  await copyFile(bakPath, filePath);
  return { file: filePath, restored: true };
}

/**
 * Restore all session files in a project directory from .bak backups.
 */
export async function restoreProject(projectDir: string): Promise<RestoreResult[]> {
  const entries = await readdir(projectDir);
  const results: RestoreResult[] = [];
  for (const e of entries) {
    if (!e.endsWith(".bak")) continue;
    const bakPath = join(projectDir, e);
    const originalPath = bakPath.slice(0, -4); // remove .bak
    await copyFile(bakPath, originalPath);
    results.push({ file: originalPath, restored: true });
  }
  return results;
}
