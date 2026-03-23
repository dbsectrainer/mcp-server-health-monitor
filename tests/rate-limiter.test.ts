import { describe, it, expect } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createRateLimiter } from "../src/rate-limiter.js";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeReq(ip = "127.0.0.1", apiKey?: string): Request {
  return {
    headers: apiKey ? { "x-api-key": apiKey } : {},
    ip,
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

interface CapturedResponse {
  statusCode: number | null;
  body: unknown;
  res: Response;
}

function makeRes(): CapturedResponse {
  const ctx: CapturedResponse = {
    statusCode: null,
    body: null,
    res: null as unknown as Response,
  };
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
  ctx.res = res;
  return ctx;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("createRateLimiter", () => {
  it("passes requests under the limit", () => {
    const limiter = createRateLimiter(5, 60000);
    const req = makeReq("10.0.0.1");

    for (let i = 0; i < 5; i++) {
      const { res } = makeRes();
      let nextCalled = false;
      limiter(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    }
  });

  it("returns 429 when over the limit", () => {
    const limiter = createRateLimiter(3, 60000);
    const req = makeReq("10.0.0.2");

    // Use up all 3 allowed requests
    for (let i = 0; i < 3; i++) {
      const { res } = makeRes();
      limiter(req, res, () => {});
    }

    // 4th request should be rejected
    const ctx = makeRes();
    let nextCalled = false;
    limiter(req, ctx.res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(ctx.statusCode).toBe(429);
    expect((ctx.body as { error: string }).error).toBe("Rate limit exceeded");
  });

  it("uses separate buckets per IP", () => {
    const limiter = createRateLimiter(2, 60000);
    const req1 = makeReq("192.168.1.1");
    const req2 = makeReq("192.168.1.2");

    // Exhaust IP 1
    for (let i = 0; i < 2; i++) {
      const { res } = makeRes();
      limiter(req1, res, () => {});
    }

    // IP 2 should still be allowed
    const ctx = makeRes();
    let nextCalled = false;
    limiter(req2, ctx.res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx.statusCode).toBeNull();
  });

  it("uses API key as bucket identifier when present", () => {
    const limiter = createRateLimiter(2, 60000);
    // Two different IPs using the same API key should share a bucket
    const req1 = makeReq("1.1.1.1", "shared-key");
    const req2 = makeReq("2.2.2.2", "shared-key");

    limiter(req1, makeRes().res, () => {});
    limiter(req2, makeRes().res, () => {});

    // Third request (same key, any IP) should be rejected
    const ctx = makeRes();
    let nextCalled = false;
    limiter(makeReq("3.3.3.3", "shared-key"), ctx.res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(ctx.statusCode).toBe(429);
  });

  it("allows maxRequests=0 to block all requests immediately", () => {
    const limiter = createRateLimiter(0, 60000);
    const req = makeReq("10.0.0.3");
    const ctx = makeRes();
    let nextCalled = false;

    limiter(req, ctx.res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(ctx.statusCode).toBe(429);
  });
});
