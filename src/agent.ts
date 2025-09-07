import {
  Client,
  PROTOCOL_VERSION,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  AuthenticateRequest,
  PromptRequest,
  PromptResponse,
  CancelNotification,
  SessionNotification,
  RequestError,
  ContentBlock,
} from "@zed-industries/agent-client-protocol";
import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "node:crypto";
import {
  log,
  getQwenCodeConfig,
  validateQwenCode,
  cleanPromptText,
} from "./utils.js";
import type { QwenCodeConfig, SessionData } from "./types.js";

export class QwenCodeAgent {
  private sessions: Map<string, SessionData> = new Map();
  private config: QwenCodeConfig;

  constructor(private client: Client) {
    this.config = getQwenCodeConfig();
    log("QwenCodeAgent initialized", this.config);
  }

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    log("Initialize request received", params);

    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [
        {
          id: "qwen-code-auth",
          name: "Qwen Code Authentication",
          description: "Verify Qwen Code CLI is available and authenticated",
        },
      ],
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: true,
        },
      },
    };
  }

  async authenticate(params: AuthenticateRequest): Promise<void> {
    log("Authentication request received", params);

    if (params.methodId !== "qwen-code-auth") {
      throw new Error(`Unknown authentication method: ${params.methodId}`);
    }

    // Check if Qwen Code is available
    try {
      await validateQwenCode(this.config.executablePath);
      log("Qwen Code authentication successful");
    } catch (error) {
      log("Qwen Code authentication failed", error);
      throw RequestError.authRequired(
        "Qwen Code CLI is not available or not authenticated. Please run 'qwen auth' first.",
      );
    }
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = randomUUID();
    log("Creating new session", sessionId, { cwd: params.cwd });

    const sessionData: SessionData = {
      id: sessionId,
      cwd: params.cwd,
      pendingPrompt: null,
      qwenProcess: null,
      conversationHistory: [],
    };

    this.sessions.set(sessionId, sessionData);

    return {
      sessionId,
    };
  }

  async cancel(params: CancelNotification): Promise<void> {
    log("Cancel request received", params);

    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }

    await this.cancelSession(session);
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }

    return this.handlePrompt(session, params);
  }

  private async cancelSession(session: SessionData): Promise<void> {
    if (!session.pendingPrompt) {
      throw new Error("Not currently generating");
    }

    session.pendingPrompt.abort();
    session.pendingPrompt = null;

    // Kill the Qwen process if running
    if (session.qwenProcess) {
      session.qwenProcess.kill("SIGTERM");
      session.qwenProcess = null;
    }
  }

  private async handlePrompt(
    session: SessionData,
    params: PromptRequest,
  ): Promise<PromptResponse> {
    session.pendingPrompt?.abort();
    const pendingPrompt = new AbortController();
    session.pendingPrompt = pendingPrompt;

    try {
      // Convert ACP prompt to text
      const promptText = this.convertPromptToText(params.prompt);
      log(
        `Session ${session.id}: Processing prompt`,
        promptText.substring(0, 100) + "...",
      );

      // Add to conversation history
      session.conversationHistory.push(`User: ${promptText}`);

      // Skip the processing message - start directly with Qwen output

      // Process with Qwen Code using non-interactive mode
      const response = await this.processWithQwenCode(
        session,
        promptText,
        pendingPrompt.signal,
      );

      // Add response to history
      if (response) {
        session.conversationHistory.push(`Assistant: ${response}`);
      }

      return { stopReason: "end_turn" };
    } catch (error) {
      if (pendingPrompt.signal.aborted) {
        return { stopReason: "cancelled" };
      }

      log(`Session ${session.id}: Error processing prompt`, error);

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.sendSessionUpdate(session.id, {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `Error: ${errorMessage}\n`,
        },
      });

      return { stopReason: "end_turn" };
    } finally {
      session.pendingPrompt = null;
    }
  }

  private async sendSessionUpdate(
    sessionId: string,
    update: SessionNotification["update"],
  ): Promise<void> {
    const params: SessionNotification = {
      sessionId,
      update,
    };

    try {
      await this.client.sessionUpdate(params);
    } catch (error) {
      log(`Failed to send session update for ${sessionId}:`, error);
    }
  }

  private convertPromptToText(prompt: ContentBlock[]): string {
    let text = "";

    for (const block of prompt) {
      if (block.type === "text") {
        text += cleanPromptText(block.text) + "\n";
      } else if (block.type === "resource") {
        // Handle resource blocks (files, etc.)
        if ("text" in block.resource) {
          text += `\nFile: ${block.resource.uri}\n\`\`\`\n${block.resource.text}\n\`\`\`\n`;
        }
      }
    }

    return text.trim();
  }

  private async processWithQwenCode(
    session: SessionData,
    prompt: string,
    abortSignal: AbortSignal,
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      if (abortSignal.aborted) {
        resolve(null);
        return;
      }

      let outputBuffer = "";
      let errorBuffer = "";

      // Handle abort signal
      const abortHandler = () => {
        if (session.qwenProcess) {
          session.qwenProcess.kill("SIGTERM");
          session.qwenProcess = null;
        }
        resolve(null);
      };

      abortSignal.addEventListener("abort", abortHandler);

      // Build arguments for Qwen Code
      const args = this.buildQwenArgs(prompt);

      log(`Session ${session.id}: Starting Qwen with args:`, [
        this.config.executablePath,
        ...args,
      ]);

      // Spawn Qwen process in non-interactive mode
      const qwenProcess = spawn(this.config.executablePath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: session.cwd,
        env: {
          ...process.env,
        },
      });

      session.qwenProcess = qwenProcess;

      if (!qwenProcess.stdout || !qwenProcess.stderr || !qwenProcess.stdin) {
        reject(new Error("Failed to create Qwen Code process streams"));
        return;
      }

      // Set encoding for proper text handling
      qwenProcess.stdout.setEncoding("utf8");
      qwenProcess.stderr.setEncoding("utf8");

      // Close stdin immediately as we're using --prompt mode
      // This signals to Qwen that no more input is coming
      qwenProcess.stdin.end();

      const cleanup = () => {
        abortSignal.removeEventListener("abort", abortHandler);
        session.qwenProcess = null;
      };

      // Handle stdout (main response)
      qwenProcess.stdout.on("data", async (data: string) => {
        log(
          `Session ${session.id}: Received stdout chunk (${data.length} chars):`,
          data.substring(0, 100),
        );

        outputBuffer += data;

        // Filter out debug messages and stream clean content immediately
        const cleanData = data
          .split("\n")
          .filter(
            (line) =>
              !line.includes("[DEBUG]") &&
              !line.includes("Flushing log events"),
          )
          .join("\n");

        if (cleanData.trim()) {
          await this.sendSessionUpdate(session.id, {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: cleanData,
            },
          });
        }
      });

      // Handle stderr (debug info, errors)
      qwenProcess.stderr.on("data", async (data: string) => {
        log(`Session ${session.id}: Received stderr:`, data.substring(0, 100));

        errorBuffer += data;

        // Only show actual errors to user, not debug spam
        const lines = data.split("\n");
        for (const line of lines) {
          if (
            line.trim() &&
            !line.includes("[DEBUG]") &&
            !line.includes("Flushing log events")
          ) {
            await this.sendSessionUpdate(session.id, {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: `[INFO] ${line}\n`,
              },
            });
          }
        }
      });

      // Handle process exit
      qwenProcess.on("exit", async (code, signal) => {
        log(`Session ${session.id}: Qwen process exited`, {
          code,
          signal,
          outputLength: outputBuffer.length,
          errorLength: errorBuffer.length,
        });

        cleanup();

        if (signal === "SIGTERM" || abortSignal.aborted) {
          resolve(null);
        } else if (code === 0) {
          // Process completed successfully
          // Clean the output by removing debug lines
          const cleanOutput = outputBuffer
            .split("\n")
            .filter(
              (line) =>
                !line.includes("[DEBUG]") &&
                !line.includes("Flushing log events"),
            )
            .join("\n")
            .trim();

          if (cleanOutput) {
            resolve(cleanOutput);
          } else {
            resolve("Request completed successfully.");
          }
        } else {
          // Process failed
          const errorMsg =
            errorBuffer.trim() || `Process exited with code ${code}`;
          reject(new Error(`Qwen Code failed: ${errorMsg}`));
        }
      });

      // Handle process errors
      qwenProcess.on("error", (error) => {
        log(`Session ${session.id}: Qwen Code process error:`, error);
        cleanup();
        reject(new Error(`Failed to start Qwen Code: ${error.message}`));
      });

      // Set overall timeout
      setTimeout(() => {
        if (!abortSignal.aborted && qwenProcess && !qwenProcess.killed) {
          log(
            `Session ${session.id}: Process timeout after 60s, killing. Output so far:`,
            outputBuffer.substring(0, 200),
          );
          qwenProcess.kill("SIGTERM");
          cleanup();

          // Return what we have if there's any meaningful output
          const cleanOutput = outputBuffer
            .split("\n")
            .filter(
              (line) =>
                !line.includes("[DEBUG]") &&
                !line.includes("Flushing log events"),
            )
            .join("\n")
            .trim();

          if (cleanOutput) {
            resolve(cleanOutput);
          } else {
            reject(new Error("Timeout waiting for response from Qwen Code"));
          }
        }
      }, 60000); // 1 minute timeout
    });
  }

  private buildQwenArgs(prompt: string): string[] {
    const args: string[] = [];

    // Use non-interactive mode with prompt
    args.push("--prompt", prompt);

    // Add permission flags based on config
    switch (this.config.permissionMode) {
      case "bypassPermissions":
        args.push("--yolo");
        break;
      case "acceptEdits":
        args.push("--approval-mode", "auto_edit");
        break;
      // default mode uses no special flags
    }

    return args;
  }
}
