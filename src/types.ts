import type { ChildProcess } from "child_process";

/**
 * Configuration for Qwen Code integration
 */
export interface QwenCodeConfig {
  executablePath: string;
  debug: boolean;
  permissionMode: "default" | "acceptEdits" | "bypassPermissions";
}

/**
 * Session data for tracking conversation state
 */
export interface SessionData {
  id: string;
  cwd: string;
  pendingPrompt: AbortController | null;
  qwenProcess: ChildProcess | null;
  conversationHistory: string[];
}

/**
 * Response from Qwen Code process
 */
export interface QwenCodeResponse {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
}

/**
 * Options for ReadlineTransform
 */
export interface ReadlineTransformOptions {
  maxBufferSize?: number;
}
