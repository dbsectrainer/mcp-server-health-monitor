import type { RequestHandler } from "express";
/**
 * Creates Express middleware that validates API key and/or JWT auth.
 *
 * - If MCP_API_KEY is set, the X-API-Key header must match.
 * - If MCP_JWT_SECRET is set, the Authorization: Bearer <token> header
 *   must contain a valid HMAC-SHA256 JWT signed with that secret.
 * - If neither env var is set, all requests pass through.
 */
export declare function createAuthMiddleware(): RequestHandler;
