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
 * Sends health transition alerts to all configured channels.
 */
export declare function sendAlert(channels: AlertChannels, transition: HealthTransition): Promise<void>;
