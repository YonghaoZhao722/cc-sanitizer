/**
 * JSONL session file reading and writing.
 *
 * Claude Code stores sessions as JSONL files where each line is an
 * independent JSON object representing an event (summary, user, assistant).
 */

import { readFile, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { SessionEvent } from "./types.js";

/**
 * Parse a JSONL file into an array of typed events.
 * Lines that fail to parse are skipped with a warning.
 */
export async function readSession(filePath: string): Promise<SessionEvent[]> {
  const raw = await readFile(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const events: SessionEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      events.push(JSON.parse(lines[i]) as SessionEvent);
    } catch {
      console.warn(`  ⚠ Skipped malformed JSON at line ${i + 1}`);
    }
  }

  return events;
}

/**
 * Serialize events back to JSONL format (one JSON object per line).
 */
export function serializeSession(events: SessionEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

/**
 * Atomically write a session file by writing to a temp file then renaming.
 * This prevents partial writes from corrupting the session.
 */
export async function writeSession(
  filePath: string,
  content: string
): Promise<void> {
  const tmpPath = join(
    tmpdir(),
    `cc-sanitizer-${randomBytes(8).toString("hex")}.tmp`
  );
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, filePath);
}

/**
 * Create a backup of the session file by copying it to filePath.bak.
 */
export async function backupSession(filePath: string): Promise<void> {
  const raw = await readFile(filePath, "utf-8");
  await writeFile(`${filePath}.bak`, raw, "utf-8");
}
