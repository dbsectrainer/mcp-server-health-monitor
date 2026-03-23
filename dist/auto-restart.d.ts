export interface RestartResult {
  success: boolean;
  pid?: number;
  error?: string;
  attempt: number;
}
export interface ServerConfig {
  name: string;
  command: string;
  args?: string[];
  auto_restart?: boolean;
  restart_max_attempts?: number;
  restart_backoff_ms?: number;
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
export declare function tryRestart(
  serverConfig: ServerConfig,
  attempt: number,
): Promise<RestartResult>;
