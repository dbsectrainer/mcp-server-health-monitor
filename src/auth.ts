import * as crypto from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Creates Express middleware that validates API key and/or JWT auth.
 *
 * - If MCP_API_KEY is set, the X-API-Key header must match.
 * - If MCP_JWT_SECRET is set, the Authorization: Bearer <token> header
 *   must contain a valid HMAC-SHA256 JWT signed with that secret.
 * - If neither env var is set, all requests pass through.
 */
export function createAuthMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = process.env["MCP_API_KEY"];
    const jwtSecret = process.env["MCP_JWT_SECRET"];

    // If no auth configured, pass through
    if (!apiKey && !jwtSecret) {
      next();
      return;
    }

    // Validate API key if configured
    if (apiKey) {
      const provided = req.headers["x-api-key"];
      if (!provided || provided !== apiKey) {
        res.status(401).json({ error: "Unauthorized: invalid or missing X-API-Key" });
        return;
      }
    }

    // Validate JWT if configured
    if (jwtSecret) {
      const authHeader = req.headers["authorization"];
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Unauthorized: missing Authorization: Bearer token" });
        return;
      }

      const token = authHeader.slice(7);
      const parts = token.split(".");
      if (parts.length !== 3) {
        res.status(401).json({ error: "Unauthorized: malformed JWT" });
        return;
      }

      const [h, p, s] = parts as [string, string, string];
      const expected = crypto
        .createHmac("sha256", jwtSecret)
        .update(h + "." + p)
        .digest("base64url");

      if (expected !== s) {
        res.status(401).json({ error: "Unauthorized: invalid JWT signature" });
        return;
      }
    }

    next();
  };
}
