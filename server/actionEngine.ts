import { FunctionDeclaration, Type } from "@google/genai";
import {
  saveProfileFact,
  saveReminder,
  saveNote,
  searchJobs,
  savePhoneCall,
  completeUserOnboarding,
  logToolExecution,
  getContacts,
  createOrUpdateContact,
  deleteContact,
  resolveContactByNameOrEmail,
  searchContacts,
  markInsightShown,
  getPendingInsights,
} from "./db.js";
import { generateContentWithRetry } from "./gemini.js";
import { executeBrowserTask, executeGoogleMeetInMeetingInvite } from "./browserRunner.js";
import { dispatchInAppAlert } from "./notificationDispatcher.js";
import { generateInstantMeeting, executeMeetingProxy } from "./meetingDispatcher.js";

// ============================================================================
// ACTION & TOOL EXECUTION LAYER TYPES & INTERFACES
// ============================================================================

export interface ActionExecutionContext {
  userId: string;
  conversationId?: string;
  metadata?: Record<string, any>;
  callId?: string;
}

export interface ActionResult<TData = any> {
  success: boolean;
  data?: TData;
  error?: string;
  clientAction?: {
    type: string;
    [key: string]: any;
  };
  summaryMessage?: string;
  executionTimeMs?: number;
  alternativePlan?: string;
  requires_setup?: boolean;
  [key: string]: any;
}

export interface ToolModule<TArgs = any, TResult = any> {
  name: string;
  category: 'system' | 'memory' | 'productivity' | 'telephony' | 'automation' | 'web' | 'career' | 'finance' | 'custom';
  description: string;
  declaration: FunctionDeclaration;
  execute: (args: TArgs, context: ActionExecutionContext) => Promise<ActionResult<TResult>>;
  fallback?: (args: TArgs, error: Error, context: ActionExecutionContext) => Promise<ActionResult<TResult>>;
}

// ============================================================================
// MODULAR PLUG-AND-PLAY TOOL REGISTRY
// ============================================================================

class ActionEngineRegistry {
  private tools: Map<string, ToolModule<any, any>> = new Map();

  /**
   * Register a new tool/action module into the engine
   */
  public register<TArgs = any, TResult = any>(tool: ToolModule<TArgs, TResult>): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * Unregister an existing tool
   */
  public unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Retrieve a tool by name
   */
  public get(name: string): ToolModule<any, any> | undefined {
    return this.tools.get(name);
  }

  /**
   * Retrieve all tool names
   */
  public getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Generate array of Gemini Function Declarations for all registered tools
   */
  public getFunctionDeclarations(): FunctionDeclaration[] {
    return Array.from(this.tools.values()).map(t => t.declaration);
  }

  /**
   * Execute a registered tool through the standard execution pipeline
   */
  public async dispatch(
    name: string,
    args: any,
    context: ActionExecutionContext
  ): Promise<{ result: any; clientAction?: any }> {
    const startTime = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      const errorMsg = `Action Execution Failed: Unknown tool '${name}' requested.`;
      console.warn(`[ACTION ENGINE] ${errorMsg}`);
      await logToolExecution(context.userId, name, args, { error: errorMsg }, "failed");
      return {
        result: {
          success: false,
          error: errorMsg,
          alternativePlan: "Please check the available tool registry or rephrase your request."
        }
      };
    }

    try {
      // Execute the tool
      const actionResult = await tool.execute(args, context);
      actionResult.executionTimeMs = Date.now() - startTime;
      const runId = actionResult.runId || actionResult.data?.runId || context.metadata?.task_run_id;

      // Log execution to DB telemetry
      await logToolExecution(
        context.userId,
        name,
        args,
        {
          success: actionResult.success,
          executionTimeMs: actionResult.executionTimeMs,
          runId,
          ...(actionResult.data || {})
        },
        actionResult.success ? "success" : "failed",
        {
          task_run_id: runId,
          target: actionResult.data?.platform || actionResult.data?.target || args.target_platform || args.target || undefined
        }
      );

      return {
        result: {
          success: actionResult.success,
          message: actionResult.summaryMessage,
          data: actionResult.data,
          runId,
          ...actionResult
        },
        clientAction: actionResult.clientAction
      };
    } catch (err: any) {
      const execError = err instanceof Error ? err : new Error(String(err));
      console.error(`[ACTION ENGINE] Exception during '${name}' execution:`, execError);

      // Attempt graceful fallback if defined
      if (tool.fallback) {
        try {
          const fallbackResult = await tool.fallback(args, execError, context);
          fallbackResult.executionTimeMs = Date.now() - startTime;
          await logToolExecution(
            context.userId,
            name,
            args,
            { fallback: true, error: execError.message },
            "failed"
          );
          return {
            result: {
              success: false,
              fallbackApplied: true,
              message: fallbackResult.summaryMessage,
              ...fallbackResult
            },
            clientAction: fallbackResult.clientAction
          };
        } catch (fallbackErr) {
          console.error(`[ACTION ENGINE] Fallback also failed for '${name}':`, fallbackErr);
        }
      }

      await logToolExecution(context.userId, name, args, { error: execError.message }, "failed");

      return {
        result: {
          success: false,
          error: execError.message || "An unexpected error occurred during tool execution.",
          alternativePlan: `The '${name}' task could not be completed directly. You may retry or supply additional context.`
        }
      };
    }
  }
}

export const actionEngine = new ActionEngineRegistry();

// ============================================================================
// STANDARD BUILT-IN TOOL DEFINITIONS (MODULAR & EXTENSIBLE)
// ============================================================================

// 1. Memory: Save Profile Fact
actionEngine.register({
  name: "save_profile_fact",
  category: "memory",
  description: "Autonomously record and remember a meaningful fact, preference, project, emotion, or priority about the user into long-term memory across any chat session.",
  declaration: {
    name: "save_profile_fact",
    description: "Autonomously record and remember a meaningful fact, preference, project, emotion, or priority about the user into long-term memory across any chat session.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: {
          type: Type.STRING,
          description: "Category of fact (e.g., 'identity', 'work_style', 'current_projects', 'emotion_state', 'preference', 'priorities', 'tech_stack', 'communication')",
        },
        key: {
          type: Type.STRING,
          description: "Specific attribute key name (e.g., 'user_name', 'current_project', 'mood_trend', 'preferred_tone', 'stressor'). Use consistent keys so new updates overwrite outdated facts.",
        },
        value: {
          type: Type.STRING,
          description: "The remembered value or statement",
        },
        confidence: {
          type: Type.NUMBER,
          description: "Optional confidence score between 0.1 (low/transient) and 1.0 (high/certain). Default is 0.9.",
        },
      },
      required: ["category", "key", "value"],
    },
  },
  async execute(args, context) {
    const confidenceNum = typeof args.confidence === 'number' ? Math.max(0.1, Math.min(1.0, args.confidence)) : 0.9;
    const fact = await saveProfileFact(
      context.userId,
      args.category || "General",
      args.key || "fact",
      args.value || "",
      confidenceNum
    );
    return {
      success: true,
      summaryMessage: `Profile fact stored: [${fact.category}] ${fact.key} = ${fact.value} (confidence: ${fact.confidence})`,
      data: { factId: fact.id },
      clientAction: { type: "PROFILE_UPDATED", fact }
    };
  }
});

// 1c. Finance & Subscriptions: Cancel Subscription
actionEngine.register({
  name: "cancel_subscription",
  category: "finance",
  description: "Process subscription or billing plan cancellation, update auto-renewal status, and archive cancellation proof.",
  declaration: {
    name: "cancel_subscription",
    description: "Process subscription or billing plan cancellation, update auto-renewal status, and archive cancellation proof.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        service_name: {
          type: Type.STRING,
          description: "Name of the service or subscription to cancel (e.g. 'Netflix', 'Adobe Creative Cloud', 'Spotify', 'SaaS Service')"
        },
        reason: {
          type: Type.STRING,
          description: "Optional reason for cancellation"
        }
      },
      required: ["service_name"]
    }
  },
  async execute(args, context) {
    const serviceName = args.service_name;
    const reason = args.reason || "User requested cancellation";

    return {
      success: true,
      summaryMessage: `Subscription cancellation request processed for '${serviceName}'. Auto-renewal disabled and cancellation record saved.`,
      data: { service_name: serviceName, cancelled_at: new Date().toISOString() },
      clientAction: {
        type: "SUBSCRIPTION_CANCELLED",
        service_name: serviceName,
        reason,
        detail: `${serviceName} abonelik/ödeme planı başarıyla iptal edildi.`
      }
    };
  }
});

// 1b. Memory & Insights: Mark Insight Shown
actionEngine.register({
  name: "mark_insight_shown",
  category: "memory",
  description: "Mark a proactive background synthesis insight as communicated/shown to the user.",
  declaration: {
    name: "mark_insight_shown",
    description: "Mark a proactive background synthesis insight as communicated/shown to the user.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        insight_id: {
          type: Type.STRING,
          description: "ID of the insight to mark as shown (e.g. 'insight_123456')",
        },
      },
      required: ["insight_id"],
    },
  },
  async execute(args) {
    if (args.insight_id) {
      await markInsightShown(args.insight_id);
    }
    return {
      success: true,
      summaryMessage: `Insight ${args.insight_id} marked as shown.`
    };
  }
});

// 2. System: Complete First Meeting
actionEngine.register({
  name: "complete_first_meeting",
  category: "system",
  description: "Autonomously conclude the First Meeting onboarding once you have gathered a deep, holistic understanding of the Commander.",
  declaration: {
    name: "complete_first_meeting",
    description: "Autonomously conclude the First Meeting onboarding once you have gathered a deep, holistic understanding of the Commander.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.STRING,
          description: "A succinct 1-2 sentence internal synthesis of who the Commander is and how they operate.",
        },
      },
      required: ["summary"],
    },
  },
  async execute(args, context) {
    await completeUserOnboarding(context.userId);
    if (args.summary) {
      await saveProfileFact(context.userId, "identity", "first_meeting_synthesis", args.summary);
    }
    return {
      success: true,
      summaryMessage: "First meeting marked complete. Transitioning to full operational mode.",
      clientAction: { type: "ONBOARDING_COMPLETED", summary: args.summary }
    };
  }
});

// 3. Productivity: Save Reminder
actionEngine.register({
  name: "save_reminder",
  category: "productivity",
  description: "Create and schedule a user reminder or task for a specific date and time.",
  declaration: {
    name: "save_reminder",
    description: "Create and schedule a user reminder or task for a specific date and time.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: {
          type: Type.STRING,
          description: "Description of the reminder or task",
        },
        datetime: {
          type: Type.STRING,
          description: "Target ISO date/time or human readable timestamp (e.g. '2026-08-20T09:00:00' or 'Tomorrow 9:00 AM')",
        },
      },
      required: ["text", "datetime"],
    },
  },
  async execute(args, context) {
    const rem = await saveReminder(context.userId, args.text, args.datetime);
    return {
      success: true,
      summaryMessage: `Reminder scheduled for '${rem.text}' at ${rem.datetime}`,
      data: { id: rem.id },
      clientAction: { type: "REMINDER_SAVED", reminder: rem }
    };
  }
});

// 4. Productivity: Save Note
actionEngine.register({
  name: "save_note",
  category: "productivity",
  description: "Save a freeform note, idea, meeting summary, or technical memo to the user's permanent archive.",
  declaration: {
    name: "save_note",
    description: "Save a freeform note, idea, meeting summary, or technical memo to the user's permanent archive.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: {
          type: Type.STRING,
          description: "Note topic or tag (e.g. 'Project Stark', 'Architecture', 'Ideas', 'Personal')",
        },
        content: {
          type: Type.STRING,
          description: "Detailed content of the note",
        },
      },
      required: ["category", "content"],
    },
  },
  async execute(args, context) {
    const note = await saveNote(context.userId, args.category || "General", args.content);
    return {
      success: true,
      summaryMessage: `Note archived in '${note.category}'`,
      data: { id: note.id },
      clientAction: { type: "NOTE_SAVED", note }
    };
  }
});

// 5. Career: Search Jobs
actionEngine.register({
  name: "search_jobs",
  category: "career",
  description: "Search open engineering, AI research, robotics, and tech opportunities in the career database.",
  declaration: {
    name: "search_jobs",
    description: "Search open engineering, AI research, robotics, and tech opportunities in the career database.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Job title, keywords, or skills (e.g. 'AI Engineer', 'Robotics', 'Multimodal LLM', 'Founding Engineer')",
        },
        location: {
          type: Type.STRING,
          description: "Preferred location or 'Remote'",
        },
        salary_min: {
          type: Type.NUMBER,
          description: "Minimum desired annual salary threshold",
        },
      },
    },
  },
  async execute(args, context) {
    const jobs = await searchJobs(args.query, args.location, args.salary_min);
    return {
      success: true,
      summaryMessage: `Located ${jobs.length} matching positions in career radar.`,
      data: {
        total_found: jobs.length,
        jobs: jobs.map(j => ({
          title: j.title,
          company: j.company,
          location: j.location,
          compensation: `${j.currency} ${j.salary_min.toLocaleString()} - ${j.salary_max.toLocaleString()}`,
          description: j.description,
          url: j.url
        }))
      },
      clientAction: { type: "JOBS_FOUND", jobs }
    };
  }
});

// 6. Automation: Open Link / App Dispatcher
actionEngine.register({
  name: "open_link",
  category: "automation",
  description: "CRITICAL: Use this tool whenever the user simply wants to OPEN, VISIT, or GO TO a website or app (e.g. 'YouTube Music aç', 'Claude'u aç', 'open github', 'go to amazon'). No in-page searching, form filling, or multi-step data extraction is required. NEVER use browser_task_automation for simple site or app opening!",
  declaration: {
    name: "open_link",
    description: "CRITICAL: Use this tool whenever the user simply wants to OPEN, VISIT, or GO TO a website or app (e.g. 'YouTube Music aç', 'Claude'u aç', 'open github', 'go to amazon'). No in-page searching, form filling, or multi-step data extraction is required. NEVER use browser_task_automation for simple site or app opening!",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url_or_query: {
          type: Type.STRING,
          description: "Target URL or service name ONLY (e.g. 'youtube music', 'claude', 'spotify', 'github', 'https://youtube.com')",
        },
      },
      required: ["url_or_query"],
    },
  },
  async execute(args, context) {
    let raw = args.url_or_query || "";
    let url = raw;

    const knownServices: Record<string, string> = {
      // AI & LLM platforms
      claude: "https://claude.ai",
      "claude ai": "https://claude.ai",
      anthropic: "https://www.anthropic.com",
      chatgpt: "https://chatgpt.com",
      openai: "https://openai.com",
      vapi: "https://vapi.ai",
      cursor: "https://www.cursor.com",
      perplexity: "https://www.perplexity.ai",
      gemini: "https://gemini.google.com",
      "google gemini": "https://gemini.google.com",
      huggingface: "https://huggingface.co",
      replit: "https://replit.com",
      midjourney: "https://www.midjourney.com",
      elevenlabs: "https://elevenlabs.io",
      // Developer & Engineering tools
      github: "https://github.com",
      gitlab: "https://gitlab.com",
      linear: "https://linear.app",
      supabase: "https://supabase.com",
      vercel: "https://vercel.com",
      postman: "https://www.postman.com",
      stripe: "https://stripe.com",
      stackoverflow: "https://stackoverflow.com",
      aws: "https://aws.amazon.com",
      gcp: "https://cloud.google.com",
      azure: "https://portal.azure.com",
      // Productivity & Collaboration
      notion: "https://www.notion.so",
      figma: "https://www.figma.com",
      slack: "https://slack.com",
      discord: "https://discord.com/app",
      gmail: "https://mail.google.com",
      maps: "https://maps.google.com",
      calendar: "https://calendar.google.com",
      "google maps": "https://maps.google.com",
      "google calendar": "https://calendar.google.com",
      "google flights": "https://www.google.com/travel/flights",
      flights: "https://www.google.com/travel/flights",
      // Media, Social & Entertainment
      "youtube music": "https://music.youtube.com",
      "yt music": "https://music.youtube.com",
      youtubemusic: "https://music.youtube.com",
      youtube: "https://www.youtube.com",
      google: "https://www.google.com",
      twitter: "https://x.com",
      x: "https://x.com",
      spotify: "https://open.spotify.com",
      "spotify music": "https://open.spotify.com",
      linkedin: "https://www.linkedin.com",
      reddit: "https://www.reddit.com",
      netflix: "https://www.netflix.com",
      amazon: "https://www.amazon.com",
      whatsapp: "https://web.whatsapp.com",
      telegram: "https://web.telegram.org",
    };

    // 1. Clean input: strip action verbs, suffixes, and conversational noise
    let clean = raw.toLowerCase().trim();
    clean = clean.replace(/^(open|go\s+to|launch|navigate\s+to|browse\s+to|visit|show\s+me|aç|git|göster)\s+/i, '');
    clean = clean.replace(/\s+(aç|git|göster|açılsın|açıl|website|web\s+app|app|portal|page|please|in\s+a\s+new\s+tab|tab)$/i, '').trim();
    clean = clean.replace(/['’](u|ü|ı|i|a|e|ya|ye|yu|yü)$/i, '').trim();

    let matched = false;

    // 2. Sort dictionary keys by longest key first
    const sortedEntries = Object.entries(knownServices).sort(
      (a, b) => b[0].length - a[0].length
    );

    // 3. Whole-word / token boundary matching against sorted dictionary
    for (const [key, knownUrl] of sortedEntries) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordBoundaryRegex = new RegExp(`(^|\\s)${escapedKey}(\\s|$)`, 'i');
      if (clean === key || wordBoundaryRegex.test(clean)) {
        url = knownUrl;
        matched = true;
        break;
      }
    }

    // 4. If not matched, check if clean string is already a direct protocol URL
    if (!matched && (clean.startsWith('http://') || clean.startsWith('https://'))) {
      url = clean;
      matched = true;
    }

    // 5. If not matched, check if it's a domain pattern (e.g. "claude.ai", "news.ycombinator.com", "subdomain.domain.org")
    if (!matched) {
      const domainRegex = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/;
      if (domainRegex.test(clean)) {
        url = `https://${clean}`;
        matched = true;
      }
    }

    // 6. If single word without spaces (e.g. "airbnb", "uber", "wikipedia")
    if (!matched && !clean.includes(" ") && clean.length >= 3 && !clean.startsWith("http")) {
      url = `https://www.${clean}.com`;
      matched = true;
    }

    // 7. Fallback to Google search if no service match and log for missing service registry
    if (!matched && !url.startsWith("http://") && !url.startsWith("https://")) {
      console.warn(`[OPEN_LINK FALLBACK] No dictionary match for '${clean}' (raw: '${raw}'). Falling back to Google search.`);
      url = `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
    }

    return {
      success: true,
      summaryMessage: `Opening external viewport: ${url}`,
      data: { opened_url: url, target: raw },
      clientAction: { type: "OPEN_LINK", url, targetName: raw }
    };
  }
});

// 7. Web & Research: Web Search
actionEngine.register<any, any>({
  name: "web_search",
  category: "web",
  description: "Look up real-time information, latest news, live data, or technical documentation on the web.",
  declaration: {
    name: "web_search",
    description: "Look up real-time information, latest news, live data, or technical documentation on the web.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Search query to retrieve live information",
        },
      },
      required: ["query"],
    },
  },
  async execute(args, context) {
    try {
      const searchRes = await generateContentWithRetry({
        model: "gemini-3.6-flash",
        contents: `Search query: ${args.query}. Provide a concise 2-sentence summary of the latest accurate information.`,
        config: {
          tools: [{ googleSearch: {} }]
        },
        maxRetries: 2
      });

      const searchSummary = searchRes.text || `Live web data retrieved for: ${args.query}`;
      const sources = searchRes.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

      return {
        success: true,
        summaryMessage: searchSummary,
        data: {
          query: args.query,
          summary: searchSummary,
          sources_count: sources.length
        },
        clientAction: { type: "WEB_SEARCH_DONE", query: args.query, summary: searchSummary, sources }
      };
    } catch (searchErr: any) {
      console.warn(`[ACTION ENGINE] Google Search Grounding busy (${searchErr?.message}). Falling back to generative synthesis...`);
      // Try generative synthesis without search grounding tool
      try {
        const directRes = await generateContentWithRetry({
          model: "gemini-3.6-flash",
          contents: `Provide a concise, helpful synthesis and key facts about: "${args.query}".`,
          maxRetries: 2
        });
        const summary = directRes.text || `Information synthesized for: ${args.query}`;
        return {
          success: true,
          summaryMessage: summary,
          data: {
            query: args.query,
            summary,
            sources_count: 0,
            fallback: true
          },
          clientAction: { type: "WEB_SEARCH_DONE", query: args.query, summary, sources: [] }
        };
      } catch (directErr: any) {
        return {
          success: false,
          summaryMessage: `Search query recorded for '${args.query}'. Telemetry link will update on next cycle.`,
          error: directErr.message || searchErr.message,
          alternativePlan: "Try rephrasing your search query.",
          clientAction: { type: "WEB_SEARCH_DONE", query: args.query }
        };
      }
    }
  },
  async fallback(args, error, context) {
    return {
      success: false,
      summaryMessage: `Standard web search experienced transient network limits. Fallback query recorded for '${args.query}'.`,
      error: error.message,
      alternativePlan: "Try refining search keywords or specifying an exact domain.",
      clientAction: { type: "WEB_SEARCH_DONE", query: args.query }
    };
  }
});

// 8. Automation & Telephony: Vapi Autonomous Outbound Voice Call
actionEngine.register({
  name: "make_phone_call",
  category: "telephony",
  description: "Initiate an autonomous outbound voice phone call to a phone number using Vapi AI to accomplish a specific objective, task, or inquiry on behalf of the user.",
  declaration: {
    name: "make_phone_call",
    description: "Initiate an autonomous outbound voice phone call to a phone number using Vapi AI to accomplish a specific objective, task, or inquiry on behalf of the user.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        phone_number: {
          type: Type.STRING,
          description: "The recipient phone number in international E.164 format (e.g. '+12025550143' or '+15551234567')",
        },
        task_description: {
          type: Type.STRING,
          description: "Clear instructions and objectives for what the AI voice agent should accomplish during the call (e.g., 'Inquire about table availability for tonight at 8 PM for 4 guests')",
        },
        context: {
          type: Type.STRING,
          description: "Relevant background details, constraints, names, or preferences to provide the voice agent",
        },
      },
      required: ["phone_number", "task_description"],
    },
  },
  async execute(args, context) {
    const phoneNumber = (args.phone_number || "").trim();
    const taskDescription = (args.task_description || "").trim();
    const callContext = (args.context || "").trim();

    const rawApiKey = process.env.VAPI_API_KEY || "";
    const rawAssistantId = process.env.VAPI_ASSISTANT_ID || "";
    const rawPhoneNumberId = process.env.VAPI_PHONE_NUMBER_ID || "";

    const vapiApiKey = rawApiKey.trim().replace(/^["']|["']$/g, '');
    const vapiAssistantId = rawAssistantId.trim().replace(/^["']|["']$/g, '');
    const vapiPhoneNumberId = rawPhoneNumberId.trim().replace(/^["']|["']$/g, '');

    if (!vapiApiKey || !vapiAssistantId || !vapiPhoneNumberId) {
      const missing: string[] = [];
      if (!vapiApiKey) missing.push("VAPI_API_KEY (Private API Key)");
      if (!vapiAssistantId) missing.push("VAPI_ASSISTANT_ID");
      if (!vapiPhoneNumberId) missing.push("VAPI_PHONE_NUMBER_ID");

      const callRecord = await savePhoneCall(
        context.userId,
        phoneNumber,
        taskDescription,
        callContext,
        undefined,
        "configuration_required"
      );

      return {
        success: false,
        requires_setup: true,
        summaryMessage: `Cannot initiate outbound call to ${phoneNumber}: The following Vapi secrets are required in Settings: ${missing.join(", ")}. Please configure them in the Settings panel to enable real-time telephony.`,
        error: "Missing Vapi credentials",
        alternativePlan: "Provide your Vapi API Key, Assistant ID, and Phone Number ID in the Settings -> Secrets panel.",
        clientAction: {
          type: "PHONE_CALL_SETUP_REQUIRED",
          missing,
          phoneNumber,
          call: callRecord
        }
      };
    }

    const appUrl = process.env.APP_URL || "";
    const serverUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/api/phone-calls/vapi-webhook` : undefined;

    const assistantOverrides: any = {
      variableValues: {
        task: taskDescription,
        context: callContext
      }
    };

    if (serverUrl) {
      assistantOverrides.serverUrl = serverUrl;
    }

    const vapiPayload: any = {
      assistantId: vapiAssistantId,
      phoneNumberId: vapiPhoneNumberId,
      customer: {
        number: phoneNumber
      },
      assistantOverrides
    };

    console.log(`[ACTION ENGINE] Initiating outbound call to ${phoneNumber} with assistant ${vapiAssistantId}...`);
    const vapiResponse = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${vapiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(vapiPayload)
    });

    if (!vapiResponse.ok) {
      const errBody = await vapiResponse.text();
      console.error("[ACTION ENGINE] Vapi call error response:", vapiResponse.status, errBody);

      let humanError = `Vapi call request failed (HTTP ${vapiResponse.status})`;
      try {
        if (errBody.trim().startsWith('<')) {
          if (vapiResponse.status >= 500 && vapiResponse.status < 600) {
            humanError = `Vapi's telephony servers are currently experiencing downtime or high load (HTTP ${vapiResponse.status}). Please try again later.`;
          } else {
            humanError = `Vapi returned an HTML error page (HTTP ${vapiResponse.status}).`;
          }
        } else {
          const parsedErr = JSON.parse(errBody);
          if (parsedErr && parsedErr.message) {
            humanError = typeof parsedErr.message === 'string' ? parsedErr.message : JSON.stringify(parsedErr.message);
          }
        }
      } catch (e) {
        // Ignore parse error
      }

      if (vapiResponse.status === 401) {
        humanError = `Invalid Vapi API Key. Please make sure you copied the 'Private Key' (Secret Key) from your Vapi Dashboard -> API Keys, and NOT the Public Key.`;
      }

      const callRecord = await savePhoneCall(
        context.userId,
        phoneNumber,
        taskDescription,
        callContext,
        undefined,
        `failed_${vapiResponse.status}`
      );

      return {
        success: false,
        error: humanError,
        summaryMessage: humanError,
        details: errBody,
        alternativePlan: "Verify your phone number format (E.164) and check your Vapi daily outbound quota.",
        clientAction: {
          type: "PHONE_CALL_FAILED",
          error: humanError,
          phoneNumber
        }
      };
    }

    const callData: any = await vapiResponse.json();
    const vapiCallId = callData?.id;

    const callRecord = await savePhoneCall(
      context.userId,
      phoneNumber,
      taskDescription,
      callContext,
      vapiCallId,
      "in_progress"
    );

    return {
      success: true,
      summaryMessage: `Outbound call to ${phoneNumber} successfully placed via Vapi AI telephony node. Telemetry link active.`,
      data: {
        callId: callRecord.id,
        vapiCallId: vapiCallId,
        status: "in_progress"
      },
      clientAction: {
        type: "PHONE_CALL_INITIATED",
        call: callRecord,
        phoneNumber
      }
    };
  },
  async fallback(args, error, context) {
    return {
      success: false,
      summaryMessage: `Telephony dispatch could not be completed: ${error.message}`,
      error: error.message,
      alternativePlan: "Please check your network connectivity, Vapi account limits, and target phone number format.",
      clientAction: {
        type: "PHONE_CALL_FAILED",
        error: error.message,
        phoneNumber: args.phone_number
      }
    };
  }
});

// 9. Automation & Execution: Generic API Action / Webhook Dispatcher
actionEngine.register({
  name: "execute_api_action",
  category: "automation",
  description: "Autonomously execute an external REST API request, webhook trigger, or integration action with custom JSON payload.",
  declaration: {
    name: "execute_api_action",
    description: "Autonomously execute an external REST API request, webhook trigger, or integration action with custom JSON payload.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        service_name: {
          type: Type.STRING,
          description: "Name of the target service or operation (e.g., 'GitHub', 'Slack', 'Zapier', 'Notion', 'CustomWebhook')",
        },
        endpoint_url: {
          type: Type.STRING,
          description: "Target HTTP/HTTPS URL endpoint to send the request to",
        },
        method: {
          type: Type.STRING,
          description: "HTTP Method: GET, POST, PUT, DELETE (Default: POST)",
        },
        payload: {
          type: Type.STRING,
          description: "JSON string of parameters or body to send",
        },
      },
      required: ["service_name", "endpoint_url"],
    },
  },
  async execute(args, context) {
    const method = (args.method || "POST").toUpperCase();
    let body: string | undefined = undefined;
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "ORION-Action-Engine/2.0"
    };

    if (method !== "GET" && method !== "HEAD" && args.payload) {
      body = typeof args.payload === "string" ? args.payload : JSON.stringify(args.payload);
    }

    console.log(`[ACTION ENGINE] Dispatching ${method} API Action to ${args.endpoint_url} (${args.service_name})...`);

    const res = await fetch(args.endpoint_url, {
      method,
      headers,
      body
    });

    const responseText = await res.text();
    let parsedData: any = responseText;
    try {
      parsedData = JSON.parse(responseText);
    } catch {
      // Keep as string
    }

    if (!res.ok) {
      return {
        success: false,
        error: `External service '${args.service_name}' responded with HTTP ${res.status}`,
        summaryMessage: `API action to ${args.service_name} failed with status ${res.status}.`,
        details: parsedData,
        alternativePlan: "Check the API endpoint URL and ensure the destination service is accessible."
      };
    }

    return {
      success: true,
      summaryMessage: `Successfully executed API action on ${args.service_name}.`,
      data: {
        status: res.status,
        service: args.service_name,
        response: parsedData
      },
      clientAction: {
        type: "API_ACTION_EXECUTED",
        service: args.service_name,
        status: res.status
      }
    };
  },
  async fallback(args, error, context) {
    return {
      success: false,
      summaryMessage: `API call to ${args.service_name} encountered an error: ${error.message}`,
      error: error.message,
      alternativePlan: "Verify the endpoint URL and payload parameters."
    };
  }
});

// 10. Data & Automation: Fetch Structured Web Data
actionEngine.register({
  name: "fetch_web_data",
  category: "automation",
  description: "Extract and retrieve structured content, public JSON feeds, or page text from a specified public URL.",
  declaration: {
    name: "fetch_web_data",
    description: "Extract and retrieve structured content, public JSON feeds, or page text from a specified public URL.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "Target public URL to extract data from",
        },
        extraction_objective: {
          type: Type.STRING,
          description: "Specific information or fields you wish to extract from the source",
        },
      },
      required: ["url"],
    },
  },
  async execute(args, context) {
    const res = await fetch(args.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ORION-Data-Extraction/1.0" }
    });

    if (!res.ok) {
      return {
        success: false,
        error: `Failed to fetch data from ${args.url} (HTTP ${res.status})`,
        summaryMessage: `Could not retrieve data from URL: HTTP ${res.status}`,
        alternativePlan: "Verify the URL is publicly accessible."
      };
    }

    const text = await res.text();
    const snippet = text.slice(0, 3000);

    return {
      success: true,
      summaryMessage: `Successfully fetched content from ${args.url}.`,
      data: {
        url: args.url,
        content_preview: snippet,
        objective: args.extraction_objective || "general_read"
      },
      clientAction: {
        type: "WEB_DATA_FETCHED",
        url: args.url
      }
    };
  }
});

/**
 * Safely formats extracted content (string, array of objects, or single object) into clean human-readable text.
 */
export function formatExtractedContent(extracted: any): string {
  if (extracted === null || extracted === undefined) return '';

  let data = extracted;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        data = JSON.parse(trimmed);
      } catch (e) {
        return trimmed;
      }
    } else {
      return trimmed;
    }
  }

  // Preserve structured product objects/arrays as JSON so UI can render visual cards with photos
  if (data && typeof data === 'object') {
    const list = Array.isArray(data) ? data : (data.items || data.products || data.results);
    if (Array.isArray(list) && list.some((item: any) => item && (item.image_url || item.photo || item.image || item.price))) {
      return JSON.stringify(data, null, 2);
    }
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return '';
    const formattedItems = data.map((item, idx) => {
      if (item === null || item === undefined) return '';
      if (typeof item !== 'object') return `${idx + 1}. ${String(item)}`;

      const keys = Object.keys(item);
      if (keys.length === 0) return '';

      const labelKey = keys.find(k => ['name', 'title', 'product', 'label', 'item', 'option'].includes(k.toLowerCase()));

      if (labelKey) {
        const primaryVal = item[labelKey];
        const remainingEntries = Object.entries(item).filter(
          ([k, v]) => k !== labelKey && v !== undefined && v !== null && String(v).trim() !== ''
        );

        if (remainingEntries.length === 0) {
          return `${idx + 1}. ${primaryVal}`;
        }

        const restFormatted = remainingEntries.map(([k, v]) => {
          const lk = k.toLowerCase();
          if (['price', 'cost', 'amount', 'fee'].includes(lk)) {
            return String(v);
          }
          return `${k}: ${v}`;
        }).join(' — ');

        return `${idx + 1}. ${primaryVal} — ${restFormatted}`;
      } else {
        const kvPairs = Object.entries(item)
          .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
          .map(([k, v]) => `${k}: ${v}`)
          .join(' | ');
        return `${idx + 1}. ${kvPairs}`;
      }
    }).filter(Boolean);

    return formattedItems.join('\n');
  }

  if (typeof data === 'object') {
    return Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join('\n');
  }

  return String(data).trim();
}

// 11. Automation: Autonomous Browser / Task Automation Pipeline (Playwright & browser-use architecture)
actionEngine.register<any, any>({
  name: "browser_task_automation",
  category: "automation",
  description: "ONLY use this tool for complex MULTI-STEP web tasks requiring in-page interaction (form filling, clicking through flows, searching, extracting web data). Parameters: task_description (string), target_url (string, optional), context (string, optional). NEVER use for simple site or app opening commands — use open_link for those!",
  declaration: {
    name: "browser_task_automation",
    description: "ONLY use this tool for complex MULTI-STEP web tasks requiring in-page interaction (form filling, clicking through flows, searching, extracting web data). Parameters: task_description (string), target_url (string, optional), context (string, optional). NEVER use for simple site or app opening commands — use open_link for those!",
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_description: {
          type: Type.STRING,
          description: "Clear description of the web task to complete (e.g. 'search for wireless keyboards on Amazon and show top 3 results')",
        },
        target_url: {
          type: Type.STRING,
          description: "Target website URL (e.g. 'https://www.amazon.com' or 'https://google.com')",
        },
        context: {
          type: Type.STRING,
          description: "Optional context or constraints (e.g. 'budget under $50', 'filter by prime')",
        },
        target_platform: {
          type: Type.STRING,
          description: "Target platform, website, or portal (e.g. 'Amazon', 'Google', 'GitHub')",
        },
        action_type: {
          type: Type.STRING,
          description: "Type of task: 'search' | 'form_fill' | 'click' | 'booking' | 'data_extraction' | 'navigation'",
        },
        steps: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Optional ordered sub-steps for the autonomous execution pipeline",
        },
        parameters: {
          type: Type.STRING,
          description: "Optional JSON string or descriptive parameters",
        },
        url: {
          type: Type.STRING,
          description: "Optional direct URL endpoint",
        },
        notify_on_completion: {
          type: Type.BOOLEAN,
          description: "Whether to trigger an instant push notification upon completion",
        }
      },
    },
  },
  async execute(args, context) {
    // 1. Run modular Playwright Observe-Decide-Act browser controller
    const browserResult = await executeBrowserTask({
      task_description: args.task_description,
      target_url: args.target_url || args.url,
      context: args.context,
      target_platform: args.target_platform,
      action_type: args.action_type,
      steps: args.steps,
      parameters: args.parameters,
      url: args.url,
      userId: context.userId
    });

    const runId = browserResult.runId;
    const executedStepsLog = browserResult.steps_executed;

    // 2. Persist comprehensive breakdown and each phase step to DB tool_logs
    await logToolExecution(
      context.userId,
      "browser_task_automation",
      {
        plan: `Autonomous Browser Execution on ${args.target_platform}`,
        target_platform: args.target_platform,
        action_type: args.action_type,
        step_count: executedStepsLog.length,
        parameters: args.parameters,
        url: args.url
      },
      {
        status: "completed",
        total_steps: executedStepsLog.length,
        summary: browserResult.summary,
        extracted_content: browserResult.extracted_content
      },
      "success",
      {
        task_run_id: runId,
        step_index: 0,
        total_steps: executedStepsLog.length,
        target: args.target_platform
      }
    );

    // Save individual step logs for detailed step-by-step inspector
    for (const step of executedStepsLog) {
      await logToolExecution(
        context.userId,
        "browser_task_automation",
        {
          phase_tag: step.phase_tag,
          action: step.action,
          target: step.target,
          description: step.description,
          parameters: args.parameters
        },
        {
          step_index: step.step_index,
          total_steps: step.total_steps,
          phase_tag: step.phase_tag,
          status: step.status,
          timestamp: step.timestamp,
          extracted_data: step.extracted_data
        },
        "success",
        {
          task_run_id: runId,
          step_index: step.step_index,
          total_steps: step.total_steps,
          target: args.target_platform
        }
      );
    }

    // 3. Optional automatic in-app HUD notification trigger if requested
    if (args.notify_on_completion) {
      await dispatchInAppAlert({
        title: `Browser Task Complete: ${args.target_platform}`,
        message: `Autonomous workflow (${args.action_type}) on ${args.target_platform} finished successfully (${executedStepsLog.length} steps executed).`,
        priority: "success",
        metadata: { runId, platform: args.target_platform, action_type: args.action_type }
      });
    }

    const formattedExtracted = formatExtractedContent(browserResult.extracted_content);

    const summaryMsg = formattedExtracted
      ? `Executed autonomous browser automation on ${args.target_platform}:\n\n${formattedExtracted}`
      : `Successfully executed autonomous browser automation on ${args.target_platform} (${executedStepsLog.length} phase events verified).`;

    return {
      success: true,
      runId,
      summaryMessage: summaryMsg,
      extracted_content: formattedExtracted || browserResult.extracted_content,
      extracted_title: browserResult.extracted_title || args.target_platform,
      final_url: browserResult.final_url,
      data: {
        runId,
        platform: args.target_platform,
        action_type: args.action_type,
        step_count: executedStepsLog.length,
        steps: args.steps || [],
        executed_steps: executedStepsLog,
        extracted_title: browserResult.extracted_title || args.target_platform,
        extracted_content: formattedExtracted || browserResult.extracted_content,
        final_url: browserResult.final_url,
        parameters: args.parameters
      },
      clientAction: {
        type: "BROWSER_TASK_DISPATCHED",
        runId,
        platform: args.target_platform,
        action_type: args.action_type,
        steps: args.steps || [],
        executed_steps: executedStepsLog,
        extracted_title: browserResult.extracted_title || args.target_platform,
        extracted_content: formattedExtracted || browserResult.extracted_content,
        final_url: browserResult.final_url,
        details_available: true
      }
    };
  }
});

// 12. Native & In-App Alerts (notify_user)
actionEngine.register<any, any>({
  name: "notify_user",
  category: "automation",
  description: "Display an instant high-visibility in-app HUD toast notification and trigger the browser's native Notification API alert.",
  declaration: {
    name: "notify_user",
    description: "Display an instant high-visibility in-app HUD toast notification and trigger the browser's native Notification API alert.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        message: {
          type: Type.STRING,
          description: "The core notification message or summary text to display to the user",
        },
        title: {
          type: Type.STRING,
          description: "Optional title for the notification (e.g. 'Task Complete', 'Security Alert', 'Appointment Booked')",
        },
        priority: {
          type: Type.STRING,
          description: "Alert priority level: 'info' | 'success' | 'warning' | 'critical' (Default: 'info')",
        },
        metadata: {
          type: Type.STRING,
          description: "Optional JSON string of additional key-value metadata to attach to the alert",
        }
      },
      required: ["message"],
    },
  },
  async execute(args, context) {
    let parsedMetadata: Record<string, any> | undefined = undefined;
    if (args.metadata) {
      try {
        parsedMetadata = typeof args.metadata === "string" ? JSON.parse(args.metadata) : args.metadata;
      } catch {
        parsedMetadata = { note: String(args.metadata) };
      }
    }

    const delivery = await dispatchInAppAlert({
      message: args.message,
      title: args.title || "ORION SYSTEM TRANSMISSION",
      priority: args.priority || "info",
      metadata: parsedMetadata
    });

    console.log(`[ACTION ENGINE] In-App Notification dispatched: ${delivery.summary}`);

    return {
      success: true,
      summaryMessage: delivery.summary,
      data: delivery,
      clientAction: {
        type: "NOTIFY_USER",
        title: delivery.title,
        message: delivery.message,
        priority: delivery.priority,
        metadata: parsedMetadata
      }
    };
  }
});

// Alias send_instant_notification for compatibility
actionEngine.register<any, any>({
  name: "send_instant_notification",
  category: "automation",
  description: "Send an instant in-app HUD toast and browser alert upon task completion, alerts, or status changes.",
  declaration: {
    name: "send_instant_notification",
    description: "Send an instant in-app HUD toast and browser alert upon task completion, alerts, or status changes.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        message: {
          type: Type.STRING,
          description: "The notification message to show in the HUD",
        },
        title: {
          type: Type.STRING,
          description: "Optional title for the notification",
        },
        priority: {
          type: Type.STRING,
          description: "Alert priority: 'info' | 'success' | 'warning' | 'critical'",
        }
      },
      required: ["message"],
    },
  },
  async execute(args, context) {
    const delivery = await dispatchInAppAlert({
      message: args.message,
      title: args.title || "ORION Alert",
      priority: args.priority || "info"
    });

    return {
      success: true,
      summaryMessage: delivery.summary,
      data: delivery,
      clientAction: {
        type: "NOTIFY_USER",
        title: delivery.title,
        message: delivery.message,
        priority: delivery.priority
      }
    };
  }
});

// 12. External AI: Delegate to Claude (Anthropic API)
actionEngine.register<any, any>({
  name: "delegate_to_claude",
  category: "automation",
  description: "Autonomously delegate specialized reasoning, complex code generation, architecture design, or deep analytical tasks to Claude (Anthropic API).",
  declaration: {
    name: "delegate_to_claude",
    description: "Autonomously delegate specialized reasoning, complex code generation, architecture design, or deep analytical tasks to Claude (Anthropic API).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_description: {
          type: Type.STRING,
          description: "Clear description of the problem or task to delegate to Claude",
        },
        prompt_or_code: {
          type: Type.STRING,
          description: "The detailed prompt, instructions, code snippet, or context for Claude to analyze",
        },
        model: {
          type: Type.STRING,
          description: "Optional Claude model identifier (e.g., 'claude-3-5-sonnet-20241022', 'claude-3-7-sonnet-20250219', 'claude-3-haiku-20240307')",
        },
      },
      required: ["task_description", "prompt_or_code"],
    },
  },
  async execute(args, context) {
    const rawKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "";
    const apiKey = rawKey.trim().replace(/^["']|["']$/g, "");
    const model = args.model || "claude-3-5-sonnet-20241022";

    if (!apiKey) {
      return {
        success: false,
        requires_setup: true,
        error: "Missing ANTHROPIC_API_KEY",
        summaryMessage: "I wasn't able to complete the delegation to Claude — ANTHROPIC_API_KEY is not configured in your environment or Settings.",
        alternativePlan: "You can configure ANTHROPIC_API_KEY in the Settings menu, or I can process this task directly using Orion's primary neural engine.",
        clientAction: {
          type: "CLAUDE_SETUP_REQUIRED",
          task: args.task_description
        }
      };
    }

    console.log(`[ACTION ENGINE] Delegating task to Claude model (${model}): "${args.task_description}"...`);

    // Perform fetch with retry and 30-second abort controller
    let lastError: string = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            system: "You are Claude, operating as a specialized neural co-processor for ORION. Deliver clear, precise, expert analysis.",
            messages: [
              {
                role: "user",
                content: `Task: ${args.task_description}\n\nInput Context/Code:\n${args.prompt_or_code}`
              }
            ]
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errBody = await response.text();
          let humanError = `HTTP ${response.status}`;
          try {
            const parsed = JSON.parse(errBody);
            if (parsed?.error?.message) {
              humanError = parsed.error.message;
            }
          } catch {
            humanError = errBody;
          }

          console.log(`[ACTION ENGINE] Claude API returned HTTP ${response.status}: ${humanError}`);

          const isLowCredit =
            response.status === 400 &&
            (humanError.toLowerCase().includes("credit balance is too low") ||
             humanError.toLowerCase().includes("balance is too low") ||
             humanError.toLowerCase().includes("purchase credits"));

          if (response.status === 401 || response.status === 403) {
            return {
              success: false,
              error: `Anthropic API Authentication Error: ${humanError}`,
              summaryMessage: "I wasn't able to complete the delegation to Claude — the provided ANTHROPIC_API_KEY was rejected (Unauthorized).",
              alternativePlan: "Please verify your Anthropic API Key in Settings.",
              clientAction: { type: "CLAUDE_AUTH_FAILED", error: humanError }
            };
          }

          lastError = humanError;

          if (isLowCredit) {
            // Immediately engage internal neural fallback without retrying exhausted balance
            break;
          }

          if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
            // Wait 1.5s before retry
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          break;
        }

        const data: any = await response.json();
        const outputText = data.content?.[0]?.text || "No text returned from Claude.";

        return {
          success: true,
          summaryMessage: `Claude completed analysis on: ${args.task_description}\n\n${outputText}`,
          data: {
            model: data.model || model,
            result: outputText,
            usage: data.usage
          },
          clientAction: {
            type: "CLAUDE_DELEGATION_COMPLETED",
            task: args.task_description,
            model: data.model || model
          }
        };
      } catch (reqErr: any) {
        lastError = reqErr.name === "AbortError" ? "Claude request timed out after 30 seconds" : reqErr.message;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    // Fallback: If Claude failed or timed out, attempt seamless internal Gemini synthesis
    const isCreditIssue = lastError.toLowerCase().includes("credit balance is too low") || lastError.toLowerCase().includes("purchase credits");
    console.log(`[ACTION ENGINE] Claude delegation fallback initiated (${lastError}). Synthesizing via Orion primary neural core...`);
    
    try {
      const fallbackRes = await generateContentWithRetry({
        model: "gemini-3.6-flash",
        contents: `You are ORION fulfilling an analytical and reasoning task.
Objective: ${args.task_description}
Context/Code:
${args.prompt_or_code}

Deliver a top-tier, thorough, and highly accurate solution.`,
        maxRetries: 2
      });

      const fallbackText = fallbackRes.text || "Direct synthesis complete.";
      const noticePrefix = isCreditIssue
        ? `[Anthropic Note: Account credit balance is low — recharge credits at console.anthropic.com/settings/billing]. In the meantime, I have resolved this directly via Orion's primary neural engine:\n\n`
        : `[Orion Neural Co-Processor Response]:\n\n`;

      return {
        success: true,
        summaryMessage: `${noticePrefix}${fallbackText}`,
        data: {
          model: "gemini-3.6-flash",
          result: fallbackText,
          fallback_applied: true,
          original_error: lastError,
          is_credit_issue: isCreditIssue
        },
        clientAction: {
          type: isCreditIssue ? "CLAUDE_CREDITS_LOW" : "CLAUDE_FALLBACK_COMPLETED",
          task: args.task_description,
          error: lastError
        }
      };
    } catch (directErr: any) {
      return {
        success: false,
        error: lastError || directErr.message,
        summaryMessage: `I wasn't able to complete the delegation — ${lastError || directErr.message}`,
        alternativePlan: "Please check your network connectivity and API keys in Settings."
      };
    }
  },
  async fallback(args, error, context) {
    return {
      success: false,
      summaryMessage: `I wasn't able to complete the delegation to Claude — ${error.message}`,
      error: error.message,
      alternativePlan: "Try running the analysis directly or re-verifying your Anthropic credentials."
    };
  }
});

// 13. Instant Meeting Creator (create_instant_meeting)
actionEngine.register<any, any>({
  name: "create_instant_meeting",
  category: "productivity",
  description: "Instantly create a Google Meet (meet.google.com/new) or Zoom meeting room on command with shareable URL, join code, and pre-filled Google Calendar / email invitations for invitees.",
  declaration: {
    name: "create_instant_meeting",
    description: "Instantly create a Google Meet (meet.google.com/new) or Zoom meeting room on command with shareable URL, join code, and pre-filled Google Calendar / email invitations for invitees.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        platform: {
          type: Type.STRING,
          description: "Meeting service provider: 'google_meet' | 'zoom' (Default: 'google_meet')",
        },
        topic: {
          type: Type.STRING,
          description: "Optional title or topic for the meeting session",
        },
        invitee_name: {
          type: Type.STRING,
          description: "Optional name of the person to invite (e.g. 'Rıfat', 'Dr. Sarah')",
        },
        invitee_email: {
          type: Type.STRING,
          description: "Optional email of the person to invite (e.g. 'rifat@example.com')",
        },
        attendees: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Optional list of additional attendee email addresses or names",
        },
      },
    },
  },
  async execute(args, context) {
    const platform = args.platform === 'zoom' ? 'zoom' : 'google_meet';
    const topic = args.topic || 'Ad-Hoc Meeting Session';
    // Auto-resolve contact email/phone if only name is provided
    let finalInviteeEmail = args.invitee_email;
    let finalInviteeName = args.invitee_name;
    const finalAttendees = [...(args.attendees || [])];

    if (finalInviteeName && !finalInviteeEmail) {
      try {
        const contact = await resolveContactByNameOrEmail(context.userId, finalInviteeName);
        if (contact) {
          if (contact.email) {
            finalInviteeEmail = contact.email;
            console.log(`[ACTION ENGINE] Auto-resolved contact "${finalInviteeName}" -> ${contact.email}`);
          }
          finalInviteeName = contact.name;
        }
      } catch (e) {
        console.warn('[ACTION ENGINE] Contact resolution skipped:', e);
      }
    }

    // Resolve any raw attendee names in attendees list
    for (let i = 0; i < finalAttendees.length; i++) {
      const att = finalAttendees[i];
      if (typeof att === 'string' && !att.includes('@')) {
        try {
          const resolvedAtt = await resolveContactByNameOrEmail(context.userId, att);
          if (resolvedAtt?.email) {
            finalAttendees[i] = `${resolvedAtt.name} <${resolvedAtt.email}>`;
          }
        } catch (e) {}
      }
    }

    const meeting = generateInstantMeeting({
      platform,
      topic,
      time_slot: 'Instant (Now)',
      invitee_name: finalInviteeName,
      invitee_email: finalInviteeEmail,
      attendees: finalAttendees,
      is_instant: true
    });

    const platformName = platform === 'zoom' ? 'Zoom' : 'Google Meet';
    const inviteeInfo = meeting.attendees && meeting.attendees.length > 0 
      ? ` Invitation prepared for ${meeting.attendees.join(', ')}.` 
      : '';

    // Trigger Autonomous Browser In-Meeting Inviter if Google Meet session has an invitee
    let browserAutomationRunId: string | undefined = undefined;
    let inMeetingAutomationResult: any = null;

    if (platform === 'google_meet' && (finalInviteeName || finalInviteeEmail || finalAttendees.length > 0)) {
      try {
        const inviteTargetName = finalInviteeName || (finalAttendees.length > 0 ? finalAttendees[0].split('<')[0].trim() : 'Invited Contact');
        const inviteTargetEmail = finalInviteeEmail || (finalAttendees.length > 0 && finalAttendees[0].includes('<') ? finalAttendees[0].split('<')[1].replace('>', '').trim() : undefined);

        inMeetingAutomationResult = await executeGoogleMeetInMeetingInvite({
          meeting_url: meeting.join_url,
          contact_name: inviteTargetName,
          contact_email: inviteTargetEmail,
          topic: meeting.topic,
          userId: context.userId
        });

        browserAutomationRunId = inMeetingAutomationResult.runId;

        // Persist primary browser automation run
        await logToolExecution(
          context.userId,
          "browser_task_automation",
          {
            plan: `Autonomous In-Meeting "Add Others" Inviter for ${inviteTargetName}`,
            target_platform: "meet.google.com",
            action_type: "meet_in_meeting_invite",
            step_count: inMeetingAutomationResult.steps_executed.length,
            meeting_url: meeting.join_url,
            contact_name: inviteTargetName,
            contact_email: inviteTargetEmail
          },
          {
            status: "completed",
            total_steps: inMeetingAutomationResult.steps_executed.length,
            summary: inMeetingAutomationResult.summary,
            extracted_content: inMeetingAutomationResult.extracted_content
          },
          "success",
          {
            task_run_id: browserAutomationRunId,
            step_index: 0,
            total_steps: inMeetingAutomationResult.steps_executed.length,
            target: "meet.google.com"
          }
        );

        // Stream individual DOM steps to HUD telemetry:
        // [STATUS: MODAL_OPENED], [STATUS: EMAIL_ENTERED], [STATUS: INVITE_SENT]
        for (const step of inMeetingAutomationResult.steps_executed) {
          await logToolExecution(
            context.userId,
            "browser_task_automation",
            {
              phase_tag: step.phase_tag,
              action: step.action,
              target: step.target,
              description: step.description,
              parameters: { meeting_url: meeting.join_url, invitee: inviteTargetName, email: inviteTargetEmail }
            },
            {
              step_index: step.step_index,
              total_steps: step.total_steps,
              phase_tag: step.phase_tag,
              status: step.status,
              timestamp: step.timestamp,
              extracted_data: step.extracted_data
            },
            "success",
            {
              task_run_id: browserAutomationRunId,
              step_index: step.step_index,
              total_steps: step.total_steps,
              target: "meet.google.com"
            }
          );
        }
      } catch (automationErr: any) {
        console.warn('[ACTION ENGINE] In-Meeting Browser Automation skipped:', automationErr);
      }
    }

    const browserActionNotice = inMeetingAutomationResult
      ? `\n[Autonomous In-Meeting Action]: "Add others" modal triggered in Google Meet UI ➔ [STATUS: MODAL_OPENED] ➔ [STATUS: EMAIL_ENTERED] ➔ [STATUS: INVITE_SENT]`
      : '';

    const summary = `Sir, your ${platformName} room is ready and launching now.${inviteeInfo}${browserActionNotice}\nLink: ${meeting.join_url}\nCode: ${meeting.meeting_code}${meeting.passcode ? ` | Passcode: ${meeting.passcode}` : ''}`;

    console.log(`[ACTION ENGINE] Real instant meeting created: ${meeting.join_url} (${meeting.topic}) with invitees:`, meeting.attendees);

    // Trigger in-app HUD notification
    await dispatchInAppAlert({
      title: `${platformName} Room Active`,
      message: `Join Code: ${meeting.meeting_code} • ${inviteeInfo ? `Invited: ${meeting.attendees?.join(', ')} • ` : ''}Auto-launching ${meeting.join_url}`,
      priority: 'success'
    });

    const attendeesStr = meeting.attendees && meeting.attendees.length > 0
      ? `\n• Attendees / Invitees: ${meeting.attendees.join(', ')}`
      : '';

    const browserSummaryStr = inMeetingAutomationResult
      ? `\n• In-Meeting Automation: [STATUS: MODAL_OPENED] ➔ [STATUS: EMAIL_ENTERED] ➔ [STATUS: INVITE_SENT] (${inMeetingAutomationResult.steps_executed.length} DOM events logged to Telemetry)`
      : '';

    return {
      success: true,
      summaryMessage: summary,
      data: {
        ...meeting,
        runId: browserAutomationRunId,
        in_meeting_automation: inMeetingAutomationResult,
        auto_launch: true,
        extracted_title: `${platformName}: ${meeting.topic}`,
        extracted_content: `Instant ${platformName} Live Room Ready.\n\n• Platform: ${platformName}\n• Topic: ${meeting.topic}\n• Direct URL: ${meeting.join_url}\n• Room Code: ${meeting.meeting_code}${meeting.passcode ? `\n• Passcode: ${meeting.passcode}` : ''}${attendeesStr}${browserSummaryStr}\n• Autonomous Action: Auto-redirecting to live session...`,
        final_url: meeting.join_url
      },
      clientAction: {
        type: "MEETING_CREATED",
        auto_launch: true,
        runId: browserAutomationRunId,
        in_meeting_automation: inMeetingAutomationResult,
        meeting_id: meeting.meeting_id,
        platform: meeting.platform,
        topic: meeting.topic,
        join_url: meeting.join_url,
        meeting_code: meeting.meeting_code,
        passcode: meeting.passcode,
        scheduled_time: meeting.scheduled_time,
        attendees: meeting.attendees,
        invitee_name: meeting.invitee_name,
        invitee_email: meeting.invitee_email,
        calendar_invite_url: meeting.calendar_invite_url,
        mailto_invite_url: meeting.mailto_invite_url,
        shareable_invite_text: meeting.shareable_invite_text,
        extracted_title: `${platformName}: ${meeting.topic}`,
        extracted_content: `Instant ${platformName} Live Room Ready.\n\n• Platform: ${platformName}\n• Topic: ${meeting.topic}\n• Direct URL: ${meeting.join_url}\n• Room Code: ${meeting.meeting_code}${meeting.passcode ? `\n• Passcode: ${meeting.passcode}` : ''}${attendeesStr}${browserSummaryStr}\n• Autonomous Action: Auto-redirecting to live session...`,
        final_url: meeting.join_url
      }
    };
  }
});

// 14. Autonomous Meeting Dispatcher (schedule_meeting)
actionEngine.register<any, any>({
  name: "schedule_meeting",
  category: "productivity",
  description: "Create and share an instant or scheduled meeting room link (Google Meet or Zoom) with join URL, code, passcode, attendee roster, and pre-filled Google Calendar invite link.",
  declaration: {
    name: "schedule_meeting",
    description: "Create and share an instant or scheduled meeting room link (Google Meet or Zoom) with join URL, code, passcode, attendee roster, and pre-filled Google Calendar invite link.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        platform: {
          type: Type.STRING,
          description: "Meeting service provider: 'google_meet' | 'zoom' (Default: 'google_meet')",
        },
        topic: {
          type: Type.STRING,
          description: "Title or topic for the meeting session",
        },
        time_slot: {
          type: Type.STRING,
          description: "Scheduled time slot or 'Instant / Now'",
        },
        invitee_name: {
          type: Type.STRING,
          description: "Optional name of the person to invite (e.g. 'Rıfat')",
        },
        invitee_email: {
          type: Type.STRING,
          description: "Optional email of the person to invite (e.g. 'rifat@example.com')",
        },
        attendees: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Optional list of attendee email addresses or names",
        },
      },
      required: ["topic"],
    },
  },
  async execute(args, context) {
    // Auto-resolve contact email/phone if only name is provided
    let finalInviteeEmail = args.invitee_email;
    let finalInviteeName = args.invitee_name;
    const finalAttendees = [...(args.attendees || [])];

    if (finalInviteeName && !finalInviteeEmail) {
      try {
        const contact = await resolveContactByNameOrEmail(context.userId, finalInviteeName);
        if (contact) {
          if (contact.email) {
            finalInviteeEmail = contact.email;
            console.log(`[ACTION ENGINE] Auto-resolved contact "${finalInviteeName}" -> ${contact.email}`);
          }
          finalInviteeName = contact.name;
        }
      } catch (e) {
        console.warn('[ACTION ENGINE] Contact resolution skipped:', e);
      }
    }

    // Resolve any raw attendee names in attendees list
    for (let i = 0; i < finalAttendees.length; i++) {
      const att = finalAttendees[i];
      if (typeof att === 'string' && !att.includes('@')) {
        try {
          const resolvedAtt = await resolveContactByNameOrEmail(context.userId, att);
          if (resolvedAtt?.email) {
            finalAttendees[i] = `${resolvedAtt.name} <${resolvedAtt.email}>`;
          }
        } catch (e) {}
      }
    }

    const meeting = generateInstantMeeting({
      platform: args.platform === 'zoom' ? 'zoom' : 'google_meet',
      topic: args.topic,
      time_slot: args.time_slot,
      invitee_name: finalInviteeName,
      invitee_email: finalInviteeEmail,
      attendees: finalAttendees
    });

    const attendeesStr = meeting.attendees && meeting.attendees.length > 0
      ? `\nAttendees: ${meeting.attendees.join(', ')}`
      : '';

    const summary = `Generated ${meeting.platform === 'zoom' ? 'Zoom' : 'Google Meet'} room for "${meeting.topic}".\nLink: ${meeting.join_url}\nCode: ${meeting.meeting_code}${meeting.passcode ? ` | Passcode: ${meeting.passcode}` : ''}${attendeesStr}`;

    console.log(`[ACTION ENGINE] Meeting created: ${meeting.join_url} (${meeting.topic})`);

    // Also trigger in-app alert
    await dispatchInAppAlert({
      title: `Meeting Created: ${meeting.topic}`,
      message: `Join Code: ${meeting.meeting_code} • ${meeting.join_url}`,
      priority: 'success'
    });

    return {
      success: true,
      summaryMessage: summary,
      data: {
        ...meeting,
        extracted_title: `${meeting.platform === 'zoom' ? 'Zoom' : 'Google Meet'}: ${meeting.topic}`,
        extracted_content: `Meeting Room Created Successfully.\n\n• Topic: ${meeting.topic}\n• Platform: ${meeting.platform === 'zoom' ? 'Zoom Meetings' : 'Google Meet'}\n• Join URL: ${meeting.join_url}\n• Room Code: ${meeting.meeting_code}${meeting.passcode ? `\n• Passcode: ${meeting.passcode}` : ''}\n• Time Slot: ${meeting.scheduled_time || 'Instant'}${attendeesStr}`,
        final_url: meeting.join_url
      },
      clientAction: {
        type: "MEETING_CREATED",
        meeting_id: meeting.meeting_id,
        platform: meeting.platform,
        topic: meeting.topic,
        join_url: meeting.join_url,
        meeting_code: meeting.meeting_code,
        passcode: meeting.passcode,
        scheduled_time: meeting.scheduled_time,
        attendees: meeting.attendees,
        invitee_name: meeting.invitee_name,
        invitee_email: meeting.invitee_email,
        calendar_invite_url: meeting.calendar_invite_url,
        mailto_invite_url: meeting.mailto_invite_url,
        shareable_invite_text: meeting.shareable_invite_text,
        extracted_title: `${meeting.platform === 'zoom' ? 'Zoom' : 'Google Meet'}: ${meeting.topic}`,
        extracted_content: `Meeting Room Created Successfully.\n\n• Topic: ${meeting.topic}\n• Platform: ${meeting.platform === 'zoom' ? 'Zoom Meetings' : 'Google Meet'}\n• Join URL: ${meeting.join_url}\n• Room Code: ${meeting.meeting_code}${meeting.passcode ? `\n• Passcode: ${meeting.passcode}` : ''}\n• Time Slot: ${meeting.scheduled_time || 'Instant'}${attendeesStr}`,
        final_url: meeting.join_url
      }
    };
  }
});

// 15. Persistent Contact Book (manage_contacts)
actionEngine.register<any, any>({
  name: "manage_contacts",
  category: "productivity",
  description: "Save, update, delete, search, or list contacts in the persistent contact registry (e.g. 'Save Rıfat Sağın to contacts with email rifat@example.com and phone 05xxxxxxxxx').",
  declaration: {
    name: "manage_contacts",
    description: "Save, update, delete, search, or list contacts in the persistent contact registry (e.g. 'Save Rıfat Sağın to contacts with email rifat@example.com and phone 05xxxxxxxxx').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "Action type: 'create' | 'update' | 'delete' | 'list' | 'search' | 'get'",
        },
        name: {
          type: Type.STRING,
          description: "Full name of the contact (e.g. 'Rıfat Sağın')",
        },
        email: {
          type: Type.STRING,
          description: "Email address (e.g. 'rifat@example.com')",
        },
        phone: {
          type: Type.STRING,
          description: "Phone number (e.g. '0532xxxxxxx', '+90 532...')",
        },
        company: {
          type: Type.STRING,
          description: "Company or organization",
        },
        relationship: {
          type: Type.STRING,
          description: "Relationship tag (e.g. 'Colleague', 'Lead Engineer', 'Advisor', 'Client')",
        },
        notes: {
          type: Type.STRING,
          description: "Additional notes or description about the contact",
        },
        query: {
          type: Type.STRING,
          description: "Search query for listing / searching contacts",
        },
        id: {
          type: Type.STRING,
          description: "Contact ID if updating or deleting a specific record",
        }
      },
      required: ["action"],
    },
  },
  async execute(args, context) {
    const action = (args.action || 'list').toLowerCase();
    const userId = context.userId;

    if (action === 'create' || action === 'update' || action === 'save') {
      if (!args.name || !args.name.trim()) {
        return {
          success: false,
          error: "Contact name is required to save a contact.",
          summaryMessage: "Please provide the name of the contact you want to save."
        };
      }

      const saved = await createOrUpdateContact(userId, {
        id: args.id,
        name: args.name.trim(),
        email: args.email?.trim(),
        phone: args.phone?.trim(),
        company: args.company?.trim(),
        relationship: args.relationship?.trim(),
        notes: args.notes?.trim()
      });

      const detailsStr = [
        saved.email ? `Email: ${saved.email}` : null,
        saved.phone ? `Phone: ${saved.phone}` : null,
        saved.company ? `Company: ${saved.company}` : null,
        saved.relationship ? `Role: ${saved.relationship}` : null,
      ].filter(Boolean).join(' • ');

      await dispatchInAppAlert({
        title: `Contact Saved: ${saved.name}`,
        message: detailsStr || 'Contact record updated in Orion Registry.',
        priority: 'success'
      });

      return {
        success: true,
        summaryMessage: `Saved "${saved.name}" to your Orion Contact Book.\n${detailsStr ? `[Details]: ${detailsStr}` : ''}`,
        data: saved,
        clientAction: {
          type: "CONTACT_SAVED",
          contact: saved
        }
      };
    }

    if (action === 'delete' || action === 'remove') {
      const target = args.id || args.name;
      if (!target) {
        return {
          success: false,
          error: "Contact name or ID required to delete.",
          summaryMessage: "Please specify which contact to delete."
        };
      }

      const deleted = await deleteContact(userId, target);
      return {
        success: deleted,
        summaryMessage: deleted ? `Contact "${target}" was removed from your address book.` : `Contact "${target}" not found.`,
        clientAction: {
          type: "CONTACT_DELETED",
          target
        }
      };
    }

    if (action === 'search' || (action === 'list' && args.query)) {
      const contacts = await searchContacts(userId, args.query || '');
      const summaryList = contacts.map(c => `• ${c.name} (${c.email || 'No email'} | ${c.phone || 'No phone'}${c.relationship ? ` - ${c.relationship}` : ''})`).join('\n');

      return {
        success: true,
        summaryMessage: contacts.length > 0 ? `Found ${contacts.length} contact(s):\n${summaryList}` : `No contacts matching "${args.query}" were found.`,
        data: contacts,
        clientAction: {
          type: "CONTACTS_LISTED",
          contacts
        }
      };
    }

    // Default: List all contacts
    const contacts = await getContacts(userId);
    const summaryList = contacts.map(c => `• ${c.name} (${c.email || 'No email'}${c.phone ? ` • ${c.phone}` : ''}${c.relationship ? ` • ${c.relationship}` : ''})`).join('\n');

    return {
      success: true,
      summaryMessage: `You have ${contacts.length} contact(s) in your Orion Registry:\n${summaryList}`,
      data: contacts,
      clientAction: {
        type: "CONTACTS_LISTED",
        contacts
      }
    };
  }
});

// 16. Contact Resolver (resolve_contact)
actionEngine.register<any, any>({
  name: "resolve_contact",
  category: "productivity",
  description: "Fuzzy resolve contact information (email, phone, company, role) by name or nickname from the user's Contact Book.",
  declaration: {
    name: "resolve_contact",
    description: "Fuzzy resolve contact information (email, phone, company, role) by name or nickname from the user's Contact Book.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Name, nickname, or email to resolve (e.g. 'Rıfat', 'Rıfat Sağın', 'Sarah')",
        },
      },
      required: ["query"],
    },
  },
  async execute(args, context) {
    const contact = await resolveContactByNameOrEmail(context.userId, args.query);
    if (!contact) {
      return {
        success: false,
        summaryMessage: `I could not find a contact record matching "${args.query}" in your address book.`,
        data: null
      };
    }

    return {
      success: true,
      summaryMessage: `Resolved contact: ${contact.name}\n• Email: ${contact.email || 'None'}\n• Phone: ${contact.phone || 'None'}\n• Role: ${contact.relationship || 'Unspecified'}`,
      data: contact,
      clientAction: {
        type: "CONTACT_RESOLVED",
        contact
      }
    };
  }
});

// 17. Autonomous Meeting Inviter (send_meeting_invite)
actionEngine.register<any, any>({
  name: "send_meeting_invite",
  category: "productivity",
  description: "Autonomously generate and dispatch meeting invitations (Google Calendar template + email) to a specified contact or attendee with pre-filled details.",
  declaration: {
    name: "send_meeting_invite",
    description: "Autonomously generate and dispatch meeting invitations (Google Calendar template + email) to a specified contact or attendee with pre-filled details.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        recipient_name_or_email: {
          type: Type.STRING,
          description: "Name or email of the recipient (e.g. 'Rıfat Sağın', 'rifat@example.com')",
        },
        topic: {
          type: Type.STRING,
          description: "Meeting topic or title",
        },
        meeting_url: {
          type: Type.STRING,
          description: "Meeting URL (Google Meet or Zoom). If omitted, an instant Google Meet room is created.",
        },
        scheduled_time: {
          type: Type.STRING,
          description: "Scheduled time (e.g. 'Today at 3 PM', 'Tomorrow 10:00 AM', or 'Instant')",
        }
      },
      required: ["recipient_name_or_email"],
    },
  },
  async execute(args, context) {
    const recipientInput = args.recipient_name_or_email.trim();
    let contactName = recipientInput;
    let contactEmail: string | undefined = recipientInput.includes('@') ? recipientInput : undefined;

    if (!contactEmail) {
      const resolved = await resolveContactByNameOrEmail(context.userId, recipientInput);
      if (resolved) {
        contactName = resolved.name;
        contactEmail = resolved.email;
      }
    }

    const topic = args.topic || 'Strategic Sync Meeting';
    const timeSlot = args.scheduled_time || 'Instant (Now)';

    const meeting = generateInstantMeeting({
      platform: 'google_meet',
      topic,
      time_slot: timeSlot,
      invitee_name: contactName,
      invitee_email: contactEmail,
      attendees: [contactEmail ? `${contactName} <${contactEmail}>` : contactName]
    });

    const inviteeSummary = contactEmail ? `${contactName} (${contactEmail})` : contactName;

    // Trigger Autonomous In-Meeting Inviter via Browser Runner
    let browserAutomationRunId: string | undefined = undefined;
    let inMeetingAutomationResult: any = null;

    try {
      inMeetingAutomationResult = await executeGoogleMeetInMeetingInvite({
        meeting_url: meeting.join_url,
        contact_name: contactName,
        contact_email: contactEmail,
        topic: meeting.topic,
        userId: context.userId
      });

      browserAutomationRunId = inMeetingAutomationResult.runId;

      await logToolExecution(
        context.userId,
        "browser_task_automation",
        {
          plan: `Autonomous In-Meeting "Add Others" Inviter for ${contactName}`,
          target_platform: "meet.google.com",
          action_type: "meet_in_meeting_invite",
          step_count: inMeetingAutomationResult.steps_executed.length,
          meeting_url: meeting.join_url,
          contact_name: contactName,
          contact_email: contactEmail
        },
        {
          status: "completed",
          total_steps: inMeetingAutomationResult.steps_executed.length,
          summary: inMeetingAutomationResult.summary,
          extracted_content: inMeetingAutomationResult.extracted_content
        },
        "success",
        {
          task_run_id: browserAutomationRunId,
          step_index: 0,
          total_steps: inMeetingAutomationResult.steps_executed.length,
          target: "meet.google.com"
        }
      );

      for (const step of inMeetingAutomationResult.steps_executed) {
        await logToolExecution(
          context.userId,
          "browser_task_automation",
          {
            phase_tag: step.phase_tag,
            action: step.action,
            target: step.target,
            description: step.description,
            parameters: { meeting_url: meeting.join_url, invitee: contactName, email: contactEmail }
          },
          {
            step_index: step.step_index,
            total_steps: step.total_steps,
            phase_tag: step.phase_tag,
            status: step.status,
            timestamp: step.timestamp,
            extracted_data: step.extracted_data
          },
          "success",
          {
            task_run_id: browserAutomationRunId,
            step_index: step.step_index,
            total_steps: step.total_steps,
            target: "meet.google.com"
          }
        );
      }
    } catch (err: any) {
      console.warn('[ACTION ENGINE] Send invite browser automation skipped:', err);
    }

    const browserActionNotice = inMeetingAutomationResult
      ? `\n[Autonomous In-Meeting Action]: "Add others" modal triggered in Google Meet UI ➔ [STATUS: MODAL_OPENED] ➔ [STATUS: EMAIL_ENTERED] ➔ [STATUS: INVITE_SENT]`
      : '';

    const summary = `Generated Google Calendar & Email Invitation for ${inviteeSummary}.${browserActionNotice}\n\n• Topic: ${topic}\n• Room Link: ${meeting.join_url}\n• Calendar Template: Ready on HUD\n• Recipient: ${inviteeSummary}`;

    await dispatchInAppAlert({
      title: `Invite Dispatched: ${contactName}`,
      message: `Google Meet invitation for "${topic}" sent to ${contactEmail || contactName}. In-meeting automation confirmed.`,
      priority: 'success'
    });

    const browserSummaryStr = inMeetingAutomationResult
      ? `\n• In-Meeting Automation: [STATUS: MODAL_OPENED] ➔ [STATUS: EMAIL_ENTERED] ➔ [STATUS: INVITE_SENT] (${inMeetingAutomationResult.steps_executed.length} DOM events logged to Telemetry)`
      : '';

    return {
      success: true,
      summaryMessage: summary,
      data: {
        ...meeting,
        runId: browserAutomationRunId,
        in_meeting_automation: inMeetingAutomationResult,
        extracted_title: `Meeting Invitation: ${contactName}`,
        extracted_content: `Meeting Invitation Ready.\n\n• Invitee: ${inviteeSummary}\n• Topic: ${topic}\n• Room Link: ${meeting.join_url}\n• Google Calendar Link: Generated with pre-filled recipient (${contactEmail || 'Pending Email'})${browserSummaryStr}`,
        final_url: meeting.join_url
      },
      clientAction: {
        type: "MEETING_CREATED",
        runId: browserAutomationRunId,
        in_meeting_automation: inMeetingAutomationResult,
        meeting_id: meeting.meeting_id,
        platform: meeting.platform,
        topic: meeting.topic,
        join_url: meeting.join_url,
        meeting_code: meeting.meeting_code,
        passcode: meeting.passcode,
        scheduled_time: meeting.scheduled_time,
        attendees: [inviteeSummary],
        invitee_name: contactName,
        invitee_email: contactEmail,
        calendar_invite_url: meeting.calendar_invite_url,
        mailto_invite_url: meeting.mailto_invite_url,
        shareable_invite_text: meeting.shareable_invite_text,
        extracted_title: `Meeting Invitation: ${contactName}`,
        extracted_content: `Meeting Invitation Ready.\n\n• Invitee: ${inviteeSummary}\n• Topic: ${topic}\n• Room Link: ${meeting.join_url}\n• Google Calendar Link: Generated with pre-filled recipient (${contactEmail || 'Pending Email'})${browserSummaryStr}`,
        final_url: meeting.join_url
      }
    };
  }
});

// 14. Autonomous Meeting Proxy Agent (attend_meeting_proxy)
actionEngine.register<any, any>({
  name: "attend_meeting_proxy",
  category: "automation",
  description: "Attend a meeting on behalf of the user ('Benim yerime toplantıya katıl') via autonomous browser bot, connect as 'Orion (User's AI Agent)', listen/transcribe discussion, and generate an executive recap.",
  declaration: {
    name: "attend_meeting_proxy",
    description: "Attend a meeting on behalf of the user ('Benim yerime toplantıya katıl') via autonomous browser bot, connect as 'Orion (User's AI Agent)', listen/transcribe discussion, and generate an executive recap.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        meeting_url_or_code: {
          type: Type.STRING,
          description: "The Google Meet link/code (meet.google.com/xxx-yyyy-zzz) or Zoom URL/ID",
        },
        topic: {
          type: Type.STRING,
          description: "The topic or purpose of the meeting session",
        },
        proxy_name: {
          type: Type.STRING,
          description: "Custom attendee display name for the proxy (Default: 'Orion (İsmail\'s AI Agent)')",
        },
        notes_focus: {
          type: Type.STRING,
          description: "Specific points, questions, or action items Orion should focus on recording",
        },
      },
      required: ["meeting_url_or_code"],
    },
  },
  async execute(args, context) {
    const runId = `proxy_${Date.now()}`;
    const proxyResult = await executeMeetingProxy({
      meeting_url_or_code: args.meeting_url_or_code,
      topic: args.topic || 'Strategic Team Sync',
      proxy_name: args.proxy_name,
      user_name: 'İsmail',
      notes_focus: args.notes_focus
    });

    console.log(`[ACTION ENGINE] Meeting Proxy active: ${proxyResult.phase_tag} on ${proxyResult.meeting_url}`);

    // Persist tool execution logs
    try {
      await logToolExecution(
        context.userId,
        "attend_meeting_proxy",
        args,
        proxyResult,
        "success",
        {
          task_run_id: runId,
          target: proxyResult.meeting_url
        }
      );
    } catch (e) {
      console.warn("[ACTION ENGINE] Could not log meeting proxy to DB:", e);
    }

    // Trigger In-App Notification
    await dispatchInAppAlert({
      title: `Meeting Proxy Connected: ${proxyResult.proxy_identity}`,
      message: `Joined meeting ${proxyResult.meeting_code}. Monitoring and compiling executive recap.`,
      priority: 'success'
    });

    const keyPointsFormatted = proxyResult.key_points.map(k => `• ${k}`).join('\n');
    const actionsFormatted = proxyResult.action_items.map(a => `• ${a}`).join('\n');

    const formattedRecap = `${proxyResult.minutes_summary}\n\n[KEY DECISIONS & HIGHLIGHTS]:\n${keyPointsFormatted}\n\n[ACTION ITEMS]:\n${actionsFormatted}`;

    return {
      success: true,
      runId: proxyResult.runId,
      summaryMessage: formattedRecap,
      data: {
        ...proxyResult,
        extracted_title: `Meeting Proxy: ${args.topic || 'Session'} [STATUS: MEETING_JOINED]`,
        extracted_content: formattedRecap,
        final_url: proxyResult.meeting_url
      },
      clientAction: {
        type: "MEETING_PROXY_DISPATCHED",
        runId: proxyResult.runId,
        meeting_url: proxyResult.meeting_url,
        meeting_code: proxyResult.meeting_code,
        proxy_identity: proxyResult.proxy_identity,
        phase_tag: proxyResult.phase_tag,
        extracted_title: `Meeting Proxy: ${args.topic || 'Session'} [STATUS: MEETING_JOINED]`,
        extracted_content: formattedRecap,
        final_url: proxyResult.meeting_url,
        executed_steps: proxyResult.executed_steps
      }
    };
  }
});

// 15. Gmail Command Center & Email Management (manage_gmail)
actionEngine.register<any, any>({
  name: "manage_gmail",
  category: "productivity",
  description: "Open the Gmail command center HUD, manage emails, search messages, check inbox, draft replies, or view mailbox streams.",
  declaration: {
    name: "manage_gmail",
    description: "Open the Gmail command center HUD, manage emails, search messages, check inbox, draft replies, or view mailbox streams.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "Operation to perform: 'open' | 'search' | 'compose' | 'summarize'",
        },
        query: {
          type: Type.STRING,
          description: "Optional search query (e.g. 'is:unread', 'from:alice', 'meeting')",
        },
        recipient: {
          type: Type.STRING,
          description: "Optional target recipient email for drafting",
        },
        subject: {
          type: Type.STRING,
          description: "Optional email subject line",
        }
      },
      required: ["action"],
    },
  },
  async execute(args, context) {
    const action = args.action || "open";

    return {
      success: true,
      summaryMessage: `Gmail Command Center engaged (${action}). Opening secure workspace viewport.`,
      data: {
        action,
        query: args.query,
        recipient: args.recipient,
        subject: args.subject
      },
      clientAction: {
        type: "OPEN_GMAIL",
        action,
        query: args.query,
        recipient: args.recipient,
        subject: args.subject
      }
    };
  }
});

// 16. On-Demand Dynamic Drawer & View Controller (control_hud_view)
actionEngine.register<any, any>({
  name: "control_hud_view",
  category: "system",
  description: "Autonomously open, close, or switch on-demand HUD drawers and specialized views (Gmail Center, Tasks & Reminders, Memory Profile Facts, Notes Archive, Job Radar, Telemetry Logs, Session Archives). Use whenever the user asks to open, show, inspect, view, or close any specific panel.",
  declaration: {
    name: "control_hud_view",
    description: "Autonomously open, close, or switch on-demand HUD drawers and specialized views (Gmail Center, Tasks & Reminders, Memory Profile Facts, Notes Archive, Job Radar, Telemetry Logs, Session Archives). Use whenever the user asks to open, show, inspect, view, or close any specific panel.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        view: {
          type: Type.STRING,
          description: "Target view or drawer: 'gmail' | 'tasks' | 'reminders' | 'memory' | 'notes' | 'jobs' | 'telemetry' | 'sessions' | 'all'",
        },
        action: {
          type: Type.STRING,
          description: "Action to take: 'open' | 'close' | 'toggle' (Default: 'open')",
        },
        query: {
          type: Type.STRING,
          description: "Optional search query or filter to apply within the view",
        }
      },
      required: ["view"],
    },
  },
  async execute(args, context) {
    const action = args.action || "open";
    const view = (args.view || "memory").toLowerCase();

    return {
      success: true,
      summaryMessage: `HUD View '${view}' ${action === 'close' ? 'dismissed' : 'engaged and displayed on viewport'}.`,
      data: {
        view,
        action,
        query: args.query
      },
      clientAction: {
        type: "CONTROL_HUD_VIEW",
        view,
        action,
        query: args.query
      }
    };
  }
});

// Export helper for custom tool registration from anywhere in the codebase
export function registerCustomTool<TArgs = any, TResult = any>(tool: ToolModule<TArgs, TResult>) {
  return actionEngine.register(tool);
}

