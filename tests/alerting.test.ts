import { describe, it, expect, vi, beforeEach } from "vitest";

// --------------------------------------------------------------------------
// Mock https and http BEFORE importing sendAlert
// vi.mock is hoisted, so these factories run before module load
// --------------------------------------------------------------------------

const capturedRequests: Array<{ opts: unknown; body: string }> = [];

function makeMockModule() {
  const requestFn = vi.fn(
    (
      opts: unknown,
      cb: (res: { resume: () => void; on: (evt: string, fn: () => void) => void }) => void,
    ) => {
      const chunks: string[] = [];
      const reqObj = {
        on: vi.fn().mockReturnThis(),
        write: vi.fn((chunk: string) => {
          chunks.push(chunk);
        }),
        end: vi.fn(() => {
          capturedRequests.push({ opts, body: chunks.join("") });
          // Simulate response arriving and ending
          const fakeRes = {
            resume: vi.fn(),
            on: vi.fn((evt: string, fn: () => void) => {
              if (evt === "end") fn();
            }),
          };
          cb(fakeRes);
        }),
      };
      return reqObj;
    },
  );
  return { request: requestFn, default: { request: requestFn } };
}

vi.mock("https", () => makeMockModule());
vi.mock("http", () => makeMockModule());

// --------------------------------------------------------------------------
// Import AFTER mocking
// --------------------------------------------------------------------------

import { sendAlert } from "../src/alerting.js";
import type { HealthTransition, AlertChannels } from "../src/alerting.js";
import * as httpsModule from "https";
import * as httpModule from "http";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeTransition(overrides: Partial<HealthTransition> = {}): HealthTransition {
  return {
    server: "test-server",
    status: "offline",
    previousStatus: "healthy",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("sendAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRequests.length = 0;
  });

  it("is a no-op when no channels are configured", async () => {
    const channels: AlertChannels = {};
    await sendAlert(channels, makeTransition());

    expect(httpsModule.request).not.toHaveBeenCalled();
    expect(httpModule.request).not.toHaveBeenCalled();
  });

  it("sends HTTP POST to Slack webhook URL", async () => {
    const channels: AlertChannels = {
      slackWebhook: "https://hooks.slack.com/services/TEST/WEBHOOK",
    };

    await sendAlert(channels, makeTransition({ status: "offline" }));

    expect(httpsModule.request).toHaveBeenCalledTimes(1);
    const [opts] = (httpsModule.request as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { hostname: string; method: string },
      unknown,
    ];
    expect(opts.hostname).toBe("hooks.slack.com");
    expect(opts.method).toBe("POST");
  });

  it("sends body containing server and status for Slack", async () => {
    const channels: AlertChannels = {
      slackWebhook: "https://hooks.slack.com/services/SLACK",
    };
    const transition = makeTransition({ server: "my-server", status: "degraded" });

    await sendAlert(channels, transition);

    expect(capturedRequests).toHaveLength(1);
    const parsed = JSON.parse(capturedRequests[0]!.body) as { text: string; blocks: unknown[] };
    expect(parsed.text).toContain("my-server");
    expect(parsed.text).toContain("degraded");
    expect(Array.isArray(parsed.blocks)).toBe(true);
  });

  it("sends HTTP POST to PagerDuty events endpoint", async () => {
    const channels: AlertChannels = {
      pagerdutyKey: "pd-routing-key-abc",
    };

    await sendAlert(channels, makeTransition({ status: "offline" }));

    expect(httpsModule.request).toHaveBeenCalledTimes(1);
    const [opts] = (httpsModule.request as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { hostname: string; path: string; method: string },
      unknown,
    ];
    expect(opts.hostname).toBe("events.pagerduty.com");
    expect(opts.path).toBe("/v2/enqueue");
    expect(opts.method).toBe("POST");
  });

  it("sends trigger event to PagerDuty for offline status", async () => {
    const channels: AlertChannels = { pagerdutyKey: "key-123" };

    await sendAlert(channels, makeTransition({ status: "offline" }));

    expect(capturedRequests).toHaveLength(1);
    const parsed = JSON.parse(capturedRequests[0]!.body) as {
      event_action: string;
      routing_key: string;
    };
    expect(parsed.event_action).toBe("trigger");
    expect(parsed.routing_key).toBe("key-123");
  });

  it("sends resolve event to PagerDuty for healthy status", async () => {
    const channels: AlertChannels = { pagerdutyKey: "key-456" };

    await sendAlert(channels, makeTransition({ status: "healthy", previousStatus: "offline" }));

    expect(capturedRequests).toHaveLength(1);
    const parsed = JSON.parse(capturedRequests[0]!.body) as { event_action: string };
    expect(parsed.event_action).toBe("resolve");
  });

  it("sends HTTP POST to generic alert webhook", async () => {
    const channels: AlertChannels = {
      alertWebhook: "https://my-alerting-service.example.com/hook",
    };
    const transition = makeTransition({ server: "hook-server", status: "degraded" });

    await sendAlert(channels, transition);

    expect(httpsModule.request).toHaveBeenCalledTimes(1);
    expect(capturedRequests).toHaveLength(1);
    const parsed = JSON.parse(capturedRequests[0]!.body) as {
      server: string;
      status: string;
      timestamp: string;
    };
    expect(parsed.server).toBe("hook-server");
    expect(parsed.status).toBe("degraded");
    expect(parsed.timestamp).toBe(transition.timestamp);
  });

  it("sends to all channels when multiple are configured", async () => {
    const channels: AlertChannels = {
      slackWebhook: "https://hooks.slack.com/services/MULTI",
      pagerdutyKey: "pd-key",
      alertWebhook: "https://webhook.example.com/alert",
    };

    await sendAlert(channels, makeTransition());

    // All three are HTTPS URLs, so httpsModule.request should be called 3 times
    expect(httpsModule.request).toHaveBeenCalledTimes(3);
    expect(capturedRequests).toHaveLength(3);
  });
});
