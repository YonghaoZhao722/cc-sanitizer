import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSession, serializeSession, writeSession, backupSession } from "../src/session.js";

const TEST_DIR = join(tmpdir(), `cc-sanitizer-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("readSession", () => {
  it("parses valid JSONL lines", async () => {
    const file = join(TEST_DIR, "test.jsonl");
    const lines = [
      JSON.stringify({ type: "summary", summary: "test", leafUuid: "abc" }),
      JSON.stringify({ type: "user", message: { role: "user", content: "hello" }, uuid: "u1", timestamp: "2026-01-01" }),
    ].join("\n") + "\n";
    await writeFile(file, lines, "utf-8");

    const events = await readSession(file);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "summary");
    assert.equal(events[1].type, "user");
  });

  it("skips malformed JSON lines", async () => {
    const file = join(TEST_DIR, "bad.jsonl");
    const lines = [
      JSON.stringify({ type: "summary", summary: "ok" }),
      "not json {{{",
      JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
    ].join("\n") + "\n";
    await writeFile(file, lines, "utf-8");

    const events = await readSession(file);
    assert.equal(events.length, 2);
  });
});

describe("serializeSession", () => {
  it("produces valid JSONL", () => {
    const events = [
      { type: "summary", summary: "test" },
      { type: "user", message: { role: "user", content: "hi" } },
    ];
    const result = serializeSession(events);
    const lines = result.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), { type: "summary", summary: "test" });
    assert.deepEqual(JSON.parse(lines[1]), { type: "user", message: { role: "user", content: "hi" } });
  });

  it("ends with newline", () => {
    const result = serializeSession([{ type: "test" }]);
    assert.ok(result.endsWith("\n"));
  });
});

describe("writeSession", () => {
  it("writes content atomically", async () => {
    const file = join(TEST_DIR, "atomic.jsonl");
    const content = '{"type":"test"}\n';
    await writeSession(file, content);
    const read = await readFile(file, "utf-8");
    assert.equal(read, content);
  });
});

describe("backupSession", () => {
  it("creates a .bak copy", async () => {
    const file = join(TEST_DIR, "backup.jsonl");
    const content = '{"type":"original"}\n';
    await writeFile(file, content, "utf-8");
    await backupSession(file);
    const bak = await readFile(`${file}.bak`, "utf-8");
    assert.equal(bak, content);
  });
});
