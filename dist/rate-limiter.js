/**
 * Creates a sliding-window rate limiter Express middleware.
 *
 * @param maxRequests - Maximum number of requests allowed per window.
 * @param windowMs    - Duration of the sliding window in milliseconds.
 */
export function createRateLimiter(maxRequests, windowMs) {
    const store = new Map();
    return (req, res, next) => {
        // Use API key as the identifier if present, otherwise fall back to IP
        const apiKey = req.headers["x-api-key"];
        const key = typeof apiKey === "string" && apiKey.length > 0
            ? `key:${apiKey}`
            : `ip:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
        const now = Date.now();
        const windowStart = now - windowMs;
        let entry = store.get(key);
        if (!entry) {
            entry = { timestamps: [] };
            store.set(key, entry);
        }
        // Remove timestamps outside the current window
        entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
        if (entry.timestamps.length >= maxRequests) {
            res.status(429).json({ error: "Rate limit exceeded" });
            return;
        }
        entry.timestamps.push(now);
        next();
    };
}
