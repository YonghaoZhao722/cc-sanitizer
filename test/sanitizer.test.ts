import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { stripFile, scanFile, restoreFile, resolveTarget } from "../src/sanitizer.js";

const TEST_DIR = join(tmpdir(), `cc-sanitizer-test-${randomBytes(8).toString("hex")}`);

before(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

after(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

function tmpFile(name: string): string {
  return join(TEST_DIR, name);
}

// Helper to build a JSONL session with thinking blocks
function buildSession(
  blocks: Array<{ type: string; thinking?: string; signature?: string; text?: string; data?: string }>
): string {
  return [
    JSON.stringify({ type: "summary", summary: "test", leafUuid: "abc" }),
    JSON.stringify({ type: "user", message: { role: "user", content: "hello" }, uuid: "u1", timestamp: "2026-01-01" }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: blocks },
      uuid: "a1",
      timestamp: "2026-01-01",
    }),
  ].join("\n") + "\n";
}

describe("scanFile", () => {
  it("counts thinking blocks with valid and suspect signatures", async () => {
    const file = tmpFile("scan-valid-suspect.jsonl");
    const content = buildSession([
      { type: "thinking", thinking: "suspect", signature: "short" },
      { type: "text", text: "hello" },
      { type: "thinking", thinking: "valid", signature: "A".repeat(700) },
    ]);
    await writeFile(file, content, "utf-8");

    const result = await scanFile(file);
    assert.equal(result.thinkingBlocks, 2);
    assert.equal(result.suspectBlocks, 1);
    assert.equal(result.validSignature, 1);
  });

  it("counts redacted_thinking blocks", async () => {
    const file = tmpFile("scan-redacted.jsonl");
    const content = buildSession([
      { type: "redacted_thinking", data: "xxx" },
      { type: "text", text: "hello" },
    ]);
    await writeFile(file, content, "utf-8");

    const result = await scanFile(file);
    assert.equal(result.redactedBlocks, 1);
    assert.equal(result.suspectBlocks, 1);
  });

  it("returns zero for clean session", async () => {
    const file = tmpFile("scan-clean.jsonl");
    const content = buildSession([{ type: "text", text: "no thinking" }]);
    await writeFile(file, content, "utf-8");

    const result = await scanFile(file);
    assert.equal(result.thinkingBlocks, 0);
    assert.equal(result.redactedBlocks, 0);
  });
});

describe("stripFile", () => {
  it("removes all thinking blocks by default", async () => {
    const file = tmpFile("strip-all.jsonl");
    const content = buildSession([
      { type: "thinking", thinking: "a", signature: "A".repeat(700) },
      { type: "text", text: "hello" },
    ]);
    await writeFile(file, content, "utf-8");

    const result = await stripFile(file, { suspectOnly: false, dryRun: false, backup: false });
    assert.equal(result.thinkingRemoved, 1);
    assert.equal(result.eventsRemoved, 0);

    const events = JSON.parse(
      (await readFile(file, "utf-8")).split("\n").filter(l => l.trim())[2]
    );
    assert.equal(events.message.content.length, 1);
    assert.equal(events.message.content[0].type, "text");
  });

  it("only removes suspect blocks in suspect-only mode", async () => {
    const file = tmpFile("strip-suspect.jsonl");
    const content = buildSession([
      { type: "thinking", thinking: "suspect", signature: "short" },
      { type: "thinking", thinking: "valid", signature: "A".repeat(700) },
      { type: "text", text: "hello" },
    ]);
    await writeFile(file, content, "utf-8");

    const result = await stripFile(file, { suspectOnly: true, dryRun: false, backup: false });
    assert.equal(result.thinkingRemoved, 1);

    const events = JSON.parse(
      (await readFile(file, "utf-8")).split("\n").filter(l => l.trim())[2]
    );
    assert.equal(events.message.content.length, 2);
    assert.equal(events.message.content[0].type, "thinking");
    assert.equal(events.message.content[0].signature, "A".repeat(700));
    assert.equal(events.message.content[1].type, "text");
  });

  it("removes events with empty content after stripping", async () => {
    const file = tmpFile("strip-empty.jsonl");
    const content = buildSession([
      { type: "thinking", thinking: "only block", signature: "short" },
    ]);
    await writeFile(file, content, "utf-8");

    const result = await stripFile(file, { suspectOnly: false, dryRun: false, backup: false });
    assert.equal(result.thinkingRemoved, 1);
    assert.equal(result.eventsRemoved, 1);

    const raw = await readFile(file, "utf-8");
    const lines = raw.split("\n").filter(l => l.trim());
    assert.equal(lines.length, 2); // summary + user only
  });

  it("does not modify file in dry-run mode", async () => {
    const file = tmpFile("strip-dryrun.jsonl");
    const content = buildSession([
      { type: "thinking", thinking: "a", signature: "short" },
      { type: "text", text: "hello" },
    ]);
    await writeFile(file, content, "utf-8");

    const result = await stripFile(file, { suspectOnly: false, dryRun: true, backup: false });
    assert.equal(result.thinkingRemoved, 1);
    assert.equal(result.dryRun, true);

    const after = await readFile(file, "utf-8");
    assert.equal(after, content);
  });

  it("creates backup when requested", async () => {
    const file = tmpFile("strip-backup.jsonl");
    const content = buildSession([
      { type: "thinking", thinking: "a", signature: "short" },
      { type: "text", text: "hello" },
    ]);
    await writeFile(file, content, "utf-8");

    const result = await stripFile(file, { suspectOnly: false, dryRun: false, backup: true });
    assert.equal(result.backedUp, true);

    const bak = await readFile(`${file}.bak`, "utf-8");
    assert.equal(bak, content);
  });
});

describe("resolveTarget", () => {
  const savedHome = process.env.HOME;
  const fakeHome = join(TEST_DIR, "home");
  const projectName = "-tmp-my-project";
  const sessionId = "11111111-2222-3333-4444-555555555555";
  const projectDir = join(fakeHome, ".claude", "projects", projectName);
  const sessionFile = join(projectDir, `${sessionId}.jsonl`);

  before(async () => {
    await mkdir(projectDir, { recursive: true });
    await writeFile(sessionFile, "{}\n", "utf-8");
    process.env.HOME = fakeHome;
  });

  after(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  it("resolves an existing absolute path as-is", async () => {
    assert.equal(await resolveTarget(sessionFile), sessionFile);
  });

  it("resolves a bare session id against the projects dir", async () => {
    assert.equal(await resolveTarget(sessionId), sessionFile);
  });

  it("resolves a bare session filename", async () => {
    assert.equal(await resolveTarget(`${sessionId}.jsonl`), sessionFile);
  });

  it("resolves a bare project name", async () => {
    assert.equal(await resolveTarget(projectName), projectDir);
  });

  it("returns null when nothing matches", async () => {
    assert.equal(await resolveTarget("does-not-exist-anywhere"), null);
  });
});

describe("restoreFile", () => {
  it("restores from .bak file", async () => {
    const file = tmpFile("restore.jsonl");
    const original = '{"type":"original"}\n';
    const modified = '{"type":"modified"}\n';
    await writeFile(file, original, "utf-8");
    await writeFile(`${file}.bak`, modified, "utf-8");

    const result = await restoreFile(file);
    assert.equal(result.restored, true);

    const content = await readFile(file, "utf-8");
    assert.equal(content, modified);
  });

  it("returns not-restored when no backup exists", async () => {
    const file = tmpFile("restore-nobak.jsonl");
    await writeFile(file, '{"type":"test"}\n', "utf-8");

    const result = await restoreFile(file);
    assert.equal(result.restored, false);
    assert.ok(result.reason?.includes("no backup"));
  });
});
