import { getDb } from './db.js';
import { dispatchInAppAlert } from './notificationDispatcher.js';
import { generateOrionSpeech } from './gemini.js';

export interface DueReminder {
  id: string;
  user_id: string;
  text: string;
  datetime: string;
  status: string;
  fired_at?: string;
  created_at: string;
}

/**
 * Parses various datetime string formats into a valid JavaScript Date object
 */
export function parseReminderDate(dtStr: string): Date | null {
  if (!dtStr) return null;

  const trimmed = dtStr.trim();

  // Epoch timestamp (10 or 13 digits)
  if (/^\d{10,13}$/.test(trimmed)) {
    const num = Number(trimmed);
    return new Date(num > 1e11 ? num : num * 1000);
  }

  // Direct ISO/standard parse
  let d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d;
  }

  // Replace space with T for 'YYYY-MM-DD HH:mm:ss'
  d = new Date(trimmed.replace(' ', 'T'));
  if (!isNaN(d.getTime())) {
    return d;
  }

  return null;
}

/**
 * Scans `reminders` table for due/expired reminders that haven't been fired yet.
 */
export async function checkDueReminders(): Promise<DueReminder[]> {
  try {
    const { getDb } = await import('./db.js');
    const db = await getDb();

    // Query pending reminders that have not been fired yet
    const res = await db.query(
      `SELECT id, user_id, text, datetime, status, fired_at, created_at 
       FROM reminders 
       WHERE status = 'pending' AND fired_at IS NULL`
    );

    const now = new Date();
    const firedReminders: DueReminder[] = [];

    for (const row of res.rows) {
      const remDate = parseReminderDate(row.datetime);

      // If date is valid and target time has arrived/passed (or within past 24 hours)
      if (remDate && remDate.getTime() <= now.getTime()) {
        const id = row.id;
        const userId = row.user_id;
        const text = row.text;

        // Mark as fired in DB
        await db.query(
          `UPDATE reminders SET status = 'fired', fired_at = NOW() WHERE id = $1`,
          [id]
        );

        console.log(`[REMINDER ENGINE] 🔥 Reminder fired! ID: ${id}, Text: "${text}", Target: ${row.datetime}`);

        // Generate speech audio
        let audioBase64: string | null = null;
        try {
          audioBase64 = await generateOrionSpeech(`Reminder: ${text}`);
        } catch (e) {
          console.warn('[REMINDER ENGINE] Speech synthesis warning:', e);
        }

        // Dispatch alert to in-app notification system
        const alert = await dispatchInAppAlert({
          title: 'HATIRLATICI ZAMANI GELDI',
          message: text,
          priority: 'warning',
          metadata: {
            reminderId: id,
            userId,
            audioBase64
          }
        });

        firedReminders.push({
          id: row.id,
          user_id: row.user_id,
          text: row.text,
          datetime: row.datetime,
          status: 'fired',
          fired_at: now.toISOString(),
          created_at: typeof row.created_at === 'object' ? row.created_at.toISOString() : String(row.created_at)
        });
      }
    }

    return firedReminders;
  } catch (err: any) {
    console.error('[REMINDER ENGINE] Error checking due reminders:', err?.message || err);
    return [];
  }
}

/**
 * Initializes the background reminder check interval (runs every 10 seconds).
 */
export function startReminderScheduler(): void {
  console.log('[REMINDER ENGINE] Periodic 10-second reminder scheduler initialized.');

  // Check immediately 5 seconds after server start
  setTimeout(() => {
    checkDueReminders();
  }, 5000);

  // Poll every 10 seconds
  setInterval(() => {
    checkDueReminders();
  }, 10000);
}
