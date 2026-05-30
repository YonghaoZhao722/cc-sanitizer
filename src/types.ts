/**
 * Type definitions for Claude Code JSONL session format.
 */

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export interface RedactedThinkingBlock {
  type: "redacted_thinking";
  data: string;
}

export interface TextBlock {
  type: "text";
  text: string;
  [key: string]: unknown;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentBlock[];
  [key: string]: unknown;
}

export type ContentBlock =
  | ThinkingBlock
  | RedactedThinkingBlock
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | Record<string, unknown>;

export interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  [key: string]: unknown;
}

export interface UserMessage {
  role: "user";
  content: string | ContentBlock[];
  [key: string]: unknown;
}

export type Message = AssistantMessage | UserMessage | Record<string, unknown>;

export interface SummaryEvent {
  type: "summary";
  summary: string;
  leafUuid: string;
  [key: string]: unknown;
}

export interface UserEvent {
  type: "user";
  message: UserMessage;
  uuid: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface AssistantEvent {
  type: "assistant";
  message: AssistantMessage;
  uuid: string;
  timestamp: string;
  [key: string]: unknown;
}

export type SessionEvent =
  | SummaryEvent
  | UserEvent
  | AssistantEvent
  | Record<string, unknown>;

export interface ScanResult {
  file: string;
  thinkingBlocks: number;
  redactedBlocks: number;
  validSignature: number;
  suspectBlocks: number;
}

export interface StripResult {
  file: string;
  totalLines: number;
  thinkingRemoved: number;
  redactedRemoved: number;
  linesModified: number;
  eventsRemoved: number;
  backedUp: boolean;
  dryRun: boolean;
}

export interface StripOptions {
  suspectOnly: boolean;
  dryRun: boolean;
  backup: boolean;
}

export interface RestoreResult {
  file: string;
  restored: boolean;
  reason?: string;
}
