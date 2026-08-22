import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Mail,
  Send,
  Trash2,
  Star,
  RefreshCw,
  Search,
  Inbox,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  X,
  Plus,
  Reply,
  Archive,
  Clock,
  User as UserIcon,
  ShieldCheck,
  LogOut,
  ExternalLink,
  ChevronRight,
  Filter,
  FileText
} from 'lucide-react';
import { GmailMessage, GmailProfile, GmailLabel } from '../types';
import {
  googleSignIn,
  googleSignOut,
  getGoogleAccessToken,
  subscribeToGoogleAuth
} from '../utils/googleAuth';
import {
  listGmailMessages,
  getGmailMessage,
  sendGmailMessage,
  trashGmailMessage,
  deleteGmailMessage,
  toggleMessageStar,
  markMessageRead,
  getGmailProfile
} from '../utils/gmailApi';
import { GmailConfirmationModal, ConfirmationPayload } from './GmailConfirmationModal';
import { soundFX } from '../utils/audio';

interface GmailHUDProps {
  isOpen: boolean;
  onClose: () => void;
  onSendToast?: (type: string, title: string, description: string) => void;
}

export const GmailHUD: React.FC<GmailHUDProps> = ({ isOpen, onClose, onSendToast }) => {
  // Auth state
  const [accessToken, setAccessToken] = useState<string | null>(getGoogleAccessToken());
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Mailbox data
  const [profile, setProfile] = useState<GmailProfile | null>(null);
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [activeFilter, setActiveFilter] = useState<'INBOX' | 'UNREAD' | 'STARRED' | 'SENT' | 'DRAFT' | 'TRASH'>('INBOX');
  const [searchQuery, setSearchQuery] = useState('');

  // Compose / Reply State
  const [isComposing, setIsComposing] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [isGeneratingAiDraft, setIsGeneratingAiDraft] = useState(false);
  const [aiDraftPrompt, setAiDraftPrompt] = useState('');

  // AI Summary View
  const [isAiSummaryMode, setIsAiSummaryMode] = useState(false);
  const [aiSummaryContent, setAiSummaryContent] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

  // Destructive Confirmation Modal
  const [confirmationPayload, setConfirmationPayload] = useState<ConfirmationPayload | null>(null);
  const [isActionExecuting, setIsActionExecuting] = useState(false);

  // Subscribe to Google Auth token in memory
  useEffect(() => {
    const unsubscribe = subscribeToGoogleAuth((user, token) => {
      setGoogleUser(user);
      setAccessToken(token);
      if (token) {
        loadMailbox(token);
      }
    });
    return () => unsubscribe();
  }, []);

  // Selected message details
  const selectedMessage = useMemo(() => {
    return messages.find((m) => m.id === selectedMessageId) || null;
  }, [messages, selectedMessageId]);

  // Load Mailbox Data
  const loadMailbox = useCallback(async (token: string, filterOverride?: string, queryOverride?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Fetch Profile
      const prof = await getGmailProfile(token);
      setProfile(prof);

      // 2. Determine Query
      const currentFilter = filterOverride || activeFilter;
      const currentQuery = queryOverride !== undefined ? queryOverride : searchQuery;

      let q = currentQuery.trim();
      let labelIds: string[] | undefined = undefined;

      if (currentFilter === 'UNREAD') {
        q = q ? `${q} is:unread` : 'is:unread';
      } else if (currentFilter === 'STARRED') {
        q = q ? `${q} is:starred` : 'is:starred';
      } else if (currentFilter === 'SENT') {
        labelIds = ['SENT'];
      } else if (currentFilter === 'DRAFT') {
        labelIds = ['DRAFT'];
      } else if (currentFilter === 'TRASH') {
        labelIds = ['TRASH'];
      } else {
        labelIds = ['INBOX'];
      }

      const res = await listGmailMessages(token, {
        q: q || undefined,
        labelIds,
        maxResults: 20
      });

      setMessages(res.messages);

      // If nothing selected or selection not in new list, pick first
      if (res.messages.length > 0) {
        if (!selectedMessageId || !res.messages.some((m) => m.id === selectedMessageId)) {
          setSelectedMessageId(res.messages[0].id);
        }
      } else {
        setSelectedMessageId(null);
      }
    } catch (err: any) {
      console.error('[Gmail HUD] Error loading mailbox:', err);
      setError(err.message || 'Failed to communicate with Gmail servers.');
    } finally {
      setIsLoading(false);
    }
  }, [activeFilter, searchQuery, selectedMessageId]);

  // Handle Google Sign In
  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);
    soundFX.playHudTick();
    try {
      const result = await googleSignIn();
      if (result?.accessToken) {
        setAccessToken(result.accessToken);
        setGoogleUser(result.user);
        soundFX.playPowerOn();
        if (onSendToast) {
          onSendToast('GMAIL_CONNECTED', 'Google Workspace Connected', `Access granted for ${result.user.email || 'Commander'}`);
        }
        await loadMailbox(result.accessToken);
      }
    } catch (err: any) {
      console.error('[Gmail HUD] Login failed:', err);
      setError(err.message || 'Google clearance was not granted.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle Google Logout
  const handleGoogleLogout = async () => {
    soundFX.playHudTick();
    await googleSignOut();
    setAccessToken(null);
    setGoogleUser(null);
    setProfile(null);
    setMessages([]);
    setSelectedMessageId(null);
    if (onSendToast) {
      onSendToast('GMAIL_DISCONNECTED', 'Google Workspace Disconnected', 'In-memory credentials cleared.');
    }
  };

  // Toggle Star on Email
  const handleToggleStar = async (msg: GmailMessage, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!accessToken) return;
    soundFX.playHudTick();

    const newStarred = !msg.isStarred;
    // Optimistic UI update
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, isStarred: newStarred } : m))
    );

    try {
      await toggleMessageStar(accessToken, msg.id, msg.isStarred);
    } catch (err) {
      console.error('Failed to toggle star:', err);
      // Revert on error
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, isStarred: msg.isStarred } : m))
      );
    }
  };

  // Mark Read / Unread
  const handleToggleRead = async (msg: GmailMessage, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!accessToken) return;
    soundFX.playHudTick();

    const newRead = msg.isUnread;
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, isUnread: !newRead } : m))
    );

    try {
      await markMessageRead(accessToken, msg.id, newRead);
    } catch (err) {
      console.error('Failed to toggle read state:', err);
    }
  };

  // Initiate Sending New Email with Mandatory Confirmation
  const promptSendEmail = () => {
    if (!composeTo.trim()) {
      setError('Please provide a valid recipient email address.');
      return;
    }
    if (!composeSubject.trim()) {
      setError('Please provide an email subject.');
      return;
    }
    if (!composeBody.trim()) {
      setError('Email message body cannot be empty.');
      return;
    }

    soundFX.playHudTick();
    setConfirmationPayload({
      type: 'send_email',
      title: 'CONFIRM OUTGOING TRANSMISSION',
      description: `You are about to dispatch an official email to ${composeTo}. Please verify the recipient and content before authorizing.`,
      target: composeTo,
      details: {
        to: composeTo,
        subject: composeSubject,
        preview: composeBody.substring(0, 140)
      },
      onConfirm: async () => {
        if (!accessToken) return;
        setIsActionExecuting(true);
        try {
          await sendGmailMessage(accessToken, {
            to: composeTo.trim(),
            subject: composeSubject.trim(),
            body: composeBody.trim()
          });

          soundFX.playToolExecuted();
          if (onSendToast) {
            onSendToast('EMAIL_SENT', 'Email Dispatched', `Sent to ${composeTo}: "${composeSubject}"`);
          }

          // Reset composer
          setIsComposing(false);
          setComposeTo('');
          setComposeSubject('');
          setComposeBody('');
          setAiDraftPrompt('');

          // Refresh Sent / Inbox
          loadMailbox(accessToken);
        } catch (err: any) {
          setError(err.message || 'Failed to dispatch email.');
        } finally {
          setIsActionExecuting(false);
        }
      }
    });
  };

  // Initiate Sending Reply with Mandatory Confirmation
  const promptSendReply = () => {
    if (!selectedMessage || !replyBody.trim()) return;
    if (!accessToken) return;

    const replyTo = selectedMessage.from || '';
    const replySubject = selectedMessage.subject.startsWith('Re:')
      ? selectedMessage.subject
      : `Re: ${selectedMessage.subject}`;

    soundFX.playHudTick();
    setConfirmationPayload({
      type: 'send_email',
      title: 'CONFIRM REPLY TRANSMISSION',
      description: `Dispatching your reply to ${replyTo} with thread reference.`,
      target: replyTo,
      details: {
        to: replyTo,
        subject: replySubject,
        preview: replyBody.substring(0, 140)
      },
      onConfirm: async () => {
        setIsActionExecuting(true);
        try {
          await sendGmailMessage(accessToken, {
            to: replyTo,
            subject: replySubject,
            body: replyBody.trim(),
            threadId: selectedMessage.threadId
          });

          soundFX.playToolExecuted();
          if (onSendToast) {
            onSendToast('EMAIL_SENT', 'Reply Dispatched', `Sent reply to ${replyTo}`);
          }
          setReplyBody('');
          loadMailbox(accessToken);
        } catch (err: any) {
          setError(err.message || 'Failed to dispatch reply.');
        } finally {
          setIsActionExecuting(false);
        }
      }
    });
  };

  // Initiate Trash / Delete Email with Mandatory Confirmation
  const promptTrashEmail = (msg: GmailMessage, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!accessToken) return;

    soundFX.playHudTick();
    setConfirmationPayload({
      type: 'trash_email',
      title: 'MOVE TRANSMISSION TO TRASH',
      description: `Are you sure you want to move this email ("${msg.subject}") to Trash? You can restore it later from your Google Workspace Trash.`,
      target: msg.subject,
      details: {
        subject: msg.subject,
        to: msg.from,
        messageId: msg.id
      },
      onConfirm: async () => {
        setIsActionExecuting(true);
        try {
          await trashGmailMessage(accessToken, msg.id);
          soundFX.playToolExecuted();
          if (onSendToast) {
            onSendToast('EMAIL_TRASHED', 'Message Moved to Trash', msg.subject);
          }
          setMessages((prev) => prev.filter((m) => m.id !== msg.id));
          if (selectedMessageId === msg.id) {
            setSelectedMessageId(null);
          }
        } catch (err: any) {
          setError(err.message || 'Failed to trash email.');
        } finally {
          setIsActionExecuting(false);
        }
      }
    });
  };

  // AI Smart Draft Assistant via ORION Backend
  const handleAiDraft = async (presetPrompt?: string) => {
    const promptToUse = presetPrompt || aiDraftPrompt;
    if (!promptToUse.trim()) return;

    setIsGeneratingAiDraft(true);
    soundFX.playHudTick();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Write a professional, concise email draft based on this intent: "${promptToUse}". Output ONLY the proposed email subject on line 1 formatted as 'Subject: <subject>' and then the email body.`,
          conversationId: 'gmail_assistant_conv'
        })
      });

      const data = await res.json();
      const reply = data.replyText || '';

      if (reply) {
        const subjectMatch = reply.match(/^Subject:\s*(.+)$/im);
        if (subjectMatch && subjectMatch[1]) {
          setComposeSubject(subjectMatch[1].trim());
          const bodyWithoutSubject = reply.replace(/^Subject:\s*.+\n+/i, '').trim();
          setComposeBody(bodyWithoutSubject);
        } else {
          setComposeBody(reply);
        }
      }
    } catch (err: any) {
      console.warn('AI Draft error:', err);
    } finally {
      setIsGeneratingAiDraft(false);
    }
  };

  // AI Smart Reply for current email
  const handleAiSmartReply = async () => {
    if (!selectedMessage) return;
    setIsGeneratingAiDraft(true);
    soundFX.playHudTick();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Generate a polite, professional, and clear direct reply to this incoming email:
From: ${selectedMessage.from}
Subject: ${selectedMessage.subject}
Content: "${selectedMessage.bodyText || selectedMessage.snippet}"

Output ONLY the ready-to-send reply body text.`,
          conversationId: 'gmail_reply_conv'
        })
      });

      const data = await res.json();
      if (data.replyText) {
        setReplyBody(data.replyText.trim());
      }
    } catch (err: any) {
      console.warn('AI Smart Reply failed:', err);
    } finally {
      setIsGeneratingAiDraft(false);
    }
  };

  // AI Executive Inbox Summary
  const handleAiSummarizeInbox = async () => {
    if (messages.length === 0) return;
    setIsAiSummaryMode(true);
    setIsGeneratingSummary(true);
    soundFX.playHudTick();

    try {
      const emailSummaries = messages.slice(0, 10).map((m, idx) => {
        return `[#${idx + 1}] From: ${m.from} | Subject: ${m.subject} | Date: ${m.date} | Preview: ${m.snippet.slice(0, 120)}`;
      }).join('\n\n');

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `You are ORION. Provide an executive-level tactical briefing and intelligence summary of these recent incoming emails:

${emailSummaries}

Structure the summary cleanly:
1. 🚨 IMMEDIATE ACTION ITEMS / URGENT MATTERS
2. 📋 KEY UPDATES & COMMUNICATIONS
3. 💡 STRATEGIC RECOMMENDATIONS`,
          conversationId: 'gmail_summary_conv'
        })
      });

      const data = await res.json();
      setAiSummaryContent(data.replyText || 'Inbox analysis completed.');
    } catch (err: any) {
      setAiSummaryContent('Unable to synthesize inbox summary at this moment.');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-2 sm:p-4 bg-[#020617]/90 backdrop-blur-lg animate-fade-in select-none">
      <div
        id="gmail-hud-container"
        className="relative w-full max-w-6xl h-[90vh] bg-[#020617]/95 border border-cyan-400/30 rounded-lg shadow-[0_0_50px_rgba(34,211,238,0.18)] flex flex-col overflow-hidden"
      >
        {/* Holographic Header Bar */}
        <div className="flex items-center justify-between border-b border-cyan-400/20 bg-slate-950/80 px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-sm bg-cyan-400/10 border border-cyan-400/30 text-cyan-400">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold tracking-wider text-cyan-300 font-sans">
                  GMAIL COMMAND CENTER
                </h2>
                <span className="text-[10px] mono uppercase tracking-widest px-2 py-0.5 rounded-xs bg-cyan-400/10 border border-cyan-400/30 text-cyan-300">
                  WORKSPACE LINK
                </span>
              </div>
              <p className="text-[10px] mono uppercase tracking-widest text-slate-400">
                {accessToken && profile
                  ? `${profile.emailAddress} • ${profile.messagesTotal.toLocaleString()} Messages Total`
                  : 'Google Identity Services / Secure Bearer Transmission'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {accessToken && (
              <button
                type="button"
                onClick={handleGoogleLogout}
                className="px-2.5 py-1 rounded-sm bg-slate-900 border border-slate-700 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 text-[11px] mono flex items-center gap-1.5 transition-all cursor-pointer"
                title="Disconnect Google Access"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-400" />
                <span className="hidden sm:inline">Disconnect</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-sm bg-slate-900 border border-slate-700 text-slate-400 hover:text-cyan-300 hover:border-cyan-400/40 transition-colors cursor-pointer"
              title="Close Gmail HUD"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Not Authorized View */}
        {!accessToken ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center text-cyan-400 mb-5 shadow-[0_0_25px_rgba(34,211,238,0.25)]">
              <Mail className="w-8 h-8" />
            </div>

            <h3 className="text-xl font-bold text-cyan-200 mb-2 font-sans tracking-wide">
              CONNECT GOOGLE WORKSPACE
            </h3>
            <p className="max-w-md text-xs text-slate-400 leading-relaxed mb-6 font-sans">
              Authorize ORION to securely manage your Gmail inbox, compose drafts, search communications, and provide real-time AI summaries with user clearance.
            </p>

            {error && (
              <div className="max-w-md w-full mb-6 p-3 rounded-sm bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2 text-left">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {/* Official GSI Styled Button */}
            <button
              type="button"
              id="btn-google-workspace-signin"
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
              className="gsi-material-button px-6 py-3 rounded-sm bg-white hover:bg-slate-100 text-slate-900 font-semibold text-xs transition-all shadow-[0_0_20px_rgba(255,255,255,0.2)] flex items-center gap-3 cursor-pointer disabled:opacity-50"
            >
              {isLoggingIn ? (
                <span className="inline-block w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg
                  version="1.1"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  className="w-4 h-4 shrink-0"
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
              )}
              <span className="font-sans font-medium text-slate-800">
                {isLoggingIn ? 'Connecting...' : 'Sign in with Google'}
              </span>
            </button>

            <div className="mt-8 flex items-center gap-2 text-[10px] mono uppercase tracking-wider text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              <span>In-Memory Token Cache • Least-Privilege Authorized</span>
            </div>
          </div>
        ) : (
          /* Authorized Main Gmail Interface */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top Toolbar (Filters, Search, Compose, AI Summarize) */}
            <div className="p-3 sm:px-4 bg-slate-950/60 border-b border-cyan-400/15 flex flex-wrap items-center justify-between gap-3">
              {/* Category Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-sm border border-cyan-400/20 text-xs mono">
                <button
                  type="button"
                  id="tab-gmail-inbox"
                  onClick={() => {
                    setActiveFilter('INBOX');
                    setIsAiSummaryMode(false);
                    loadMailbox(accessToken, 'INBOX');
                  }}
                  className={`px-2.5 py-1 rounded-xs transition-all flex items-center gap-1.5 ${
                    activeFilter === 'INBOX' && !isAiSummaryMode
                      ? 'bg-cyan-400 text-slate-950 font-bold shadow-[0_0_10px_rgba(34,211,238,0.4)]'
                      : 'text-slate-400 hover:text-cyan-300'
                  }`}
                >
                  <Inbox className="w-3.5 h-3.5" />
                  <span>Inbox</span>
                </button>

                <button
                  type="button"
                  id="tab-gmail-unread"
                  onClick={() => {
                    setActiveFilter('UNREAD');
                    setIsAiSummaryMode(false);
                    loadMailbox(accessToken, 'UNREAD');
                  }}
                  className={`px-2.5 py-1 rounded-xs transition-all flex items-center gap-1.5 ${
                    activeFilter === 'UNREAD' && !isAiSummaryMode
                      ? 'bg-cyan-400 text-slate-950 font-bold shadow-[0_0_10px_rgba(34,211,238,0.4)]'
                      : 'text-slate-400 hover:text-cyan-300'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  <span>Unread</span>
                </button>

                <button
                  type="button"
                  id="tab-gmail-starred"
                  onClick={() => {
                    setActiveFilter('STARRED');
                    setIsAiSummaryMode(false);
                    loadMailbox(accessToken, 'STARRED');
                  }}
                  className={`px-2.5 py-1 rounded-xs transition-all flex items-center gap-1.5 ${
                    activeFilter === 'STARRED' && !isAiSummaryMode
                      ? 'bg-amber-400 text-slate-950 font-bold shadow-[0_0_10px_rgba(251,191,36,0.4)]'
                      : 'text-slate-400 hover:text-amber-300'
                  }`}
                >
                  <Star className="w-3.5 h-3.5" />
                  <span>Starred</span>
                </button>

                <button
                  type="button"
                  id="tab-gmail-sent"
                  onClick={() => {
                    setActiveFilter('SENT');
                    setIsAiSummaryMode(false);
                    loadMailbox(accessToken, 'SENT');
                  }}
                  className={`px-2.5 py-1 rounded-xs transition-all flex items-center gap-1.5 ${
                    activeFilter === 'SENT' && !isAiSummaryMode
                      ? 'bg-cyan-400 text-slate-950 font-bold shadow-[0_0_10px_rgba(34,211,238,0.4)]'
                      : 'text-slate-400 hover:text-cyan-300'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Sent</span>
                </button>

                <button
                  type="button"
                  id="tab-gmail-drafts"
                  onClick={() => {
                    setActiveFilter('DRAFT');
                    setIsAiSummaryMode(false);
                    loadMailbox(accessToken, 'DRAFT');
                  }}
                  className={`px-2.5 py-1 rounded-xs transition-all flex items-center gap-1.5 ${
                    activeFilter === 'DRAFT' && !isAiSummaryMode
                      ? 'bg-cyan-400 text-slate-950 font-bold shadow-[0_0_10px_rgba(34,211,238,0.4)]'
                      : 'text-slate-400 hover:text-cyan-300'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Drafts</span>
                </button>

                <button
                  type="button"
                  id="tab-gmail-trash"
                  onClick={() => {
                    setActiveFilter('TRASH');
                    setIsAiSummaryMode(false);
                    loadMailbox(accessToken, 'TRASH');
                  }}
                  className={`px-2.5 py-1 rounded-xs transition-all flex items-center gap-1.5 ${
                    activeFilter === 'TRASH' && !isAiSummaryMode
                      ? 'bg-rose-500 text-white font-bold shadow-[0_0_10px_rgba(244,63,94,0.4)]'
                      : 'text-slate-400 hover:text-rose-300'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Trash</span>
                </button>
              </div>

              {/* Search Bar */}
              <div className="flex-1 max-w-xs relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="input-gmail-search"
                  type="text"
                  placeholder="Search emails or from:..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      loadMailbox(accessToken, activeFilter, searchQuery);
                    }
                  }}
                  className="w-full pl-8 pr-3 py-1.5 rounded-sm bg-slate-900 border border-cyan-400/20 text-xs text-cyan-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-sans"
                />
              </div>

              {/* Action Buttons: Compose, AI Summary, Refresh */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="btn-gmail-compose"
                  onClick={() => {
                    setIsComposing(true);
                    setIsAiSummaryMode(false);
                    soundFX.playHudTick();
                  }}
                  className="px-3 py-1.5 rounded-sm bg-cyan-400 text-slate-950 hover:bg-cyan-300 font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-[0_0_12px_rgba(34,211,238,0.3)] cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Compose</span>
                </button>

                <button
                  type="button"
                  id="btn-gmail-ai-summary"
                  onClick={handleAiSummarizeInbox}
                  disabled={messages.length === 0 || isGeneratingSummary}
                  className="px-3 py-1.5 rounded-sm bg-cyan-400/15 border border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/25 font-mono text-xs uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  title="Generate ORION Executive Briefing of your inbox"
                >
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="hidden sm:inline">AI Briefing</span>
                </button>

                <button
                  type="button"
                  id="btn-gmail-refresh"
                  onClick={() => loadMailbox(accessToken)}
                  disabled={isLoading}
                  className="p-1.5 rounded-sm bg-slate-900 border border-slate-700 text-slate-400 hover:text-cyan-300 hover:border-cyan-400/40 transition-colors cursor-pointer"
                  title="Refresh Mailbox"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
                </button>
              </div>
            </div>

            {/* Main Content Workspace (Split View) */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Column: Email Message List */}
              <div className="w-full md:w-5/12 border-r border-cyan-400/15 flex flex-col bg-slate-950/40 overflow-y-auto">
                {isLoading && messages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-500 text-xs mono">
                    <span className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
                    <span>Synchronizing Google Workspace streams...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-500 text-xs mono text-center">
                    <Inbox className="w-8 h-8 mb-2 opacity-40 text-slate-400" />
                    <span>No communications found in this filter.</span>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/60">
                    {messages.map((msg) => {
                      const isSelected = msg.id === selectedMessageId && !isComposing && !isAiSummaryMode;
                      return (
                        <div
                          key={msg.id}
                          id={`email-item-${msg.id}`}
                          onClick={() => {
                            setSelectedMessageId(msg.id);
                            setIsComposing(false);
                            setIsAiSummaryMode(false);
                            soundFX.playHudTick();
                            if (msg.isUnread) {
                              handleToggleRead(msg);
                            }
                          }}
                          className={`p-3.5 transition-all cursor-pointer flex flex-col gap-1.5 relative ${
                            isSelected
                              ? 'bg-cyan-400/10 border-l-2 border-cyan-400 text-slate-100'
                              : 'hover:bg-slate-900/60 text-slate-300'
                          } ${msg.isUnread ? 'font-semibold' : 'opacity-85'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {msg.isUnread && (
                                <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
                              )}
                              <span className="text-xs text-cyan-200 font-sans truncate">
                                {msg.from.replace(/<.*>/, '').trim() || msg.from}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0 text-[10px] mono text-slate-500">
                              <span>{msg.date.split(',')[0]}</span>
                              <button
                                type="button"
                                onClick={(e) => handleToggleStar(msg, e)}
                                className="p-0.5 hover:text-amber-300 transition-colors"
                              >
                                <Star
                                  className={`w-3.5 h-3.5 ${
                                    msg.isStarred ? 'text-amber-400 fill-amber-400' : 'text-slate-600'
                                  }`}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => promptTrashEmail(msg, e)}
                                className="p-0.5 hover:text-rose-400 transition-colors"
                                title="Move to Trash"
                              >
                                <Trash2 className="w-3 h-3 text-slate-600 hover:text-rose-400" />
                              </button>
                            </div>
                          </div>

                          <div className="text-xs text-slate-200 font-sans font-medium line-clamp-1">
                            {msg.subject || '(No Subject)'}
                          </div>

                          <div className="text-[11px] text-slate-400 font-sans line-clamp-2 leading-relaxed">
                            {msg.snippet}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right Column: Email Viewer, Composer, or AI Summary */}
              <div className="hidden md:flex flex-1 flex-col bg-[#020617]/95 overflow-hidden">
                {/* 1. Composing View */}
                {isComposing ? (
                  <div className="flex-1 flex flex-col p-5 overflow-y-auto">
                    <div className="flex items-center justify-between border-b border-cyan-400/20 pb-3 mb-4">
                      <div className="flex items-center gap-2">
                        <Send className="w-4 h-4 text-cyan-400" />
                        <h3 className="text-sm font-bold mono text-cyan-300 uppercase tracking-wider">
                          NEW SECURE TRANSMISSION
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsComposing(false)}
                        className="text-xs mono text-slate-400 hover:text-slate-200 underline cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>

                    {/* AI Draft Assistant Box */}
                    <div className="mb-4 p-3 rounded-sm bg-cyan-400/5 border border-cyan-400/20 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs mono text-cyan-300">
                        <span className="flex items-center gap-1.5 font-bold">
                          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                          ORION AI DRAFT ASSISTANT
                        </span>
                        {isGeneratingAiDraft && (
                          <span className="text-[10px] text-cyan-400 animate-pulse">Generating draft...</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Describe what you want to say (e.g. 'Polite reschedule for next Tuesday 3pm')..."
                          value={aiDraftPrompt}
                          onChange={(e) => setAiDraftPrompt(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAiDraft();
                          }}
                          className="flex-1 px-3 py-1.5 rounded-sm bg-slate-950 border border-cyan-400/30 text-xs text-cyan-200 placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                        />
                        <button
                          type="button"
                          onClick={() => handleAiDraft()}
                          disabled={isGeneratingAiDraft || !aiDraftPrompt.trim()}
                          className="px-3 py-1.5 rounded-sm bg-cyan-400/20 border border-cyan-400 text-cyan-300 hover:bg-cyan-400/30 text-xs mono uppercase tracking-wider font-semibold cursor-pointer disabled:opacity-40"
                        >
                          Generate
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] mono">
                        <span className="text-slate-500">Presets:</span>
                        <button
                          type="button"
                          onClick={() => handleAiDraft('Polite follow-up on project timeline and next steps')}
                          className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-cyan-300 hover:border-cyan-400/30 cursor-pointer"
                        >
                          Project Follow-up
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAiDraft('Request to reschedule sync meeting to tomorrow morning')}
                          className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-cyan-300 hover:border-cyan-400/30 cursor-pointer"
                        >
                          Reschedule Sync
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAiDraft('Professional acknowledgment and receipt confirmation')}
                          className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-cyan-300 hover:border-cyan-400/30 cursor-pointer"
                        >
                          Receipt Acknowledgment
                        </button>
                      </div>
                    </div>

                    {/* Compose Form */}
                    <div className="flex flex-col gap-3 flex-1">
                      <div>
                        <label className="text-[11px] mono uppercase tracking-wider text-slate-400 mb-1 block">
                          Recipient (To):
                        </label>
                        <input
                          id="input-compose-to"
                          type="email"
                          placeholder="recipient@domain.com"
                          value={composeTo}
                          onChange={(e) => setComposeTo(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-sm bg-slate-950 border border-cyan-400/25 focus:border-cyan-400 text-xs text-cyan-100 placeholder-slate-600 focus:outline-none font-mono"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] mono uppercase tracking-wider text-slate-400 mb-1 block">
                          Subject:
                        </label>
                        <input
                          id="input-compose-subject"
                          type="text"
                          placeholder="Transmission subject..."
                          value={composeSubject}
                          onChange={(e) => setComposeSubject(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-sm bg-slate-950 border border-cyan-400/25 focus:border-cyan-400 text-xs text-cyan-100 placeholder-slate-600 focus:outline-none font-sans"
                        />
                      </div>

                      <div className="flex-1 flex flex-col">
                        <label className="text-[11px] mono uppercase tracking-wider text-slate-400 mb-1 block">
                          Message Body:
                        </label>
                        <textarea
                          id="input-compose-body"
                          rows={10}
                          placeholder="Compose your message..."
                          value={composeBody}
                          onChange={(e) => setComposeBody(e.target.value)}
                          className="flex-1 w-full p-3.5 rounded-sm bg-slate-950 border border-cyan-400/25 focus:border-cyan-400 text-xs text-slate-200 placeholder-slate-600 focus:outline-none font-sans leading-relaxed resize-none"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => setIsComposing(false)}
                          className="px-4 py-2 rounded-sm bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200 text-xs mono uppercase tracking-wider cursor-pointer"
                        >
                          Discard
                        </button>
                        <button
                          type="button"
                          id="btn-submit-compose-email"
                          onClick={promptSendEmail}
                          className="px-5 py-2 rounded-sm bg-cyan-400 text-slate-950 hover:bg-cyan-300 font-bold mono text-xs uppercase tracking-wider flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(34,211,238,0.3)] cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Dispatch Email</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : isAiSummaryMode ? (
                  /* 2. AI Executive Briefing View */
                  <div className="flex-1 flex flex-col p-6 overflow-y-auto">
                    <div className="flex items-center justify-between border-b border-cyan-400/20 pb-3 mb-4">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-cyan-400" />
                        <h3 className="text-sm font-bold mono text-cyan-300 uppercase tracking-wider">
                          ORION EXECUTIVE INBOX BRIEFING
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsAiSummaryMode(false)}
                        className="text-xs mono text-slate-400 hover:text-slate-200 underline cursor-pointer"
                      >
                        Return to Viewer
                      </button>
                    </div>

                    {isGeneratingSummary ? (
                      <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-400 text-xs mono">
                        <span className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-4" />
                        <span>Synthesizing neural inbox overview & priority radar...</span>
                      </div>
                    ) : (
                      <div className="p-4 rounded-sm bg-slate-950/80 border border-cyan-400/25 text-xs text-slate-200 leading-relaxed font-sans whitespace-pre-wrap">
                        {aiSummaryContent}
                      </div>
                    )}
                  </div>
                ) : selectedMessage ? (
                  /* 3. Detailed Email View & Reply */
                  <div className="flex-1 flex flex-col overflow-y-auto p-5">
                    {/* Header */}
                    <div className="border-b border-slate-800 pb-4 mb-4">
                      <div className="flex items-start justify-between gap-4">
                        <h3 className="text-base font-bold text-cyan-100 font-sans leading-snug">
                          {selectedMessage.subject || '(No Subject)'}
                        </h3>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleToggleStar(selectedMessage)}
                            className="p-1.5 rounded-sm bg-slate-900 border border-slate-700 hover:border-amber-400/40 text-slate-400 transition-colors"
                            title="Toggle Star"
                          >
                            <Star
                              className={`w-4 h-4 ${
                                selectedMessage.isStarred ? 'text-amber-400 fill-amber-400' : ''
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => promptTrashEmail(selectedMessage)}
                            className="p-1.5 rounded-sm bg-slate-900 border border-slate-700 hover:border-rose-500/40 text-slate-400 hover:text-rose-400 transition-colors"
                            title="Move to Trash"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs mono text-slate-400">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-cyan-400/15 border border-cyan-400/30 flex items-center justify-center text-[10px] font-bold text-cyan-300">
                            {selectedMessage.from.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <span className="text-cyan-300 font-sans font-semibold">
                              {selectedMessage.from}
                            </span>
                            {selectedMessage.to && (
                              <span className="text-slate-500 ml-2">to: {selectedMessage.to}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <Clock className="w-3 h-3 text-cyan-400" />
                          <span>{selectedMessage.date}</span>
                        </div>
                      </div>
                    </div>

                    {/* Email Content Body */}
                    <div className="flex-1 my-2 text-xs text-slate-200 leading-relaxed font-sans overflow-y-auto select-text">
                      {selectedMessage.bodyText ? (
                        <div className="whitespace-pre-wrap">{selectedMessage.bodyText}</div>
                      ) : selectedMessage.bodyHtml ? (
                        <div
                          className="prose prose-invert max-w-none text-xs"
                          dangerouslySetInnerHTML={{ __html: selectedMessage.bodyHtml }}
                        />
                      ) : (
                        <div className="text-slate-500 italic">{selectedMessage.snippet}</div>
                      )}
                    </div>

                    {/* Reply Section & AI Assistant */}
                    <div className="mt-4 pt-4 border-t border-slate-800 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between text-xs mono">
                        <span className="text-slate-400 flex items-center gap-1.5">
                          <Reply className="w-3.5 h-3.5 text-cyan-400" />
                          Quick Transmission Reply
                        </span>

                        <button
                          type="button"
                          onClick={handleAiSmartReply}
                          disabled={isGeneratingAiDraft}
                          className="px-2.5 py-1 rounded bg-cyan-400/10 border border-cyan-400/30 text-cyan-300 hover:bg-cyan-400/20 text-[11px] flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                        >
                          <Sparkles className="w-3 h-3 text-cyan-400" />
                          <span>Generate Smart Reply</span>
                        </button>
                      </div>

                      <div className="relative">
                        <textarea
                          id="input-gmail-reply-body"
                          rows={3}
                          placeholder={`Reply to ${selectedMessage.from.split('<')[0].trim()}...`}
                          value={replyBody}
                          onChange={(e) => setReplyBody(e.target.value)}
                          className="w-full p-3 rounded-sm bg-slate-950 border border-cyan-400/25 focus:border-cyan-400 text-xs text-slate-200 placeholder-slate-600 focus:outline-none font-sans leading-relaxed resize-none"
                        />
                      </div>

                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          id="btn-send-gmail-reply"
                          onClick={promptSendReply}
                          disabled={!replyBody.trim()}
                          className="px-4 py-2 rounded-sm bg-cyan-400 text-slate-950 hover:bg-cyan-300 font-bold mono text-xs uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-[0_0_12px_rgba(34,211,238,0.3)] cursor-pointer disabled:opacity-40"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Send Reply</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-500 text-xs mono">
                    <Mail className="w-8 h-8 mb-2 opacity-30 text-slate-400" />
                    <span>Select an email from the left roster to view details.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mandatory User Confirmation Modal for Destructive / Send Actions */}
      <GmailConfirmationModal
        payload={confirmationPayload}
        onClose={() => setConfirmationPayload(null)}
        isLoading={isActionExecuting}
      />
    </div>
  );
};
