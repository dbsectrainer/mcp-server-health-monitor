import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { createAuthMiddleware } from "../src/auth.js";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeReq(headers: Record<string, string> = {}): Request {
  return {
    headers,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;
}

function makeRes(): { res: Response; statusCode: number | null; body: unknown } {
  const ctx = { statusCode: null as number | null, body: null as unknown };
  const res = {
    status(code: number) {
      ctx.statusCode = code;
      return res;
    },
    json(data: unknown) {
      ctx.body = data;
      return res;
    },
    headersSent: false,
  } as unknown as Response;
  return { res, ...ctx };
}

function makeValidJwt(secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "test" })).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function makeInvalidJwt(): string {
  return "aaa.bbb.invalidsig";
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("createAuthMiddleware — no env vars", () => {
  beforeEach(() => {
    delete process.env["MCP_API_KEY"];
    delete process.env["MCP_JWT_SECRET"];
  });

  it("passes through when no auth env vars are set", () => {
    const middleware = createAuthMiddleware();
    const req = makeReq();
    const { res } = makeRes();
    let called = false;
    const next: NextFunction = () => {
      called = true;
    };

    middleware(req, res, next);
    expect(called).toBe(true);
  });
});

describe("createAuthMiddleware — MCP_API_KEY", () => {
  beforeEach(() => {
    process.env["MCP_API_KEY"] = "secret-key-123";
    delete process.env["MCP_JWT_SECRET"];
  });

  afterEach(() => {
    delete process.env["MCP_API_KEY"];
  });

  it("returns 401 when X-API-Key header is missing", () => {
    const middleware = createAuthMiddleware();
    const req = makeReq({});
    const { res, statusCode } = makeRes();
    let nextCalled = false;

    middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    // statusCode is captured via closure — re-read from ctx
    const ctx = makeRes();
    // Use the same res mock strategy with direct inspection
    let capturedCode: number | null = null;
    const resMock = {
      status(code: number) {
        capturedCode = code;
        return resMock;
      },
      json(_data: unknown) {
        return resMock;
      },
      headersSent: false,
    } as unknown as Response;

    middleware(req, resMock, () => {});
    expect(capturedCode).toBe(401);
    void ctx;
  });

  it("returns 401 when X-API-Key header has wrong value", () => {
    const middleware = createAuthMiddleware();
    const req = makeReq({ "x-api-key": "wrong-key" });
    let capturedCode: number | null = null;
    const res = {
      status(code: number) {
        capturedCode = code;
        return res;
      },
      json(_d: unknown) {
        return res;
      },
      headersSent: false,
    } as unknown as Response;

    middleware(req, res, () => {});
    expect(capturedCode).toBe(401);
  });

  it("passes through when X-API-Key header matches", () => {
    const middleware = createAuthMiddleware();
    const req = makeReq({ "x-api-key": "secret-key-123" });
    const { res } = makeRes();
    let nextCalled = false;

    middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });
});

describe("createAuthMiddleware — MCP_JWT_SECRET", () => {
  const secret = "my-test-secret";

  beforeEach(() => {
    delete process.env["MCP_API_KEY"];
    process.env["MCP_JWT_SECRET"] = secret;
  });

  afterEach(() => {
    delete process.env["MCP_JWT_SECRET"];
  });

  it("returns 401 when Authorization header is missing", () => {
    const middleware = createAuthMiddleware();
    const req = makeReq({});
    let capturedCode: number | null = null;
    const res = {
      status(code: number) {
        capturedCode = code;
        return res;
      },
      json(_d: unknown) {
        return res;
      },
      headersSent: false,
    } as unknown as Response;

    middleware(req, res, () => {});
    expect(capturedCode).toBe(401);
  });

  it("returns 401 when JWT signature is invalid", () => {
    const middleware = createAuthMiddleware();
    const req = makeReq({ authorization: `Bearer ${makeInvalidJwt()}` });
    let capturedCode: number | null = null;
    const res = {
      status(code: number) {
        capturedCode = code;
        return res;
      },
      json(_d: unknown) {
        return res;
      },
      headersSent: false,
    } as unknown as Response;

    middleware(req, res, () => {});
    expect(capturedCode).toBe(401);
  });

  it("passes through when JWT signature is valid", () => {
    const middleware = createAuthMiddleware();
    const token = makeValidJwt(secret);
    const req = makeReq({ authorization: `Bearer ${token}` });
    const { res } = makeRes();
    let nextCalled = false;

    middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });

  it("returns 401 for malformed JWT (wrong number of parts)", () => {
    const middleware = createAuthMiddleware();
    const req = makeReq({ authorization: "Bearer onlytwoparts.here" });
    let capturedCode: number | null = null;
    const res = {
      status(code: number) {
        capturedCode = code;
        return res;
      },
      json(_d: unknown) {
        return res;
      },
      headersSent: false,
    } as unknown as Response;

    middleware(req, res, () => {});
    expect(capturedCode).toBe(401);
  });
});
