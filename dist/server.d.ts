import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type Database from "better-sqlite3";
export interface HealthMonitorOptions {
    db: Database.Database;
    latencyThreshold: number;
    startupGraceSeconds: number;
    configPath?: string;
    healthConfigPath?: string;
    manualServersPath?: string;
}
export declare function createHealthMonitorServer(options: HealthMonitorOptions): Server;
export declare function startServer(options: HealthMonitorOptions): Promise<void>;
