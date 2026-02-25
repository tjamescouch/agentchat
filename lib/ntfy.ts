/**
 * NTFY Notification Utility
 * Sends kill/disconnect notifications to NTFY service
 */

/**
 * Send NTFY notification for moderation events
 * @param secret NTFY topic secret
 * @param event Event type (kick, ban, disconnect)
 * @param agentId Agent ID
 * @param agentName Agent display name / nick
 * @param reason Optional reason for the action
 */
export async function sendNtfyNotification(
  secret: string | null,
  event: 'kick' | 'ban' | 'disconnect',
  agentId: string,
  agentName: string,
  reason?: string
): Promise<void> {
  if (!secret) return;

  try {
    const topic = secret;
    const title = `${event.toUpperCase()}: ${agentName}`;
    const body = reason ? `@${agentId} (${agentName}) — ${reason}` : `@${agentId} (${agentName})`;

    const response = await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Content-Type': 'text/plain',
      },
      body: body,
    });

    if (!response.ok) {
      console.error(`[NTFY] Notification failed: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.error('[NTFY] Notification error:', err);
  }
}
