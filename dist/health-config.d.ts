export interface ServerThresholds {
    latency_threshold_ms?: number;
    timeout_ms?: number;
}
export interface HealthConfig {
    defaults: ServerThresholds;
    servers: Record<string, ServerThresholds>;
}
export declare function loadHealthConfig(customPath?: string): HealthConfig;
export declare function getServerThresholds(config: HealthConfig, serverName: string, globalLatencyThreshold: number): {
    latency_threshold_ms: number;
    timeout_ms: number;
};
