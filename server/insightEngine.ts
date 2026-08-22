import {
  getUserProfileFacts,
  getReminders,
  getNotes,
  getConversations,
  getMessages,
  saveInsight,
  getPendingInsights,
  markInsightShown,
  Insight
} from './db.js';
import { generateContentWithRetry } from './gemini.js';
import { dispatchInAppAlert } from './notificationDispatcher.js';

/**
 * Context Synthesis Engine (KATMAN 2)
 * Periodically aggregates user profile facts, active reminders, notes, and recent conversation logs,
 * sends them to Gemini to detect non-obvious correlations, implicit risks, or proactive opportunities,
 * and records structured insights to the `insights` database table.
 */
export async function synthesizeUserInsights(userId: string): Promise<Insight | null> {
  console.log(`[INSIGHT ENGINE] Running background context synthesis for user: ${userId}...`);

  try {
    // 1. Gather User Context Snapshot
    const profileFacts = await getUserProfileFacts(userId);
    const reminders = await getReminders(userId);
    const notes = await getNotes(userId);
    const conversations = await getConversations(userId);

    // Fetch recent messages across top 3 conversations
    const recentConvs = conversations.slice(0, 3);
    const conversationSummaries: string[] = [];

    for (const conv of recentConvs) {
      const msgs = await getMessages(conv.id);
      const lastMsgs = msgs.slice(-4).map(m => `[${m.sender.toUpperCase()}]: ${m.text}`);
      if (lastMsgs.length > 0) {
        conversationSummaries.push(`Conversation '${conv.title}' (${conv.updated_at}):\n${lastMsgs.join('\n')}`);
      }
    }

    // Prepare text representations
    const factsText = profileFacts.length > 0
      ? profileFacts.map(f => `- [${f.category}] ${f.key}: ${f.value} (confidence: ${f.confidence || 0.9})`).join('\n')
      : 'No profile facts recorded.';

    const remindersText = reminders.length > 0
      ? reminders.map(r => `- [${(r.status || 'pending').toUpperCase()}] ${r.text} (due: ${r.datetime || 'N/A'})`).join('\n')
      : 'No active reminders.';

    const notesText = notes.length > 0
      ? notes.map(n => `- [${n.category || 'General'}]: ${n.content.substring(0, 150)}...`).join('\n')
      : 'No notes saved.';

    const convsText = conversationSummaries.length > 0
      ? conversationSummaries.join('\n\n')
      : 'No recent chat history.';

    // Check existing pending insights to prevent duplicate spam
    const existingPending = await getPendingInsights(userId);

    const prompt = `You are ORION's Background Context Synthesis Engine.
Your task is to analyze a user's multi-dimensional context (Profile Facts, Active Reminders, Saved Notes, and Recent Chat History) to detect non-obvious correlations, hidden workload patterns, implicit conflicts, or high-value proactive suggestions.

=== USER CONTEXT SNAPSHOT ===
[PROFILE FACTS & MEMORY MATRIX]:
${factsText}

[REMINDERS & DEADLINES]:
${remindersText}

[NOTES ARCHIVE]:
${notesText}

[RECENT CONVERSATION LOGS]:
${convsText}

=== INSTRUCTIONS ===
1. Analyze if there is a non-obvious connection, implicit risk, or proactive opportunity across these items that the user might have overlooked (e.g. "User mentions a heavy new project in chat, has 3 overdue reminders, and noted high stress—suggest prioritizing or delegating").
2. Do NOT report trivial restatements of a single existing fact or reminder.
3. Keep the insight concise (1-2 sentences), actionable, professional, and written in Turkish or English matching user language.
4. Output MUST be valid strictly formatted JSON as follows:

If a valuable non-obvious insight is found:
{
  "hasInsight": true,
  "insightText": "Kullanıcının X projesiyle ilgili aldığı not ile yarınki Y hatırlatıcısı çakışabilir...",
  "sourceType": "profile_fact" | "reminder" | "note" | "conversation",
  "sourceId": "optional_id_or_category"
}

If NO meaningful new insight is detected:
{
  "hasInsight": false
}
`;

    const aiResponse = await generateContentWithRetry({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    });

    const responseText = (aiResponse.text || "").trim();
    let parsed: any = {};

    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      // Clean JSON markdown wraps if present
      const cleaned = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    }

    if (parsed.hasInsight && parsed.insightText) {
      const insightText = String(parsed.insightText).trim();

      // Avoid duplicating if an identical text is already pending
      const isDuplicate = existingPending.some(i => i.insight_text.toLowerCase() === insightText.toLowerCase());
      if (!isDuplicate) {
        const saved = await saveInsight(
          userId,
          insightText,
          parsed.sourceType || 'synthesis',
          parsed.sourceId || undefined
        );

        console.log(`[INSIGHT ENGINE] New synthesis insight created: ${saved.id} -> "${insightText}"`);

        // Dispatch HUD Notification Alert
        await dispatchInAppAlert({
          title: 'ORION PROACTIVE INSIGHT SYNTHESIZED',
          message: insightText,
          priority: 'info',
          metadata: { insightId: saved.id }
        });

        return saved;
      } else {
        console.log(`[INSIGHT ENGINE] Insight already pending, skipped duplicate.`);
      }
    } else {
      console.log(`[INSIGHT ENGINE] No new non-obvious insight detected at this time.`);
    }

    return null;
  } catch (err: any) {
    // Suppress quota/billing errors to avoid platform alert noise
    const errString = typeof err === 'object' ? JSON.stringify(err) : String(err);
    if (err?.status === 429 || err?.error?.code === 429 || errString.includes('429') || errString.includes('RESOURCE_EXHAUSTED')) {
      console.log(`[INSIGHT ENGINE] Background synthesis paused for ${userId} (quota exceeded).`);
    } else {
      console.log(`[INSIGHT ENGINE] Background synthesis skipped or failed for ${userId}:`, err?.message || errString);
    }
    return null;
  }
}

/**
 * Start periodic background scheduler (runs every 6 hours and on startup)
 */
export function startInsightEngineScheduler(): void {
  console.log('[INSIGHT ENGINE] Background scheduler initialized.');

  // Initial trigger 15 seconds after server boot
  setTimeout(async () => {
    try {
      await synthesizeUserInsights('user_tony');
    } catch (err) {
      console.log('[INSIGHT ENGINE] Initial boot run error:', err);
    }
  }, 15000);

  // Periodic interval every 6 hours
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      await synthesizeUserInsights('user_tony');
    } catch (err) {
      console.log('[INSIGHT ENGINE] Periodic run error:', err);
    }
  }, SIX_HOURS_MS);
}
