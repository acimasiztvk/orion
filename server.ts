import express from "express";
import http from "http";
import path from "path";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { LiveServerMessage, Modality } from "@google/genai";
import {
  getGeminiClient,
  buildOrionSystemInstruction,
  toolDeclarations,
  executeToolCall,
  generateOrionSpeech,
  generateContentWithRetry,
  getCircuitBreakerStatus,
  resetCircuitBreaker
} from "./server/gemini.js";
import {
  getDb,
  createUser,
  authenticateUser,
  getUserById,
  completeUserOnboarding,
  getConversations,
  createConversation,
  deleteConversation,
  getMessages,
  saveMessage,
  getUserProfileFacts,
  saveProfileFact,
  getReminders,
  saveReminder,
  toggleReminderStatus,
  deleteReminder,
  getNotes,
  saveNote,
  deleteNote,
  searchJobs,
  getToolLogs,
  createPasswordResetToken,
  resetPasswordWithToken,
  saveRefreshToken,
  verifyAndRotateRefreshToken,
  deleteRefreshToken,
  createEmailVerificationCode,
  getLastVerificationCodeTime,
  verifyEmailCode,
  setUserEmailVerified,
  validatePasswordStrength,
  validateEmailFormat,
  inspectDatabaseSummary,
  getPhoneCalls,
  getPhoneCallById,
  updatePhoneCall,
  getPendingDecisionCalls,
  getContacts,
  getContactById,
  createOrUpdateContact,
  deleteContact,
  resolveContactByNameOrEmail,
  searchContacts,
  findOrCreateOAuthUser,
  getPendingInsights,
  markInsightShown,
  markInsightDismissed,
  User
} from "./server/db.js";

import { sendVerificationEmail } from "./server/email.js";
import { synthesizeUserInsights, startInsightEngineScheduler } from "./server/insightEngine.js";
import { startReminderScheduler } from "./server/reminderEngine.js";
import { formatExtractedContent } from "./server/actionEngine.js";
import { popPendingAlerts } from "./server/notificationDispatcher.js";

dotenv.config();

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "orion_stark_quantum_jwt_secret_key_2026";
const app = express();
app.use(express.json({ limit: "25mb" }));

// HTTP Server instance
const server = http.createServer(app);

// WebSocket Server attached to HTTP server
const wss = new WebSocketServer({ server, path: "/live" });

// Helper to generate JWT access token (2 hour validity)
function generateAccessToken(user: User): string {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, has_completed_onboarding: user.has_completed_onboarding },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
}

function generateRefreshTokenString(): string {
  return `rft_${Date.now()}_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
}

// Authentication Middleware - Seamless Guest / Default Fallback (No token required)
async function authenticateToken(req: any, _res: any, next: any) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : null;

  if (!token || token === "undefined" || token === "null") {
    // Seamless fallback to default user so no token is needed to use the application!
    let defaultUser = await getUserById("user_tony");
    if (!defaultUser) {
      defaultUser = { id: "user_tony", name: "Commander", email: "commander@stark.ai", email_verified: true, has_completed_onboarding: true, auth_provider: 'email', created_at: new Date().toISOString() };
    }
    req.user = defaultUser;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    let user = await getUserById(decoded.id);
    if (!user) {
      user = await getUserById("user_tony") || { id: "user_tony", name: "Commander", email: "commander@stark.ai", email_verified: true, has_completed_onboarding: true, auth_provider: 'email', created_at: new Date().toISOString() };
    }
    req.user = user;
    next();
  } catch (err) {
    // If token is expired or invalid, seamlessly fallback to default user instead of failing
    let defaultUser = await getUserById("user_tony");
    if (!defaultUser) {
      defaultUser = { id: "user_tony", name: "Commander", email: "commander@stark.ai", email_verified: true, has_completed_onboarding: true, auth_provider: 'email', created_at: new Date().toISOString() };
    }
    req.user = defaultUser;
    next();
  }
}

// Health check with PostgreSQL engine verification
app.get("/api/health", async (_req, res) => {
  try {
    const db = await getDb();
    res.json({
      status: "ok",
      service: "ORION Core AI",
      database: db.isRemote ? "Hosted PostgreSQL (pg.Pool)" : "Embedded PostgreSQL (PGlite)",
      timestamp: new Date().toISOString()
    });
  } catch (e: any) {
    res.json({ status: "ok", service: "ORION Core AI", database: "Initializing", error: e.message });
  }
});

// ----------------------------------------------------
// TRANSACTIONAL EMAIL (Resend API imported from server/email.ts)
// ----------------------------------------------------

// ----------------------------------------------------
// AUTHENTICATION ROUTES (PostgreSQL, Bcrypt, JWT + Refresh)
// ----------------------------------------------------

app.post(["/api/auth/register", "/api/auth/signup"], async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const emailCheck = validateEmailFormat(email);
    if (!emailCheck.valid) {
      return res.status(400).json({ error: emailCheck.error });
    }

    const passCheck = validatePasswordStrength(password);
    if (!passCheck.valid) {
      return res.status(400).json({ error: passCheck.error });
    }

    const user = await createUser(email, password, name);
    const code = await createEmailVerificationCode(user.id);
    await sendVerificationEmail(user.email, code, user.name);

    res.status(201).json({
      message: "Verification code sent to your email.",
      userId: user.id,
      email: user.email,
      requiresVerification: true
    });
  } catch (err: any) {
    const isConflict = err.message?.includes("already exists");
    res.status(isConflict ? 409 : 400).json({ error: err.message || "Failed to create account." });
  }
});

app.post("/api/auth/verify-email", async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({ error: "User ID and 6-digit verification code are required." });
    }

    const result = await verifyEmailCode(userId, code);
    if (!result.success || !result.user) {
      return res.status(400).json({ error: result.error || "Email verification failed." });
    }

    const token = generateAccessToken(result.user);
    const refreshToken = generateRefreshTokenString();
    const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await saveRefreshToken(result.user.id, refreshToken, refreshExpires);

    res.json({
      success: true,
      message: "Email verified successfully.",
      token,
      refreshToken,
      user: result.user
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to verify email code." });
  }
});

app.post("/api/auth/resend-code", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required." });
    }

    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: "User account not found." });
    }

    if (user.email_verified) {
      return res.status(400).json({ error: "This email address is already verified. You may log in directly." });
    }

    // Rate limit: max 1 per 60 seconds
    const lastTime = await getLastVerificationCodeTime(userId);
    if (lastTime) {
      const elapsed = Date.now() - lastTime.getTime();
      if (elapsed < 60000) {
        const secondsLeft = Math.ceil((60000 - elapsed) / 1000);
        return res.status(429).json({
          error: `Please wait ${secondsLeft} seconds before requesting a new verification code.`,
          retryAfter: secondsLeft
        });
      }
    }

    const newCode = await createEmailVerificationCode(userId);
    await sendVerificationEmail(user.email, newCode, user.name);

    res.json({
      success: true,
      message: "A new 6-digit verification code has been dispatched to your email."
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to resend verification code." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await authenticateUser(email, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials. Please verify your email and password." });
    }

    // Check if email is verified
    if (!user.email_verified) {
      return res.status(403).json({
        error: "Your email address has not been verified. Please enter the verification code sent to your email.",
        code: "EMAIL_NOT_VERIFIED",
        userId: user.id,
        email: user.email
      });
    }

    const token = generateAccessToken(user);
    const refreshToken = generateRefreshTokenString();
    const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await saveRefreshToken(user.id, refreshToken, refreshExpires);

    res.json({ token, refreshToken, user });
  } catch (err: any) {
    res.status(401).json({ error: err.message || "Authentication failed." });
  }
});

// Refresh Token Endpoint
app.post("/api/auth/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token required." });
    }

    const user = await verifyAndRotateRefreshToken(refreshToken);
    if (!user) {
      return res.status(401).json({ error: "Invalid or expired refresh token. Please log in again." });
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshTokenString();
    const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await deleteRefreshToken(refreshToken);
    await saveRefreshToken(user.id, newRefreshToken, refreshExpires);

    res.json({ token: newAccessToken, refreshToken: newRefreshToken, user });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to refresh token." });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await deleteRefreshToken(refreshToken);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Universal Google OAuth Workspace Synchronization & Login
app.post("/api/auth/google-sync", async (req, res) => {
  try {
    const { email, name, google_id, googleId } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email address required from Google Auth." });
    }

    const gId = google_id || googleId;
    const user = await findOrCreateOAuthUser(email, name, gId);
    const token = generateAccessToken(user);
    const refreshToken = generateRefreshTokenString();
    const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await saveRefreshToken(user.id, refreshToken, refreshExpires);

    res.json({ token, refreshToken, user, isNewSignup: !user.has_completed_onboarding });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to process Google sign-in." });
  }
});

// Forgot Password Flow
app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email address required." });

    const result = await createPasswordResetToken(email);
    if (!result) {
      return res.json({
        success: true,
        message: "If an account exists with this email, password recovery instructions have been dispatched."
      });
    }

    console.log(`[ORION AUTH] Password recovery link created for ${email}: resetToken=${result.token}`);

    res.json({
      success: true,
      message: "Password recovery link created successfully.",
      resetToken: result.token,
      testResetUrl: `/reset-password?token=${result.token}`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to process password recovery." });
  }
});

// Reset Password Flow
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: "Reset token and new password are required." });
    }

    const result = await resetPasswordWithToken(token, newPassword);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, message: "Your password has been successfully updated. You may now log in." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to reset password." });
  }
});

app.get("/api/auth/me", authenticateToken, async (req: any, res) => {
  res.json({ user: req.user });
});

app.post("/api/auth/complete-onboarding", authenticateToken, async (req: any, res) => {
  try {
    await completeUserOnboarding(req.user.id);
    const updatedUser = await getUserById(req.user.id);
    res.json({ success: true, user: updatedUser });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Database Inspection for Verification
app.get("/api/system/db-inspect", async (_req, res) => {
  try {
    const summary = await inspectDatabaseSummary();
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// CONVERSATIONS API (User Scoped)
// ----------------------------------------------------

app.get("/api/conversations", authenticateToken, async (req: any, res) => {
  try {
    const list = await getConversations(req.user.id);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/conversations", authenticateToken, async (req: any, res) => {
  try {
    const { title } = req.body;
    const conv = await createConversation(req.user.id, title);
    res.json(conv);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/conversations/:id", authenticateToken, async (req, res) => {
  try {
    await deleteConversation(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/conversations/:id/messages", authenticateToken, async (req, res) => {
  try {
    const messages = await getMessages(req.params.id);
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// PROFILE / MEMORY MATRIX (User Scoped)
// ----------------------------------------------------

app.get("/api/profile", authenticateToken, async (req: any, res) => {
  try {
    const facts = await getUserProfileFacts(req.user.id);
    res.json(facts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/profile", authenticateToken, async (req: any, res) => {
  try {
    const { category, key, value } = req.body;
    const fact = await saveProfileFact(req.user.id, category, key, value);
    res.json(fact);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// REMINDERS / TASKS (User Scoped)
// ----------------------------------------------------

app.get("/api/reminders", authenticateToken, async (req: any, res) => {
  try {
    const list = await getReminders(req.user.id);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/reminders", authenticateToken, async (req: any, res) => {
  try {
    const { text, datetime } = req.body;
    const rem = await saveReminder(req.user.id, text, datetime);
    res.json(rem);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/reminders/:id/toggle", authenticateToken, async (req: any, res) => {
  try {
    await toggleReminderStatus(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/reminders/:id", authenticateToken, async (req, res) => {
  try {
    await deleteReminder(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// NOTES (User Scoped)
// ----------------------------------------------------

app.get("/api/notes", authenticateToken, async (req: any, res) => {
  try {
    const list = await getNotes(req.user.id);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/notes", authenticateToken, async (req: any, res) => {
  try {
    const { category, content } = req.body;
    const note = await saveNote(req.user.id, category, content);
    res.json(note);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/notes/:id", authenticateToken, async (req, res) => {
  try {
    await deleteNote(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// BACKGROUND CONTEXT SYNTHESIS (Insights API)
// ----------------------------------------------------

app.get("/api/insights", authenticateToken, async (req: any, res) => {
  try {
    const list = await getPendingInsights(req.user.id);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/insights/synthesize", authenticateToken, async (req: any, res) => {
  try {
    const insight = await synthesizeUserInsights(req.user.id);
    res.json({ success: true, insight });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/insights/:id/status", authenticateToken, async (req: any, res) => {
  try {
    const { status } = req.body;
    if (status === "shown") {
      await markInsightShown(req.params.id);
    } else if (status === "dismissed") {
      await markInsightDismissed(req.params.id);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/alerts/pending", authenticateToken, async (req: any, res) => {
  try {
    const alerts = popPendingAlerts(req.user.id);
    res.json(alerts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// CONTACTS BOOK (User Scoped & Persistent)
// ----------------------------------------------------

app.get("/api/contacts", authenticateToken, async (req: any, res) => {
  try {
    const q = req.query.q as string | undefined;
    if (q) {
      const results = await searchContacts(req.user.id, q);
      return res.json(results);
    }
    const list = await getContacts(req.user.id);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/contacts/resolve", authenticateToken, async (req: any, res) => {
  try {
    const q = (req.query.q || req.query.name || req.query.email) as string;
    if (!q) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }
    const resolved = await resolveContactByNameOrEmail(req.user.id, q);
    res.json({ contact: resolved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/contacts", authenticateToken, async (req: any, res) => {
  try {
    const { id, name, email, phone, company, relationship, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Contact name is required." });
    }
    const saved = await createOrUpdateContact(req.user.id, {
      id,
      name,
      email,
      phone,
      company,
      relationship,
      notes
    });
    res.json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/contacts/:id", authenticateToken, async (req: any, res) => {
  try {
    const success = await deleteContact(req.user.id, req.params.id);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Configuration & System Flags
let silentExecutionMode: boolean = process.env.SILENT_EXECUTION_MODE !== "false";

app.get("/api/config", (_req, res) => {
  res.json({
    silent_execution_mode: silentExecutionMode
  });
});

app.post("/api/config", authenticateToken, (req: any, res) => {
  try {
    const { silent_execution_mode } = req.body;
    if (typeof silent_execution_mode === "boolean") {
      silentExecutionMode = silent_execution_mode;
    }
    res.json({
      success: true,
      silent_execution_mode: silentExecutionMode
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// TOOL LOGS (User Scoped)
// ----------------------------------------------------

app.get("/api/tool-logs", authenticateToken, async (req: any, res) => {
  try {
    const { runId } = req.query;
    const logs = await getToolLogs(req.user.id, typeof runId === "string" ? runId : undefined);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// OUTBOUND PHONE CALLS & VAPI INTEGRATION
// ----------------------------------------------------

app.get("/api/phone-calls", authenticateToken, async (req: any, res) => {
  try {
    const calls = await getPhoneCalls(req.user.id);
    res.json(calls);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/phone-calls/pending-decisions", authenticateToken, async (req: any, res) => {
  try {
    const pending = await getPendingDecisionCalls(req.user.id);
    res.json(pending);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// User response to a paused decision point during an active phone call
app.post("/api/phone-calls/:id/respond", authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { response } = req.body;
    if (!response) {
      return res.status(400).json({ error: "Response text is required." });
    }

    const updated = await updatePhoneCall(id, {
      requires_user_action: false,
      user_action_response: response,
      status: "in_progress"
    });

    console.log(`[ORION VAPI] User responded to decision point for call ${id}: "${response}"`);
    res.json({ success: true, call: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Vapi Webhook receiver for real-time status updates, transcripts, and decision point notifications
app.post("/api/phone-calls/vapi-webhook", async (req, res) => {
  try {
    const event = req.body?.message || req.body;
    const type = event?.type;
    const callId = event?.call?.id || req.body?.call?.id || req.body?.id;

    console.log(`[ORION VAPI WEBHOOK] Received event: ${type} for call: ${callId}`);

    if (callId) {
      if (type === "status-update") {
        const status = event?.status || "in_progress";
        await updatePhoneCall(callId, { status });
      } else if (type === "end-of-call-report") {
        const transcript = event?.transcript || event?.artifact?.transcript || "";
        const summary = event?.summary || event?.analysis?.summary || "";
        const status = event?.endedReason || "completed";
        await updatePhoneCall(callId, {
          status,
          transcript,
          summary,
          requires_user_action: false
        });
      } else if (type === "tool-calls" || type === "function-call") {
        // Handle pause & ask user decision points
        const toolCallName = event?.toolCall?.function?.name || event?.functionCall?.name;
        const toolArgs = event?.toolCall?.function?.arguments || event?.functionCall?.parameters;
        if (toolCallName === "request_user_decision" || toolCallName === "ask_commander") {
          const prompt = typeof toolArgs === "object" ? (toolArgs.prompt || toolArgs.question || JSON.stringify(toolArgs)) : String(toolArgs);
          await updatePhoneCall(callId, {
            requires_user_action: true,
            user_action_prompt: prompt,
            status: "paused_awaiting_user"
          });
          return res.json({
            results: [{
              toolCallId: event?.toolCall?.id,
              result: "Notification sent to Commander. Awaiting response."
            }]
          });
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (webhookErr: any) {
    console.error("[ORION VAPI WEBHOOK] Error processing webhook:", webhookErr);
    res.status(200).json({ error: webhookErr.message });
  }
});

// ----------------------------------------------------
// JOBS SEARCH
// ----------------------------------------------------

app.get("/api/jobs", async (req, res) => {
  try {
    const { query, location, salary_min } = req.query;
    const list = await searchJobs(
      typeof query === "string" ? query : undefined,
      typeof location === "string" ? location : undefined,
      salary_min ? Number(salary_min) : undefined
    );
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// TTS AUDIO GENERATION
// ----------------------------------------------------

app.post("/api/tts", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Text required" });
    const audio = await generateOrionSpeech(text);
    res.json({ audio });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// CHAT / COMMAND HANDLER WITH FIRST MEETING SUPPORT & TIMEOUT CEILING
// ----------------------------------------------------

app.post("/api/chat", authenticateToken, async (req: any, res) => {
  const user: User = req.user;
  const { message, conversationId, generateAudio = true } = req.body;
  if (!message) return res.status(400).json({ error: "Message required" });

  const convId = conversationId || `conv_${user.id}_init`;
  const taskRunId = req.body.taskRunId || `run_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const TASK_TIMEOUT_MS = 90000; // 90-second maximum execution timeout ceiling

  await saveMessage(convId, "user", message, undefined, undefined, false, user.id);

  // Helper with race for hard timeout ceiling
  const executeChatPipeline = async () => {
    // Pull current memory profile and pending proactive insights to enrich context
    const profileFacts = await getUserProfileFacts(user.id);
    const pendingInsights = await getPendingInsights(user.id);
    const isOnboarding = !user.has_completed_onboarding;
    const systemInstruction = buildOrionSystemInstruction(user, profileFacts, isOnboarding, true, pendingInsights);

    // Retrieve recent conversation history
    const history = await getMessages(convId);
    const recentMessages = history.slice(-10);

    const contents: any[] = [];
    
    // Add past messages to contents for smooth conversational flow
    for (const msg of recentMessages) {
      if (msg.sender === "user") {
        contents.push({ role: "user", parts: [{ text: msg.text }] });
      } else if (msg.sender === "orion") {
        contents.push({ role: "model", parts: [{ text: msg.text }] });
      }
    }

    // Generate response with tools enabled and resilient single-model retry
    const response = await generateContentWithRetry({
      model: "gemini-3.6-flash",
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: toolDeclarations }]
      },
      maxRetries: 3
    });

    let replyText = response.text || "";
    const executedTools: any[] = [];
    const clientActions: any[] = [];
    let detectedRunId: string = taskRunId;

    // Check if tools were called
    const functionCalls = response.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
      for (const call of functionCalls) {
        try {
          const { result, clientAction } = await executeToolCall(call.name, call.args, user.id);
          executedTools.push({ name: call.name, args: call.args, result });
          if (clientAction) {
            clientActions.push(clientAction);
            if (clientAction.runId) detectedRunId = clientAction.runId;
          }
          if (result?.runId) detectedRunId = result.runId;
        } catch (toolExecErr: any) {
          console.error(`[ORION AI] Tool execution failed for ${call.name}:`, toolExecErr);
          executedTools.push({
            name: call.name,
            args: call.args,
            result: {
              success: false,
              error: toolExecErr.message || "Execution exception",
              summaryMessage: `I wasn't able to complete the ${call.name} task — ${toolExecErr.message || "An unexpected error occurred."}`
            }
          });
        }
      }

      // Re-invoke model with tool execution results to provide natural follow-up response
      try {
        const toolResponsesParts = executedTools.map((t) => ({
          functionResponse: {
            name: t.name,
            response: {
              success: t.result?.success !== false,
              summaryMessage: t.result?.summaryMessage || t.result?.message,
              extracted_content: t.result?.extracted_content || t.result?.data?.extracted_content,
              data: t.result?.data || t.result
            }
          }
        }));

        const followUpContents = [
          ...contents,
          response.candidates?.[0]?.content,
          {
            role: "tool",
            parts: toolResponsesParts
          }
        ];

        const followUpResponse = await generateContentWithRetry({
          model: "gemini-3.6-flash",
          contents: followUpContents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: toolDeclarations }]
          },
          maxRetries: 3
        });

        if (followUpResponse.text && followUpResponse.text.trim()) {
          replyText = followUpResponse.text;
        }
      } catch (toolFollowUpErr) {
        console.warn("[ORION AI] Follow-up generation using smart contextual synthesis:", toolFollowUpErr);
      }

      // If replyText is still empty or minimal after tool execution, build explicit high-fidelity outcome summary
      if (!replyText || replyText.trim().length < 5) {
        const toolSummaries: string[] = [];
        for (const t of executedTools) {
          if (t.name === "delegate_to_claude") {
            if (t.result?.success) {
              toolSummaries.push(t.result.summaryMessage || `Claude completed analysis: ${t.result?.data?.result?.slice(0, 300)}`);
            } else {
              toolSummaries.push(t.result?.summaryMessage || `I wasn't able to complete the delegation to Claude — ${t.result?.error || "credentials not configured"}.`);
            }
          } else if (t.name === "browser_task_automation") {
            const target = t.args?.target_platform || t.result?.data?.platform || "target website";
            const rawExtracted = t.result?.extracted_content || t.result?.data?.extracted_content;
            const extracted = formatExtractedContent(rawExtracted);
            if (extracted) {
              toolSummaries.push(`Completed autonomous browser workflow on ${target}:\n\n${extracted}`);
            } else {
              const count = t.result?.data?.step_count || t.result?.data?.executed_steps?.length || t.args?.steps?.length || 0;
              toolSummaries.push(`Completed autonomous browser workflow on ${target} successfully (${count} phase events logged).`);
            }
          } else if (t.name === "notify_user" || t.name === "send_instant_notification") {
            toolSummaries.push(t.result?.summaryMessage || `In-App notification displayed: "${t.args?.title || t.args?.message}".`);
          } else if (t.name === "make_phone_call") {
            if (t.result?.success) {
              toolSummaries.push(`Outbound voice call placed to ${t.args?.phone_number || 'destination'}. Channel established via Vapi AI.`);
            } else if (t.result?.requires_setup) {
              toolSummaries.push(`I wasn't able to place the outbound call — VAPI credentials (API Key, Assistant ID, Phone Number ID) need to be configured in Settings.`);
            } else {
              toolSummaries.push(`I wasn't able to place the call to ${t.args?.phone_number || 'destination'} — ${t.result?.error || 'telephony dispatch failed'}.`);
            }
          } else if (t.name === "execute_api_action") {
            if (t.result?.success) {
              toolSummaries.push(`Successfully executed API action on ${t.args?.service_name || 'external service'} (HTTP ${t.result?.data?.status || 200}).`);
            } else {
              toolSummaries.push(`I wasn't able to complete the API action on ${t.args?.service_name || 'service'} — ${t.result?.error || 'HTTP request failed'}.`);
            }
          } else if (t.name === "web_search") {
            toolSummaries.push(t.result?.summaryMessage || `Retrieved live web telemetry for "${t.args?.query}".`);
          } else if (t.name === "fetch_web_data") {
            if (t.result?.success) {
              toolSummaries.push(`Retrieved data from ${t.args?.url}.`);
            } else {
              toolSummaries.push(`I wasn't able to fetch data from ${t.args?.url} — ${t.result?.error || 'Resource unreachable'}.`);
            }
          } else if (t.name === "save_reminder") {
            toolSummaries.push(`Scheduled reminder for "${t.args?.text}" at ${t.args?.datetime}.`);
          } else if (t.name === "save_note") {
            toolSummaries.push(`Archived note under "${t.args?.category}".`);
          } else if (t.name === "save_profile_fact") {
            toolSummaries.push(`Committed to memory: [${t.args?.category}] ${t.args?.key}.`);
          } else if (t.name === "search_jobs") {
            const count = t.result?.data?.total_found || t.result?.total_found || 0;
            toolSummaries.push(`Located ${count} matching opportunities in career radar.`);
          } else if (t.name === "create_instant_meeting" || t.name === "schedule_meeting") {
            const platformName = (t.args?.platform === "zoom" || t.result?.data?.platform === "zoom") ? "Zoom" : "Google Meet";
            const attendees = t.result?.data?.attendees || (t.args?.invitee_name ? [t.args.invitee_name] : []);
            const inviteeText = attendees.length > 0 ? ` Invitation prepared for ${attendees.join(', ')}.` : '';
            toolSummaries.push(`Sir, your ${platformName} room is ready.${inviteeText} The link, code, and calendar invite are displayed on your HUD.`);
          } else if (t.name === "attend_meeting_proxy") {
            toolSummaries.push(t.result?.summaryMessage || `Meeting proxy connected [STATUS: MEETING_JOINED]. Monitoring session on your behalf.`);
          } else if (t.name === "complete_first_meeting") {
            toolSummaries.push(`The First Meeting protocol is concluded. I have recorded your baseline preferences into memory, and all operational telemetry is now fully unlocked.`);
          } else if (t.name === "open_link") {
            toolSummaries.push(`Opening ${t.result?.data?.opened_url || t.args?.url_or_query} in viewport.`);
          }
        }
        replyText = toolSummaries.join("\n\n");
      }

      // Ensure extracted data from tools (e.g. browser_task_automation) is explicitly present in replyText
      for (const t of executedTools) {
        const rawExtracted = t.result?.extracted_content || t.result?.data?.extracted_content;
        const extracted = formatExtractedContent(rawExtracted);
        if (extracted && extracted.trim().length > 0) {
          const cleanExtracted = extracted.trim();
          const excerpt = cleanExtracted.slice(0, Math.min(30, cleanExtracted.length));
          if (!replyText || !replyText.includes(excerpt)) {
            const isGenericAcknowledgment =
              !replyText ||
              replyText.startsWith("Understood, Sir") ||
              replyText.startsWith("Working on that") ||
              replyText.startsWith("On it") ||
              replyText.startsWith("Right away, Sir");

            if (isGenericAcknowledgment) {
              replyText = `Here are the findings from ${t.args?.target_platform || t.result?.data?.platform || "the browser task"}:\n\n${cleanExtracted}`;
            } else {
              replyText = `${replyText.trim()}\n\n${cleanExtracted}`;
            }
          }
        }
      }
    }

    // Clean broadcast tags so the response is natural and clean
    if (replyText) {
      replyText = replyText
        .replace(/\[(DURUM|EYLEM|SONUÇ|STATUS|ACTION|RESULT):\s*[^\]]+\]\s*(->)?/gi, "")
        .replace(/\[ADIM\s*\d+\]:\s*/gi, "")
        .trim();
    }

    if (!replyText) {
      replyText = "Understood, Sir. Task sequence completed and telemetry logged.";
    }

    const hasMultiStepTool = executedTools.some((t) =>
      ["browser_task_automation", "make_phone_call", "execute_api_action", "fetch_web_data", "delegate_to_claude"].includes(t.name)
    );
    const detailsAvailable = Boolean(detectedRunId || executedTools.length > 0);

    // Natural acknowledgment generator
    const ackVariations = [
      "On it — I'll update you once it's done.",
      "Understood, Sir. Initializing the autonomous sequence now.",
      "Working on that now, Commander — I will update you as soon as it's completed.",
      "Right away, Sir. Executing the task sequence now.",
      "Proceeding with the autonomous workflow now, Sir. Stand by for results."
    ];
    const acknowledgment = hasMultiStepTool ? ackVariations[Math.floor(Math.random() * ackVariations.length)] : undefined;

    // Save Orion response to DB with task_run_id and details_available
    const savedReply = await saveMessage(
      convId,
      "orion",
      replyText,
      executedTools.length ? JSON.stringify(executedTools) : undefined,
      detectedRunId,
      detailsAvailable,
      user.id
    );

    // Optionally generate TTS audio with fallback
    let audio: string | null = null;
    if (generateAudio) {
      try {
        audio = await generateOrionSpeech(replyText);
      } catch (speechErr) {
        console.warn("[ORION TTS] Speech generation error (continuing with text response):", speechErr);
      }
    }

    return {
      message: savedReply,
      replyText,
      audio,
      executedTools,
      clientActions,
      taskRunId: detectedRunId,
      detailsAvailable,
      acknowledgment
    };
  };

  // Run with timeout ceiling
  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("TASK_TIMEOUT_EXCEEDED")), TASK_TIMEOUT_MS);
    });

    const result: any = await Promise.race([executeChatPipeline(), timeoutPromise]);
    res.json(result);
  } catch (err: any) {
    console.error("Chat endpoint error:", err);
    let fallbackText: string;

    if (err?.message === "TASK_TIMEOUT_EXCEEDED") {
      fallbackText = `This operation is taking longer than expected (exceeded 90s ceiling). I have logged the task run (ID: ${taskRunId}) and will continue monitoring telemetry in the background. All core systems remain operational, Sir.`;
    } else {
      fallbackText = `I wasn't able to complete that operation directly due to a transient neural network interruption. All database records and telemetry remain secure, Sir. How may I proceed?`;
    }

    const savedReply = await saveMessage(convId, "orion", fallbackText, undefined, taskRunId, true);
    res.json({
      message: savedReply,
      replyText: fallbackText,
      audio: null,
      executedTools: [],
      clientActions: [],
      taskRunId,
      detailsAvailable: true,
      error: err?.message
    });
  }
});

// ----------------------------------------------------
// CIRCUIT BREAKER HEALTH & CONTROL
// ----------------------------------------------------
app.get("/api/circuit-breaker", (req, res) => {
  res.json({ success: true, circuitBreaker: getCircuitBreakerStatus() });
});

app.post("/api/circuit-breaker/reset", (req, res) => {
  resetCircuitBreaker();
  res.json({ success: true, message: "Circuit breaker manually reset to CLOSED", circuitBreaker: getCircuitBreakerStatus() });
});

// ----------------------------------------------------
// WEBSOCKET LIVE VOICE ASSISTANT BRIDGE (Gemini Live API)
// ----------------------------------------------------

wss.on("connection", async (clientWs: WebSocket, req: http.IncomingMessage) => {
  console.log("[ORION WS] Client connected to Live Voice Bridge");
  let liveSession: any = null;
  let currentUser: User = {
    id: "user_tony",
    name: "Tony Stark",
    email: "tony@stark.ai",
    email_verified: true,
    has_completed_onboarding: true,
    auth_provider: 'email',
    created_at: new Date().toISOString()
  };

  // Parse token from URL query string if provided
  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    const token = url.searchParams.get("token");
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userFromDb = await getUserById(decoded.id);
      if (userFromDb) {
        currentUser = userFromDb;
      }
    }
  } catch (e) {
    console.warn("[ORION WS] Using default user context for WebSocket connection.");
  }

  let wsConvId: string | null = null;
  try {
    const userConvs = await getConversations(currentUser.id);
    if (userConvs.length > 0) {
      wsConvId = userConvs[0].id;
    } else {
      const newConv = await createConversation(
        currentUser.id,
        currentUser.has_completed_onboarding ? "Primary Operations" : "The First Meeting"
      );
      wsConvId = newConv.id;
    }
  } catch (convErr) {
    console.warn("[ORION WS] Failed to resolve conversation ID:", convErr);
  }

  let accumulatedUserTurn = "";
  let accumulatedOrionTurn = "";

  const flushTurnToDb = async () => {
    if (!wsConvId) return;
    const uText = accumulatedUserTurn.trim();
    const oText = accumulatedOrionTurn.trim();
    if (uText) {
      accumulatedUserTurn = "";
      await saveMessage(wsConvId, "user", uText, undefined, undefined, false, currentUser.id);
    }
    if (oText) {
      accumulatedOrionTurn = "";
      await saveMessage(wsConvId, "orion", oText, undefined, undefined, false, currentUser.id);
    }
  };

  try {
    const ai = getGeminiClient();
    const profileFacts = await getUserProfileFacts(currentUser.id);
    const isOnboarding = !currentUser.has_completed_onboarding;
    const systemInstruction = buildOrionSystemInstruction(currentUser, profileFacts, isOnboarding);

    liveSession = await ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Fenrir" } }
        },
        systemInstruction,
        tools: [{ functionDeclarations: toolDeclarations }],
        outputAudioTranscription: {},
        inputAudioTranscription: {}
      },
      callbacks: {
        onmessage: async (message: LiveServerMessage) => {
          // Model speech audio chunk
          const audioChunk = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audioChunk && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "audio", data: audioChunk }));
          }

          // User or Model transcriptions
          const serverContentAny = message.serverContent as any;
          const outputText =
            serverContentAny?.outputTranscription?.text ||
            serverContentAny?.outputAudioTranscription?.text ||
            message.serverContent?.modelTurn?.parts?.[0]?.text;

          if (outputText) {
            accumulatedOrionTurn += outputText;
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  type: "output_transcription",
                  text: outputText
                })
              );
            }
          }

          const inputText =
            serverContentAny?.inputTranscription?.text ||
            serverContentAny?.inputAudioTranscription?.text;

          if (inputText) {
            accumulatedUserTurn += (accumulatedUserTurn ? " " : "") + inputText;
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  type: "input_transcription",
                  text: inputText
                })
              );
            }
          }

          if (message.serverContent?.turnComplete) {
            flushTurnToDb();
          }

          // Barge-in / interruption
          if (message.serverContent?.interrupted && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "interrupted" }));
          }

          // Tool call handling in Live session
          if (message.toolCall) {
            const functionCalls = message.toolCall.functionCalls;
            if (functionCalls && functionCalls.length > 0) {
              const responses: any[] = [];
              for (const fc of functionCalls) {
                const { result, clientAction } = await executeToolCall(fc.name, fc.args, currentUser.id);
                responses.push({ id: fc.id, name: fc.name, response: { output: result } });
                if (clientAction && clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(JSON.stringify({ type: "client_action", action: clientAction, toolName: fc.name }));
                }
              }

              // Return tool response to Gemini Live session
              try {
                if (liveSession) {
                  liveSession.sendToolResponse({ functionResponses: responses });
                }
              } catch (toolResErr) {
                console.error("[ORION WS] Error sending tool response to Live API:", toolResErr);
              }
            }
          }
        },
        onclose: () => {
          console.log("[ORION WS] Live API session closed");
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "status", status: "session_closed" }));
          }
        },
        onerror: (err: any) => {
          console.error("[ORION WS] Live API session error:", err);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "error", error: err.message || "Live API Error" }));
          }
        }
      }
    });

    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({
        type: "status",
        status: "ready",
        user: { id: currentUser.id, name: currentUser.name, has_completed_onboarding: currentUser.has_completed_onboarding }
      }));
    }
  } catch (initErr: any) {
    console.error("[ORION WS] Failed to initialize Gemini Live API session:", initErr);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: "status", status: "fallback_ready", error: initErr.message }));
      clientWs.close();
    }
  }

  // Handle messages from client browser
  clientWs.on("message", async (raw: any) => {
    try {
      const parsed = JSON.parse(raw.toString());
      if (parsed.type === "audio" && parsed.data) {
        if (liveSession) {
          liveSession.sendRealtimeInput({
            audio: { data: parsed.data, mimeType: "audio/pcm;rate=16000" }
          });
        }
      } else if (parsed.type === "text" && parsed.text) {
        accumulatedUserTurn = parsed.text;
        if (liveSession) {
          liveSession.sendRealtimeInput({
            text: parsed.text
          });
        }
      }
    } catch (msgErr) {
      console.warn("[ORION WS] Malformed client message:", msgErr);
    }
  });

  clientWs.on("close", async () => {
    console.log("[ORION WS] Client disconnected");
    try {
      await flushTurnToDb();
    } catch (e) {
      // ignore
    }
    if (liveSession) {
      try {
        liveSession.close();
      } catch (e) {
        // ignore
      }
    }
  });
});

// API Catch-all: Ensure any unhandled /api/* route ALWAYS returns JSON (never HTML index.html)
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.path}` });
});

// Global API error handler ensuring strict JSON response
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[ORION SERVER ERROR]", err);
  res.status(500).json({ error: err?.message || "Internal server error" });
});

// Setup Vite middleware or static serving
async function start() {
  try {
    console.log("[ORION SERVER] Initializing Database subsystem...");
    await getDb();
    console.log("[ORION SERVER] Database initialized successfully.");
    startInsightEngineScheduler();
    startReminderScheduler();
  } catch (dbErr) {
    console.error("[ORION SERVER] Database init warning (operating in resilient mode):", dbErr);
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[ORION AI] Core Server running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error("[ORION SERVER FATAL]", err);
});

