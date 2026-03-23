import * as https from "https";
import * as http from "http";
import { URL } from "url";

export interface AlertChannels {
  slackWebhook?: string;
  pagerdutyKey?: string;
  alertWebhook?: string;
}

export interface HealthTransition {
  server: string;
  status: string;
  previousStatus?: string;
  latencyMs?: number;
  error?: string;
  timestamp: string;
}

/**
 * Posts JSON data to a URL using Node's built-in https/http module.
 */
function postJson(urlStr: string, body: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(urlStr);
    const mod = parsed.protocol === "https:" ? https : http;

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + (parsed.search ?? ""),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        // Drain the response body
        res.resume();
        res.on("end", resolve);
      },
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Sends a Slack notification via an incoming webhook URL.
 */
async function sendSlackAlert(webhookUrl: string, transition: HealthTransition): Promise<void> {
  const statusEmoji = transition.status === "healthy" ? ":white_check_mark:" : ":rotating_light:";

  const text = `${statusEmoji} *MCP Server Alert*: \`${transition.server}\` is now *${transition.status}*`;

  const blocks = [
    {
      type: "section",
      text: { type: "mrkdwn", text },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Server:*\n${transition.server}` },
        { type: "mrkdwn", text: `*Status:*\n${transition.status}` },
        ...(transition.previousStatus
          ? [{ type: "mrkdwn", text: `*Previous Status:*\n${transition.previousStatus}` }]
          : []),
        ...(transition.latencyMs !== undefined
          ? [{ type: "mrkdwn", text: `*Latency:*\n${transition.latencyMs}ms` }]
          : []),
        { type: "mrkdwn", text: `*Timestamp:*\n${transition.timestamp}` },
      ],
    },
  ];

  await postJson(webhookUrl, { text, blocks });
}

/**
 * Sends a PagerDuty alert via the Events API v2.
 *
 * - Triggers an incident for degraded/offline transitions.
 * - Resolves for healthy transitions.
 */
async function sendPagerDutyAlert(routingKey: string, transition: HealthTransition): Promise<void> {
  const isRecovery = transition.status === "healthy";
  const eventAction = isRecovery ? "resolve" : "trigger";

  const payload = {
    routing_key: routingKey,
    event_action: eventAction,
    dedup_key: `mcp-health-${transition.server}`,
    payload: {
      summary: `MCP server ${transition.server} is ${transition.status}`,
      source: transition.server,
      severity: transition.status === "offline" ? "critical" : "warning",
      timestamp: transition.timestamp,
      custom_details: {
        previous_status: transition.previousStatus,
        latency_ms: transition.latencyMs,
        error: transition.error,
      },
    },
  };

  await postJson("https://events.pagerduty.com/v2/enqueue", payload);
}

/**
 * Sends a generic webhook POST with health transition data.
 */
async function sendGenericWebhookAlert(
  webhookUrl: string,
  transition: HealthTransition,
): Promise<void> {
  await postJson(webhookUrl, {
    server: transition.server,
    status: transition.status,
    timestamp: transition.timestamp,
    latency_ms: transition.latencyMs,
    previous_status: transition.previousStatus,
    error: transition.error,
  });
}

/**
 * Sends health transition alerts to all configured channels.
 */
export async function sendAlert(
  channels: AlertChannels,
  transition: HealthTransition,
): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (channels.slackWebhook) {
    tasks.push(sendSlackAlert(channels.slackWebhook, transition));
  }

  if (channels.pagerdutyKey) {
    tasks.push(sendPagerDutyAlert(channels.pagerdutyKey, transition));
  }

  if (channels.alertWebhook) {
    tasks.push(sendGenericWebhookAlert(channels.alertWebhook, transition));
  }

  if (tasks.length === 0) {
    return;
  }

  await Promise.allSettled(tasks);
}
