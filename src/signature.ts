/**
 * Anthropic thinking-block signature validation.
 *
 * Signatures are base64-encoded, typically 700-1000 characters.
 * Third-party models (GLM, DeepSeek, etc.) either omit the signature
 * or produce non-standard formats.
 */

const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

/**
 * Minimum signature length for a plausible Anthropic signature.
 * Real signatures are ~700-1000 chars; third-party ones are usually
 * much shorter or missing entirely.
 */
const MIN_SIG_LENGTH = 600;
const MAX_SIG_LENGTH = 1200;

/**
 * Check whether a signature string looks like a valid Anthropic signature.
 *
 * Heuristic: base64 charset, length in [600, 1200].
 * This is intentionally conservative — it may flag some valid short
 * signatures as suspect, but won't accidentally keep invalid ones.
 */
export function isValidAnthropicSignature(sig: unknown): boolean {
  if (typeof sig !== "string") return false;
  const trimmed = sig.trim();
  if (trimmed.length < MIN_SIG_LENGTH || trimmed.length > MAX_SIG_LENGTH) {
    return false;
  }
  return BASE64_RE.test(trimmed);
}

/**
 * Determine whether a thinking block is "suspect" — i.e., likely not
 * produced by an official Anthropic model.
 *
 * A block is suspect if it has no signature or the signature fails
 * the heuristic check.
 */
export function isSuspectBlock(signature: unknown): boolean {
  return !isValidAnthropicSignature(signature);
}
