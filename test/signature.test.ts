import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidAnthropicSignature, isSuspectBlock } from "../src/signature.js";

describe("isValidAnthropicSignature", () => {
  it("returns true for 700-char base64 string", () => {
    const sig = "A".repeat(700);
    assert.equal(isValidAnthropicSignature(sig), true);
  });

  it("returns true for 1000-char base64 string", () => {
    const sig = "A".repeat(1000);
    assert.equal(isValidAnthropicSignature(sig), true);
  });

  it("returns false for short signature", () => {
    assert.equal(isValidAnthropicSignature("short"), false);
  });

  it("returns false for 500-char string", () => {
    assert.equal(isValidAnthropicSignature("A".repeat(500)), false);
  });

  it("returns false for 1300-char string (too long)", () => {
    assert.equal(isValidAnthropicSignature("A".repeat(1300)), false);
  });

  it("returns false for non-string input", () => {
    assert.equal(isValidAnthropicSignature(undefined), false);
    assert.equal(isValidAnthropicSignature(null), false);
    assert.equal(isValidAnthropicSignature(123), false);
  });

  it("returns false for string with invalid base64 chars", () => {
    const sig = "A".repeat(699) + "!";
    assert.equal(isValidAnthropicSignature(sig), false);
  });

  it("accepts valid base64 chars (+, /, =)", () => {
    const sig = "A".repeat(697) + "+/=";
    assert.equal(isValidAnthropicSignature(sig), true);
  });
});

describe("isSuspectBlock", () => {
  it("returns true for undefined signature", () => {
    assert.equal(isSuspectBlock(undefined), true);
  });

  it("returns true for short signature", () => {
    assert.equal(isSuspectBlock("abc"), true);
  });

  it("returns false for valid signature", () => {
    assert.equal(isSuspectBlock("A".repeat(700)), false);
  });
});
