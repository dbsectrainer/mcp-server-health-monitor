import { spawn } from "child_process";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 5000;
/**
 * Waits for a given number of milliseconds.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Attempts to restart a server process.
 *
 * - Respects restart_max_attempts (default: 3).
 * - Applies exponential backoff: waits `attempt * restart_backoff_ms` before restarting.
 * - Uses child_process.spawn to launch the server.
 *
 * @param serverConfig - Configuration for the server to restart.
 * @param attempt      - Current attempt number (1-based).
 */
export async function tryRestart(serverConfig, attempt) {
  const maxAttempts = serverConfig.restart_max_attempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffMs = serverConfig.restart_backoff_ms ?? DEFAULT_BACKOFF_MS;
  if (attempt > maxAttempts) {
    return {
      success: false,
      error: `Max restart attempts (${maxAttempts}) exceeded`,
      attempt,
    };
  }
  // Wait before restarting (attempt * backoff)
  const waitMs = attempt * backoffMs;
  if (waitMs > 0) {
    await delay(waitMs);
  }
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(serverConfig.command, serverConfig.args ?? [], {
      detached: true,
      stdio: "ignore",
    });
    child.on("spawn", () => {
      if (!settled) {
        settled = true;
        // Detach so the child outlives this process
        child.unref();
        resolve({
          success: true,
          pid: child.pid,
          attempt,
        });
      }
    });
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        resolve({
          success: false,
          error: err.message,
          attempt,
        });
      }
    });
  });
}
