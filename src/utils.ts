/**
 * Logging utility that respects debug mode
 */
export function log(message: string, ...args: any[]): void {
  if (process.env.ACP_DEBUG === "true") {
    console.error(`[ACP-Qwen] ${message}`, ...args);
  }
}

/**
 * Check if a line is a setup/initialization message that should be filtered
 */
export function isSetupMessage(line: string): boolean {
  const setupPatterns = [
    /^qwen version/i,
    /^loading\.\.\./i,
    /^initializing\.\.\./i,
    /^starting\.\.\./i,
    /^\[.*\]\s*$/, // timestamp patterns only if they're alone
    /^>\s*$/, // empty prompt patterns
    /^Model:\s*\w+/i,
    /^Using model:/i,
    /^Connected to/i,
  ];

  return setupPatterns.some((pattern) => pattern.test(line));
}

/**
 * Get configuration from environment variables
 */
export function getQwenCodeConfig() {
  return {
    executablePath: process.env.ACP_PATH_TO_QWEN_CODE_EXECUTABLE || "qwen",
    debug: process.env.ACP_DEBUG === "true",
    permissionMode:
      (process.env.ACP_PERMISSION_MODE as
        | "default"
        | "acceptEdits"
        | "bypassPermissions") || "default",
  };
}

/**
 * Validate that Qwen Code is available and accessible
 */
export async function validateQwenCode(executablePath: string): Promise<void> {
  const { spawn } = await import("child_process");

  return new Promise((resolve, reject) => {
    const testProcess = spawn(executablePath, ["--version"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    let errorOutput = "";

    testProcess.stdout?.on("data", (data) => {
      output += data.toString();
    });

    testProcess.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });

    testProcess.on("exit", (code) => {
      if (code === 0) {
        log("Qwen Code validation successful", { output: output.trim() });
        resolve();
      } else {
        reject(
          new Error(
            `Qwen Code validation failed: ${errorOutput || "Unknown error"}`,
          ),
        );
      }
    });

    testProcess.on("error", (error) => {
      reject(new Error(`Failed to execute Qwen Code: ${error.message}`));
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      testProcess.kill("SIGTERM");
      reject(new Error("Qwen Code validation timeout"));
    }, 5000);
  });
}

/**
 * Clean and format prompt text by removing ACP markers
 */
export function cleanPromptText(text: string): string {
  return text.replace(/\[ACP:PERMISSION:\w+\]/g, "").trim();
}

/**
 * Extract permission mode from prompt text
 */
export function extractPermissionMode(text: string): string | null {
  if (text.includes("[ACP:PERMISSION:ACCEPT_EDITS]")) {
    return "acceptEdits";
  } else if (text.includes("[ACP:PERMISSION:BYPASS]")) {
    return "bypassPermissions";
  } else if (text.includes("[ACP:PERMISSION:DEFAULT]")) {
    return "default";
  }
  return null;
}
