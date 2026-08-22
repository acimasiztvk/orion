export interface InAppNotificationPayload {
  message: string;
  title?: string;
  priority?: 'info' | 'success' | 'warning' | 'critical';
  metadata?: Record<string, any>;
}

export interface InAppNotificationResult {
  id: string;
  success: boolean;
  title: string;
  message: string;
  priority: string;
  metadata?: Record<string, any>;
  createdAt: string;
  summary: string;
}

// In-memory queue for pending HUD alerts
const pendingAlertsQueue: InAppNotificationResult[] = [];

/**
 * Native & In-App HUD Alert Dispatcher
 * Dispatches alerts, task completion updates, and status messages strictly to the web UI HUD Toast,
 * panel telemetry, and native browser Notification API.
 */
export async function dispatchInAppAlert(
  payload: InAppNotificationPayload
): Promise<InAppNotificationResult> {
  const title = payload.title || 'ORION SYSTEM NOTIFICATION';
  const message = payload.message || '';
  const priority = payload.priority || 'info';
  const id = `alert_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const createdAt = new Date().toISOString();

  const summary = `HUD Alert [${priority.toUpperCase()}]: ${title} — ${message}`;

  console.log(`[HUD NOTIFIER] ${summary}`);

  const result: InAppNotificationResult = {
    id,
    success: true,
    title,
    message,
    priority,
    metadata: payload.metadata,
    createdAt,
    summary
  };

  pendingAlertsQueue.push(result);

  return result;
}

/**
 * Retrieves and clears pending notifications for client polling
 */
export function popPendingAlerts(userId?: string): InAppNotificationResult[] {
  if (pendingAlertsQueue.length === 0) return [];

  const matching: InAppNotificationResult[] = [];
  const remaining: InAppNotificationResult[] = [];

  for (const item of pendingAlertsQueue) {
    const itemUserId = item.metadata?.userId;
    if (!itemUserId || !userId || itemUserId === userId || itemUserId === 'all') {
      matching.push(item);
    } else {
      remaining.push(item);
    }
  }

  // Clear popped items
  pendingAlertsQueue.length = 0;
  pendingAlertsQueue.push(...remaining);

  return matching;
}

