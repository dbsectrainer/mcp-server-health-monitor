import type { RequestHandler } from "express";
/**
 * Creates a sliding-window rate limiter Express middleware.
 *
 * @param maxRequests - Maximum number of requests allowed per window.
 * @param windowMs    - Duration of the sliding window in milliseconds.
 */
export declare function createRateLimiter(maxRequests: number, windowMs: number): RequestHandler;
