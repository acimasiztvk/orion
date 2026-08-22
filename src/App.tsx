import React, { useState, useEffect, useRef, useCallback } from 'react';
import { OrionGlobe } from './components/OrionGlobe';
import { HudHeader } from './components/HudHeader';
import { HudLeftDrawer } from './components/HudLeftDrawer';
import { HudRightDrawer } from './components/HudRightDrawer';
import { LiveTranscriptHUD, ActionLinkItem, BrowserTaskItem } from './components/LiveTranscriptHUD';
import { ActionResultData } from './components/ActionResultCard';
import { InHudViewportModal } from './components/InHudViewportModal';
import { BottomControls } from './components/BottomControls';
import { NotificationToast, ToastItem } from './components/NotificationToast';
import {
  TaskCompletionToast,
  TaskCompletionEvent,
  TaskCompletionCategory
} from './components/TaskCompletionToast';
import { AuthModal } from './components/AuthModal';
import { GmailHUD } from './components/GmailHUD';
import { HandControlMode } from './components/HandControlMode';
import {
  OrionState,
  User,
  UserProfileFact,
  Reminder,
  Note,
  Job,
  Conversation,
  Message,
  ToolLog,
  Contact
} from './types';
import { OrionMicStreamer, OrionAudioPlayer, WakeWordListener, BackgroundAudioStream, ClapDetector, soundFX } from './utils/audio';

export default function App() {
  // Theme State (Default: Dark)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('orion_theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
    localStorage.setItem('orion_theme', theme);
  }, [theme]);

  // Authentication State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('orion_auth_token'));
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Core AI State
  const [orionState, setOrionState] = useState<OrionState>('idle');
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [voiceMode, setVoiceMode] = useState<'live_stream' | 'quick_turn'>('live_stream');
  const [isListening, setIsListening] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [isHandControlMode, setIsHandControlMode] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [activeTaskRunId, setActiveTaskRunId] = useState<string | null>(null);
  const [detailsAvailable, setDetailsAvailable] = useState<boolean>(false);

  // Active Viewport & Browser Task States for in-HUD resilient rendering
  const [activeActionLink, setActiveActionLink] = useState<ActionLinkItem | null>(null);
  const [activeBrowserTask, setActiveBrowserTask] = useState<BrowserTaskItem | null>(null);
  const [activeActionResult, setActiveActionResult] = useState<ActionResultData | null>(null);
  const [viewportModalUrl, setViewportModalUrl] = useState<string | null>(null);
  const [viewportModalTitle, setViewportModalTitle] = useState<string | undefined>(undefined);

  // Live Transcripts
  const [userTranscript, setUserTranscript] = useState('');
  const [orionTranscript, setOrionTranscript] = useState(
    'ORION online. All systems calibrated, Sir. Audio streaming channel synchronized. How may I be of assistance?'
  );
  const [latestActionNotice, setLatestActionNotice] = useState<string | null>(null);

  // Drawers
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false);
  const [isGmailOpen, setIsGmailOpen] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState<
    'memory' | 'reminders' | 'notes' | 'jobs' | 'telemetry' | null
  >(null);

  // Data Collections
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string>('conv_init');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);
  const [facts, setFacts] = useState<UserProfileFact[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [toolLogs, setToolLogs] = useState<ToolLog[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Task Completion Visual & Audio Feedback Queue State
  const [taskCompletionEvents, setTaskCompletionEvents] = useState<TaskCompletionEvent[]>([]);
  const [isSpherePulsing, setIsSpherePulsing] = useState<boolean>(false);

  const triggerTaskCompletion = useCallback(
    (category: TaskCompletionCategory, title: string, detail?: string) => {
      const newEvt: TaskCompletionEvent = {
        id: `tc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        category,
        title,
        detail,
        timestamp: Date.now()
      };
      setTaskCompletionEvents((prev) => [...prev.slice(-7), newEvt]); // Keep max 8 in queue
      setIsSpherePulsing(true);
      setTimeout(() => {
        setIsSpherePulsing(false);
      }, 1000);
    },
    []
  );

  const dismissTaskCompletion = useCallback((id: string) => {
    setTaskCompletionEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearAllTaskCompletions = useCallback(() => {
    setTaskCompletionEvents([]);
  }, []);

  // Audio Engine & Wake Word / Clap Listener Refs
  const micStreamerRef = useRef<OrionMicStreamer | null>(null);
  const audioPlayerRef = useRef<OrionAudioPlayer | null>(null);
  const wakeWordListenerRef = useRef<WakeWordListener | null>(null);
  const bgAudioStreamRef = useRef<BackgroundAudioStream | null>(null);
  const clapDetectorRef = useRef<ClapDetector | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isLiveSessionActiveRef = useRef<boolean>(false);
  const recentWsAttemptsRef = useRef<number[]>([]);
  const isVoiceUnstableRef = useRef<boolean>(false);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pcmBufferRef = useRef<string[]>([]);
  const pendingTextCommandRef = useRef<string>('');
  const openLiveSessionRef = useRef<((cmd?: string) => Promise<void>) | null>(null);
  const closeLiveSessionRef = useRef<((fromTimeout?: boolean) => void) | null>(null);
  const [activeAnalyser, setActiveAnalyser] = useState<AnalyserNode | null>(null);

  // Standby Audio Sensor Controllers
  const pauseStandbySensors = useCallback(() => {
    if (wakeWordListenerRef.current) {
      wakeWordListenerRef.current.pause();
    }
    if (clapDetectorRef.current) {
      clapDetectorRef.current.stop();
    }
    if (bgAudioStreamRef.current) {
      bgAudioStreamRef.current.stop();
    }
  }, []);

  const ensureStandbySensorsStarted = useCallback(async () => {
    // DO NOT start standby sensors if a live session is currently active or connecting!
    if (isLiveSessionActiveRef.current) {
      return;
    }
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (isVoiceUnstableRef.current) {
      return;
    }

    if (wakeWordListenerRef.current) {
      wakeWordListenerRef.current.resume();
    }
    if (bgAudioStreamRef.current && clapDetectorRef.current) {
      const analyser = await bgAudioStreamRef.current.start();
      if (analyser) {
        clapDetectorRef.current.attachAnalyser(analyser);
        clapDetectorRef.current.start();
      }
    }
  }, []);

  // Helper for safe JSON fetches that never throw "Unexpected token '<'"
  const safeFetchJson = useCallback(async <T = any>(url: string, options?: RequestInit, fallback: T = [] as any): Promise<T> => {
    try {
      const res = await fetch(url, options);
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await res.json()) as T;
      }
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        return fallback;
      }
    } catch (err) {
      console.warn(`[SafeFetch] Network exception for ${url}:`, err);
      return fallback;
    }
  }, []);

  // Helper for authenticated fetch headers
  const getAuthHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
  }, [authToken]);

  // Add Toast helper with extended lifespan for actionable links
  const addToast = useCallback((type: string, title: string, description: string, url?: string) => {
    soundFX.playToolExecuted();
    const newToast: ToastItem = {
      id: `toast_${Date.now()}_${Math.random()}`,
      type,
      title,
      description,
      url
    };
    setToasts((prev) => [newToast, ...prev.slice(0, 4)]);
    const autoDismissTime = url || type === 'OPEN_LINK' || type === 'MEETING_CREATED' ? 25000 : 6500;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
    }, autoDismissTime);
  }, []);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Check existing session / me endpoint and setup background refresh loop (No forced token requirement)
  useEffect(() => {
    const checkAuth = async () => {
      const savedToken = localStorage.getItem('orion_auth_token');
      const savedRefreshToken = localStorage.getItem('orion_refresh_token');

      // Attempt to load current user from /api/auth/me
      const meData = await safeFetchJson<{ user?: User }>('/api/auth/me', {
        headers: savedToken ? { Authorization: `Bearer ${savedToken}` } : {}
      }, {});

      if (meData?.user) {
        setCurrentUser(meData.user);
        if (savedToken) setAuthToken(savedToken);
        loadUserData(savedToken || '', meData.user);
        return;
      }

      // If refresh token exists, attempt refresh
      if (savedRefreshToken) {
        const refreshData = await safeFetchJson<{ token?: string; refreshToken?: string; user?: User }>(
          '/api/auth/refresh',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: savedRefreshToken })
          },
          {}
        );

        if (refreshData?.token && refreshData?.user) {
          localStorage.setItem('orion_auth_token', refreshData.token);
          if (refreshData.refreshToken) {
            localStorage.setItem('orion_refresh_token', refreshData.refreshToken);
          }
          setAuthToken(refreshData.token);
          setCurrentUser(refreshData.user);
          loadUserData(refreshData.token, refreshData.user);
          return;
        }
      }

      // Seamless Guest / Commander Mode: No token needed, immediate launch!
      const defaultUser: User = {
        id: 'user_tony',
        name: 'Commander',
        email: 'commander@stark.ai',
        email_verified: true,
        has_completed_onboarding: true,
        created_at: new Date().toISOString()
      };
      setCurrentUser(defaultUser);
      loadUserData('', defaultUser);
    };

    checkAuth();

    // Background auto-refresh every 45 minutes to prevent sudden session logout
    const refreshInterval = setInterval(async () => {
      const savedRefreshToken = localStorage.getItem('orion_refresh_token');
      if (savedRefreshToken) {
        const data = await safeFetchJson<{ token?: string; refreshToken?: string; user?: User }>(
          '/api/auth/refresh',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: savedRefreshToken })
          },
          {}
        );
        if (data?.token) {
          localStorage.setItem('orion_auth_token', data.token);
          if (data.refreshToken) localStorage.setItem('orion_refresh_token', data.refreshToken);
          setAuthToken(data.token);
          if (data.user) setCurrentUser(data.user);
        }
      }
    }, 45 * 60 * 1000);

    return () => clearInterval(refreshInterval);
  }, [safeFetchJson]);

  // Periodic alert and reminder notification polling (every 10 seconds)
  useEffect(() => {
    if (!authToken) return;

    const alertInterval = setInterval(async () => {
      const headers = getAuthHeaders();
      const pendingAlerts = await safeFetchJson<any[]>('/api/alerts/pending', { headers }, []);
      if (Array.isArray(pendingAlerts) && pendingAlerts.length > 0) {
        for (const alert of pendingAlerts) {
          addToast(
            'NOTIFICATION_DISPATCHED',
            alert.title || 'REMINDER ALERT',
            alert.message
          );

          // Audio speech or TTS notification
          const audioBase64 = alert.metadata?.audioBase64;
          if (audioBase64 && !isMuted && audioPlayerRef.current) {
            audioPlayerRef.current.playChunk(audioBase64);
          } else if ('speechSynthesis' in window && alert.message) {
            try {
              window.speechSynthesis.cancel();
              const utterance = new SpeechSynthesisUtterance(alert.message);
              window.speechSynthesis.speak(utterance);
            } catch (e) {
              console.warn('[Alert Polling] Speech synthesis fallback failed:', e);
            }
          }

          // Refresh reminders list in state
          safeFetchJson<Reminder[]>('/api/reminders', { headers }, []).then((rems) => {
            if (Array.isArray(rems)) setReminders(rems);
          });
        }
      }
    }, 10000);

    return () => clearInterval(alertInterval);
  }, [authToken, getAuthHeaders, safeFetchJson, addToast, isMuted]);

  // Fetch initial user-specific data
  const loadUserData = async (token: string, user: User) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const [convsRes, factsRes, remsRes, notesRes, jobsRes, logsRes] = await Promise.all([
        safeFetchJson<Conversation[]>('/api/conversations', { headers }, []),
        safeFetchJson<UserProfileFact[]>('/api/profile', { headers }, []),
        safeFetchJson<Reminder[]>('/api/reminders', { headers }, []),
        safeFetchJson<Note[]>('/api/notes', { headers }, []),
        safeFetchJson<Job[]>('/api/jobs', { headers }, []),
        safeFetchJson<ToolLog[]>('/api/tool-logs', { headers }, [])
      ]);

      let activeConvId = '';
      if (Array.isArray(convsRes) && convsRes.length > 0) {
        setConversations(convsRes);
        activeConvId = convsRes[0].id;
        setCurrentConversationId(activeConvId);
      } else {
        // Create initial session
        const initConv = await safeFetchJson<Conversation>(
          '/api/conversations',
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ title: user.has_completed_onboarding ? 'Primary Operations' : 'The First Meeting' })
          },
          { id: `conv_${Date.now()}`, user_id: user.id, title: user.has_completed_onboarding ? 'Primary Operations' : 'The First Meeting', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        );
        setConversations([initConv]);
        activeConvId = initConv.id;
        setCurrentConversationId(initConv.id);
      }

      if (Array.isArray(factsRes)) setFacts(factsRes);
      if (Array.isArray(remsRes)) setReminders(remsRes);
      if (Array.isArray(notesRes)) setNotes(notesRes);
      if (Array.isArray(jobsRes)) setJobs(jobsRes);
      if (Array.isArray(logsRes)) setToolLogs(logsRes);

      // Fetch message history for the active conversation
      if (activeConvId) {
        await fetchMessages(activeConvId, token, user);
      }
    } catch (e) {
      console.warn('Failed to load user data:', e);
    }
  };

  const fetchMessages = async (convId: string, token?: string, userContext?: User) => {
    setIsLoadingMessages(true);
    const t = token || authToken;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (t) {
      headers['Authorization'] = `Bearer ${t}`;
    }
    try {
      const data = await safeFetchJson<Message[]>(`/api/conversations/${convId}/messages`, { headers }, []);
      if (Array.isArray(data)) {
        setMessages(data);
        const lastOrionMsg = [...data].reverse().find((m) => m.sender === 'orion');
        if (lastOrionMsg) {
          if (lastOrionMsg.task_run_id) {
            setActiveTaskRunId(lastOrionMsg.task_run_id);
          }
          if (lastOrionMsg.details_available) {
            setDetailsAvailable(true);
          }
        }

        // Custom greeting only if there are NO messages in this conversation
        const targetUser = userContext || currentUser;
        if (data.length === 0 && targetUser) {
          if (!targetUser.has_completed_onboarding) {
            const greeting = `Hello ${targetUser.name}! I am ORION — your Omniscient Real-time Intelligent Operations Node. Before we jump into schedules or technical tasks, I'd love to take a moment to get to know you personally. Who are you, and what are you currently focused on in life?`;
            setOrionTranscript(greeting);
          } else {
            setOrionTranscript(`Welcome back, ${targetUser.name}. All systems calibrated, Sir. Audio streaming channel synchronized. How may I be of assistance?`);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to fetch messages:', err);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  // Auth Success Handler
  const handleAuthSuccess = (token: string, refreshToken: string, user: User, isNewSignup: boolean) => {
    localStorage.setItem('orion_auth_token', token);
    if (refreshToken) {
      localStorage.setItem('orion_refresh_token', refreshToken);
    }
    localStorage.setItem('orion_auth_user', JSON.stringify(user));
    setAuthToken(token);
    setCurrentUser(user);
    setIsAuthModalOpen(false);

    // Reconnect websocket with new token
    if (wsRef.current) {
      wsRef.current.close();
    }

    loadUserData(token, user);

    if (isNewSignup) {
      addToast(
        'ONBOARDING_START',
        'First Meeting Initialized',
        `Welcome aboard, ${user.name}. Voice channel opening.`
      );
    } else {
      addToast('AUTH_SUCCESS', 'Session Authorized', `Commander ${user.name} authenticated via PostgreSQL.`);
    }
  };

  // Logout Handler
  const handleLogout = async () => {
    const savedRefreshToken = localStorage.getItem('orion_refresh_token');
    if (savedRefreshToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: savedRefreshToken })
        });
      } catch (e) {}
    }

    localStorage.removeItem('orion_auth_token');
    localStorage.removeItem('orion_refresh_token');
    localStorage.removeItem('orion_auth_user');
    setAuthToken(null);
    setCurrentUser(null);
    if (wsRef.current) {
      wsRef.current.close();
    }
    setConversations([]);
    setMessages([]);
    setFacts([]);
    setReminders([]);
    setNotes([]);
    setJobs([]);
    setToolLogs([]);
    setIsAuthModalOpen(true);
  };

  // Inactivity / silence timer management (10 seconds timeout)
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const closeLiveSession = useCallback((fromTimeout = false) => {
    clearSilenceTimer();
    pcmBufferRef.current = [];
    pendingTextCommandRef.current = '';
    isLiveSessionActiveRef.current = false;

    if (micStreamerRef.current) {
      micStreamerRef.current.stop();
    }
    if (wsRef.current) {
      const currentWs = wsRef.current;
      wsRef.current = null;
      try {
        currentWs.close();
      } catch (e) {
        // ignore close exceptions
      }
    }

    setIsListening(false);
    setIsLiveConnected(false);
    setOrionState('idle');

    if (fromTimeout) {
      addToast(
        'STANDBY_RESTORED',
        'Silence Timeout (20s)',
        'Live neural stream paused. Returned to local wake word standby mode.'
      );
      setLatestActionNotice('Local mode active — waiting for wake word "Orion"');
    }

    // Resume browser-local wake word detector and standby clap sensor if voice mode is enabled & connection is stable
    if (isVoiceEnabled && !isVoiceUnstableRef.current) {
      setTimeout(() => {
        if (!isLiveSessionActiveRef.current) {
          ensureStandbySensorsStarted();
        }
      }, 100);
    }
  }, [clearSilenceTimer, isVoiceEnabled, addToast, ensureStandbySensorsStarted]);

  closeLiveSessionRef.current = closeLiveSession;

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      console.log('[ORION Voice Engine] 20s silence detected — closing Gemini Live WebSocket & returning to local wake word standby');
      if (closeLiveSessionRef.current) {
        closeLiveSessionRef.current(true);
      }
    }, 20000);
  }, [clearSilenceTimer]);

  // Setup WebSocket for Live Streaming Mode
  const connectLiveWebSocket = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return wsRef.current;
    }

    // Rate-limit loop safeguard: If more than 3 connections occur within 10 seconds, trip safety breaker
    const now = Date.now();
    recentWsAttemptsRef.current = recentWsAttemptsRef.current.filter((t) => now - t < 10000);
    recentWsAttemptsRef.current.push(now);

    if (recentWsAttemptsRef.current.length > 3) {
      console.warn('[ORION Client] Voice connection unstable loop detected (>3 attempts in 10s). Pausing automatic reconnection.');
      isVoiceUnstableRef.current = true;
      isLiveSessionActiveRef.current = false;
      setIsVoiceEnabled(false);
      setIsListening(false);
      setIsLiveConnected(false);
      pauseStandbySensors();

      addToast(
        'WARNING',
        'Voice Connection Unstable',
        'Automatic voice connection suspended to prevent loop. Click the ORION Globe to retry.'
      );
      setLatestActionNotice('Voice connection unstable — automatic retries suspended. Click Globe to reconnect.');
      return null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const queryParam = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
    const wsUrl = `${protocol}//${window.location.host}/live${queryParam}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[ORION Client] Gemini Live WebSocket connected and READY');
      setIsLiveConnected(true);
      resetSilenceTimer();

      // 1. Flush pending text command if present from wake word detection
      if (pendingTextCommandRef.current) {
        const commandText = pendingTextCommandRef.current;
        pendingTextCommandRef.current = '';
        setUserTranscript(commandText);
        console.log('[ORION Client] Sending buffered initial text command:', commandText);
        ws.send(JSON.stringify({ type: 'text', text: commandText }));
      }

      // 2. Flush any PCM audio chunks buffered while WebSocket was establishing handshake
      if (pcmBufferRef.current.length > 0) {
        console.log(`[ORION Client] Flushing ${pcmBufferRef.current.length} buffered PCM audio chunks to Gemini Live`);
        while (pcmBufferRef.current.length > 0) {
          const chunk = pcmBufferRef.current.shift();
          if (chunk) {
            ws.send(JSON.stringify({ type: 'audio', data: chunk }));
          }
        }
      }
    };

    ws.onmessage = (event) => {
      resetSilenceTimer();
      try {
        const msg = JSON.parse(event.data);

        // 1. Audio chunk received from Gemini Live
        if (msg.type === 'audio' && msg.data) {
          if (!isMuted && audioPlayerRef.current) {
            audioPlayerRef.current.playChunk(msg.data);
          }
        }

        // 2. Output speech transcription from model
        if (msg.type === 'output_transcription' && msg.text) {
          setOrionTranscript((prev) => prev + msg.text);
          setOrionState('speaking');
        }

        // 3. User spoken input transcription
        if (msg.type === 'input_transcription' && msg.text) {
          setUserTranscript((prev) => prev + msg.text);
        }

        // 4. Barge-in / interruption
        if (msg.type === 'interrupted') {
          console.log('[ORION Client] Interrupted by user speech');
          if (audioPlayerRef.current) {
            audioPlayerRef.current.interrupt();
          }
          setOrionState('listening');
        }

        // 5. Autonomous Client Action / Tool Execution
        if (msg.type === 'client_action' && msg.action) {
          handleClientAction(msg.action, msg.toolName);
        }

        // 6. Server Status & Errors (e.g. Quota Exceeded)
        if (msg.type === 'status' && msg.status === 'fallback_ready' && msg.error) {
          console.error('[ORION] Server failed to connect to Gemini Live:', msg.error);
          addToast('ERROR', 'Voice Connection Failed', msg.error);
          closeLiveSessionRef.current?.(false);
        }
      } catch (err) {
        console.warn('WS message parse err:', err);
      }
    };

    ws.onclose = () => {
      console.log('[ORION Client] Gemini Live WebSocket disconnected');
      setIsLiveConnected(false);
      isLiveSessionActiveRef.current = false;
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      closeLiveSessionRef.current?.(true);
    };

    ws.onerror = (e) => {
      console.warn('[ORION Client] WS error:', e);
    };

    wsRef.current = ws;
    return ws;
  }, [isMuted, authToken, resetSilenceTimer, pauseStandbySensors, addToast]);

  // Open Gemini Live WebSocket & start PCM Mic streamer on wake word or explicit toggle
  const openLiveSession = useCallback(async (initialCommand?: string) => {
    if (isVoiceUnstableRef.current) {
      console.log('[ORION] Cannot open live session — voice connection is currently flagged unstable.');
      return;
    }

    clearSilenceTimer();
    isLiveSessionActiveRef.current = true;

    // Store pending initial text command if extracted during wake word recognition
    pendingTextCommandRef.current = initialCommand?.trim() || '';
    pcmBufferRef.current = [];

    // 1. Pause local wake word engine & stop background clap sensor so microphone device is freed for PCM streamer
    pauseStandbySensors();

    // Short delay (~80ms) for clean hardware mic handover between Web Speech API and AudioContext
    await new Promise((r) => setTimeout(r, 80));

    setUserTranscript('');
    setOrionTranscript('');
    setIsVoiceEnabled(true);
    setIsListening(true);
    setOrionState('listening');
    soundFX.playListeningStart();

    try {
      // 2. Open Gemini Live WebSocket
      const ws = connectLiveWebSocket();
      if (!ws) {
        // Safeguard tripped
        closeLiveSession(false);
        return;
      }

      // 3. Start PCM Mic Streamer
      if (micStreamerRef.current) {
        await micStreamerRef.current.start(
          (base64Pcm, isSpeaking) => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'audio', data: base64Pcm }));
            } else {
              // Buffer PCM audio chunks while WebSocket is establishing handshake so no speech is lost!
              pcmBufferRef.current.push(base64Pcm);
            }
            // Reset silence timer whenever user is actively speaking or sending speech audio chunks
            if (isSpeaking) {
              resetSilenceTimer();
            }
          },
          (analyser) => {
            setActiveAnalyser(analyser);
          }
        );
        resetSilenceTimer();
      }
    } catch (err) {
      console.warn('[ORION] Could not initialize live voice session:', err);
      addToast('ERROR', 'Microphone Connection Failed', 'Unable to start live audio stream.');
      closeLiveSession(false);
    }
  }, [connectLiveWebSocket, resetSilenceTimer, closeLiveSession, clearSilenceTimer, addToast, pauseStandbySensors]);

  openLiveSessionRef.current = openLiveSession;

  // Explicit user gesture handler to request mic permission and start persistent Wake Word & Clap listening
  const handleEnableVoice = async () => {
    soundFX.playHudTick();
    isVoiceUnstableRef.current = false;
    recentWsAttemptsRef.current = [];
    try {
      // 1. Request mic permission from user gesture
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());

      // 2. Enable voice mode state and start continuous local wake word detector & double-clap sensor
      setIsVoiceEnabled(true);
      await ensureStandbySensorsStarted();

      addToast(
        'VOICE_ENABLED',
        'Local Standby Sensors Active',
        'ORION is listening locally for "Hey Orion" or Double-Clap. Zero audio transferred to cloud.'
      );
      setLatestActionNotice('Local sensors active — listening for "Orion" or Double-Clap');
    } catch (err) {
      console.warn('[ORION] Mic permission request failed:', err);
      addToast(
        'ERROR',
        'Microphone Permission Required',
        'Please grant microphone access for wake word & clap detection.'
      );
    }
  };

  // Reactive Effect to manage standby sensors based on isVoiceEnabled state
  useEffect(() => {
    if (isVoiceEnabled && !isLiveSessionActiveRef.current && !isVoiceUnstableRef.current) {
      ensureStandbySensorsStarted();
    } else {
      pauseStandbySensors();
    }
  }, [isVoiceEnabled, ensureStandbySensorsStarted, pauseStandbySensors]);

  // Initialize Audio Player & Background Wake Word Listener (runs ONCE on mount)
  useEffect(() => {
    audioPlayerRef.current = new OrionAudioPlayer((isPlaying) => {
      if (isPlaying) {
        setOrionState('speaking');
        if (audioPlayerRef.current) {
          setActiveAnalyser(audioPlayerRef.current.getAnalyser());
        }
        clearSilenceTimer();
      } else {
        setOrionState(isListening ? 'listening' : 'idle');
        // When speech finishes, start the 20-second silence timer countdown
        resetSilenceTimer();
      }
    });

    micStreamerRef.current = new OrionMicStreamer();

    // Initialize standby Audio Stream & Double-Clap Detector
    bgAudioStreamRef.current = new BackgroundAudioStream();
    clapDetectorRef.current = new ClapDetector(() => {
      console.log('[ORION CLAP ACTIVATION] Double clap detected — triggering voice stream!');
      soundFX.playToolExecuted();
      addToast(
        'CLAP_DETECTED',
        'Double-Clap Recognized',
        'Acoustic double-clap trigger recognized — opening live voice stream.'
      );
      setLatestActionNotice('Double-clap recognized — live voice stream engaged');

      if (openLiveSessionRef.current) {
        openLiveSessionRef.current();
      }
    });

    // Initialize continuous background Wake Word Detector for "Orion"
    try {
      wakeWordListenerRef.current = new WakeWordListener(
        (followingText) => {
          console.log('[ORION WAKE WORD TRIGGERED] Following text:', followingText);
          addToast('WAKE_WORD_DETECTED', 'Wake Word Recognized', '"Orion" detected — live cloud neural stream engaged.');
          setLatestActionNotice('Wake word "Orion" recognized — live voice stream engaged');

          if (openLiveSessionRef.current) {
            openLiveSessionRef.current(followingText);
          }
        },
        (err) => {
          console.warn('[ORION] Wake word background listener warning:', err);
        },
        (status) => {
          if (status.error) {
            console.warn('[ORION] Wake word sensor issue:', status.error);
            addToast('WARNING', 'Wake-Word Sensor Issue', `Local detector status: ${status.error}`);
          }
        }
      );
    } catch (wakeErr) {
      console.warn('[ORION] Wake word listener initialization bypassed:', wakeErr);
    }

    // Play startup chime
    soundFX.playPowerOn();

    return () => {
      clearSilenceTimer();
      if (audioPlayerRef.current) {
        audioPlayerRef.current.interrupt();
      }
      if (micStreamerRef.current) {
        micStreamerRef.current.stop();
      }
      if (wakeWordListenerRef.current) {
        wakeWordListenerRef.current.stop();
      }
      if (clapDetectorRef.current) {
        clapDetectorRef.current.stop();
      }
      if (bgAudioStreamRef.current) {
        bgAudioStreamRef.current.stop();
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Handle autonomous action execution
  const handleClientAction = (action: any, toolName?: string) => {
    // Add to telemetry tool logs
    setToolLogs((prev) => [
      {
        id: `log_${Date.now()}_${Math.random()}`,
        name: toolName || action.type,
        args: action,
        timestamp: new Date().toISOString(),
        status: 'success'
      },
      ...prev
    ]);

    switch (action.type) {
      case 'ONBOARDING_COMPLETED': {
        if (currentUser) {
          const updatedUser = { ...currentUser, has_completed_onboarding: true };
          setCurrentUser(updatedUser);
          localStorage.setItem('orion_auth_user', JSON.stringify(updatedUser));
        }
        addToast(
          'ONBOARDING_COMPLETED',
          'First Meeting Concluded',
          'ORION is now primed and in full operational readiness, Sir.'
        );
        setLatestActionNotice('First Meeting Protocol complete → Full Operational Mode');
        triggerTaskCompletion('default', 'Onboarding Complete', 'ORION is ready for active dispatch.');
        break;
      }
      case 'SUBSCRIPTION_CANCELLED': {
        triggerTaskCompletion(
          'subscription',
          `${action.service_name || 'Subscription'} Terminated`,
          action.detail || action.reason || 'Subscription and auto-renewal ended.'
        );
        addToast(
          'SUBSCRIPTION_CANCELLED',
          'Subscription Cancelled',
          `${action.service_name || 'Service'} subscription terminated.`
        );
        setLatestActionNotice(`Subscription cancelled: ${action.service_name || ''}`);
        break;
      }
      case 'PROFILE_UPDATED': {
        const fact: UserProfileFact = action.fact;
        setFacts((prev) => {
          const filtered = prev.filter((f) => f.id !== fact.id && f.key !== fact.key);
          return [fact, ...filtered];
        });
        addToast(
          'PROFILE_UPDATED',
          'Memory Archived',
          `Remembered [${fact.category}] ${fact.key}: ${fact.value}`
        );
        setLatestActionNotice(`Memory synced: ${fact.key} → ${fact.value}`);
        triggerTaskCompletion('memory', 'Memory Archived', `${fact.key}: ${fact.value}`);
        break;
      }
      case 'REMINDER_SAVED': {
        const rem: Reminder = action.reminder;
        setReminders((prev) => [rem, ...prev]);
        addToast('REMINDER_SAVED', 'Task Scheduled', `"${rem.text}" set for ${rem.datetime}`);
        setLatestActionNotice(`Reminder scheduled for ${rem.datetime}`);
        triggerTaskCompletion('reminder', 'Reminder Created', rem.text);
        break;
      }
      case 'NOTE_SAVED': {
        const note: Note = action.note;
        setNotes((prev) => [note, ...prev]);
        addToast('NOTE_SAVED', 'Note Archived', `Saved in [${note.category}]: ${note.content.substring(0, 45)}...`);
        setLatestActionNotice(`Note saved to [${note.category}]`);
        triggerTaskCompletion('note', 'Note Archived', `[${note.category}] ${note.content ? note.content.substring(0, 30) : ''}`);
        break;
      }
      case 'JOBS_FOUND': {
        const foundJobs: Job[] = action.jobs;
        if (foundJobs && foundJobs.length > 0) {
          setJobs(foundJobs);
          addToast('JOBS_FOUND', 'Job Radar Updated', `Located ${foundJobs.length} high-tech opportunities`);
          setLatestActionNotice(`Job radar located ${foundJobs.length} matching positions`);
          triggerTaskCompletion('jobs', 'Career Radar Search Complete', `${foundJobs.length} positions located`);
        }
        break;
      }
      case 'OPEN_LINK': {
        const url = action.url;
        const target = action.targetName || 'target URL';

        // Attempt automatic tab opening
        let openedWin: Window | null = null;
        try {
          openedWin = window.open(url, '_blank', 'noopener,noreferrer');
        } catch (err) {
          console.warn('[ORION OpenLink] Direct window.open exception:', err);
        }

        // Check if browser blocked popup (null, closed, or undefined handle)
        const isBlocked = !openedWin || openedWin.closed || typeof openedWin.closed === 'undefined';

        if (!isBlocked) {
          addToast('OPEN_LINK', 'External Viewport Opened', `Launched ${target} in a new tab`, url);
          setLatestActionNotice(`Launched external portal: ${target}`);
          triggerTaskCompletion('browser', 'External Link Opened', target);
        } else {
          // If popup was blocked by browser security policy, store active link & show explicit popup blocker warning
          setActiveActionLink({
            url,
            targetName: target,
            timestamp: new Date().toISOString()
          });
          addToast(
            'OPEN_LINK',
            'Popup Blocked by Browser',
            `Browser blocked automatic popup for ${target}. Click here or allow popups for ORION.`,
            url
          );
          setLatestActionNotice(`Popup blocked by browser — Click to launch ${target}`);
          triggerTaskCompletion('browser', 'Link Prepared', target);
        }
        break;
      }
      case 'BROWSER_TASK_DISPATCHED': {
        const platform = action.platform || action.target_platform || 'Target Website';
        const steps = action.steps || [];
        const runId = action.runId || activeTaskRunId || `run_${Date.now()}`;
        const extractedTitle = action.extracted_title || platform;
        const extractedContent = action.extracted_content;
        const finalUrl = action.final_url;

        setActiveBrowserTask({
          runId,
          platform,
          action_type: action.action_type,
          steps,
          executed_steps: action.executed_steps,
          extracted_title: extractedTitle,
          extracted_content: extractedContent,
          final_url: finalUrl
        });

        // Set rich interactive Action Result Card state directly in HUD
        setActiveActionResult({
          runId,
          platform,
          action_type: action.action_type,
          extracted_title: extractedTitle,
          extracted_content: extractedContent,
          final_url: finalUrl,
          steps_count: steps.length || action.executed_steps?.length || 0,
          steps_executed: action.executed_steps,
          timestamp: new Date().toISOString()
        });

        addToast(
          'BROWSER_TASK_DISPATCHED',
          'Autonomous Task Verified',
          `${extractedTitle}: ${steps.length || action.executed_steps?.length || 'multi'}-step workflow verified.`
        );
        setLatestActionNotice(`Verified on ${platform}: ${extractedTitle}`);
        triggerTaskCompletion('browser', 'Web Task Completed', `${platform}: ${extractedTitle}`);
        break;
      }
      case 'MEETING_CREATED': {
        const meetingTopic = action.topic || 'Strategic Session';
        const joinUrl = action.join_url;
        const meetingCode = action.meeting_code;
        const platform = action.platform === 'zoom' ? 'Zoom Meetings' : 'Google Meet';
        const autoLaunch = action.auto_launch ?? true;

        setActiveActionResult({
          runId: action.meeting_id || `mtg_${Date.now()}`,
          platform,
          action_type: 'MEETING_CREATED',
          extracted_title: `${platform}: ${meetingTopic}`,
          extracted_content: action.extracted_content || `Meeting created: ${joinUrl}`,
          final_url: joinUrl,
          meeting_id: action.meeting_id,
          meeting_code: meetingCode,
          passcode: action.passcode,
          topic: meetingTopic,
          scheduled_time: action.scheduled_time,
          attendees: action.attendees,
          invitee_name: action.invitee_name,
          invitee_email: action.invitee_email,
          calendar_invite_url: action.calendar_invite_url,
          mailto_invite_url: action.mailto_invite_url,
          shareable_invite_text: action.shareable_invite_text,
          auto_launch: autoLaunch,
          timestamp: new Date().toISOString()
        });

        addToast(
          'MEETING_CREATED',
          `${platform} Auto-Launching...`,
          `${meetingCode || joinUrl} • Redirecting directly to live room session.`
        );
        setLatestActionNotice(`Autonomous meeting launch: ${meetingCode || joinUrl}`);
        triggerTaskCompletion('call', 'Meeting Link Ready', `${platform}: ${meetingTopic}`);

        // Zero-Click Autonomous Auto-Launch Execution
        if (autoLaunch && joinUrl) {
          try {
            const launched = window.open(joinUrl, '_blank', 'noopener,noreferrer');
            if (!launched) {
              console.log('[ORION Meeting] Popup blocked by browser iframe policy; interactive auto-redirect active in HUD.');
            }
          } catch (e) {
            console.warn('[ORION Meeting] Autonomous window open failed:', e);
          }
        }
        break;
      }
      case 'MEETING_PROXY_DISPATCHED': {
        const proxyTitle = action.extracted_title || 'Meeting Proxy [STATUS: MEETING_JOINED]';
        const meetingUrl = action.meeting_url;
        const meetingCode = action.meeting_code;
        const runId = action.runId || `proxy_${Date.now()}`;

        setActiveActionResult({
          runId,
          platform: meetingUrl?.includes('zoom.us') ? 'Zoom' : 'Google Meet',
          action_type: 'MEETING_PROXY_DISPATCHED',
          extracted_title: proxyTitle,
          extracted_content: action.extracted_content,
          final_url: meetingUrl,
          meeting_code: meetingCode,
          proxy_identity: action.proxy_identity,
          phase_tag: action.phase_tag || '[STATUS: MEETING_JOINED]',
          steps_executed: action.executed_steps,
          timestamp: new Date().toISOString()
        });

        addToast(
          'MEETING_PROXY_DISPATCHED',
          'Meeting Proxy Active [STATUS: MEETING_JOINED]',
          `Orion joined ${meetingCode || 'meeting'} on your behalf. Monitoring discussion and logging minutes.`
        );
        setLatestActionNotice(`Meeting Proxy Active [STATUS: MEETING_JOINED] (${meetingCode})`);
        break;
      }
      case 'NOTIFY_USER':
      case 'NOTIFICATION_DISPATCHED': {
        const title = action.title || 'ORION Alert';
        const message = action.message || '';
        
        addToast(
          'NOTIFICATION_DISPATCHED',
          title,
          message
        );
        setLatestActionNotice(`${title}: ${message.slice(0, 50)}`);

        // Trigger native browser notification if permitted
        if (typeof window !== 'undefined' && 'Notification' in window) {
          if (Notification.permission === 'granted') {
            try {
              new Notification(title, { body: message });
            } catch (e) {
              console.warn('[WEB NOTIFICATION] Could not display native notification:', e);
            }
          } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then((perm) => {
              if (perm === 'granted') {
                try {
                  new Notification(title, { body: message });
                } catch {}
              }
            });
          }
        }
        break;
      }
      case 'CLAUDE_SETUP_REQUIRED': {
        addToast(
          'CLAUDE_SETUP_REQUIRED',
          'Claude Setup Needed',
          'Please configure ANTHROPIC_API_KEY in your environment or Settings.'
        );
        setLatestActionNotice('Claude delegation requires ANTHROPIC_API_KEY in Settings');
        break;
      }
      case 'CLAUDE_AUTH_FAILED': {
        addToast(
          'CLAUDE_AUTH_FAILED',
          'Anthropic Key Unauthorized',
          action.error || 'The provided ANTHROPIC_API_KEY was rejected by Anthropic.'
        );
        setLatestActionNotice('Anthropic API Key unauthorized — check key in Settings');
        break;
      }
      case 'CLAUDE_CREDITS_LOW': {
        addToast(
          'CLAUDE_CREDITS_LOW',
          'Anthropic Credits Low (Resolved via Gemini)',
          'Anthropic balance low; seamlessly completed via Orion Neural Core.'
        );
        setLatestActionNotice('Resolved via Orion Neural Core (Anthropic balance low)');
        break;
      }
      case 'CLAUDE_FALLBACK_COMPLETED': {
        addToast(
          'CLAUDE_FALLBACK_COMPLETED',
          'Resolved via Orion Neural Core',
          'Task completed via primary neural engine.'
        );
        setLatestActionNotice('Analysis completed via Orion primary neural core');
        break;
      }
      case 'CLAUDE_DELEGATED':
      case 'CLAUDE_DELEGATION_COMPLETED': {
        addToast(
          'CLAUDE_DELEGATED',
          'Claude Analysis Complete',
          action.summary || `Reasoning received from ${action.model || 'Claude'}.`
        );
        setLatestActionNotice(`Reasoning synthesized from ${action.model || 'Claude'}`);
        triggerTaskCompletion('insight', 'Neural Model Reasoning Complete', action.task || 'Claude Delegation');
        break;
      }
      case 'WEB_SEARCH_DONE': {
        addToast('WEB_SEARCH_DONE', 'Live Web Search Grounding', `Retrieved fresh data for: "${action.query}"`);
        setLatestActionNotice(`Web grounding synced for "${action.query}"`);
        triggerTaskCompletion('browser', 'Live Web Search Grounded', action.query);
        break;
      }
      case 'PHONE_CALL_INITIATED': {
        const phone = action.phoneNumber || action.call?.phone_number || 'target number';
        addToast('PHONE_CALL_INITIATED', 'Outbound Call Placed', `Connected via Vapi AI to ${phone}`);
        setLatestActionNotice(`Outbound voice link active: ${phone}`);
        triggerTaskCompletion('call', 'Voice Call Dispatched', phone);
        break;
      }
      case 'PHONE_CALL_SETUP_REQUIRED': {
        const missing = (action.missing || []).join(', ');
        addToast('PHONE_CALL_SETUP_REQUIRED', 'Telephony Configuration Needed', `Please provide: ${missing} in Settings.`);
        setLatestActionNotice(`Telephony setup required in Settings: ${missing}`);
        break;
      }
      case 'PHONE_CALL_FAILED': {
        addToast('PHONE_CALL_FAILED', 'Outbound Call Failed', action.error || 'Unable to connect call.');
        setLatestActionNotice(`Call dispatch failed: ${action.error || 'Error'}`);
        break;
      }
      case 'PHONE_CALL_ACTION_REQUIRED': {
        addToast('PHONE_CALL_ACTION_REQUIRED', 'Call Action Required', action.prompt || 'Agent requests your input on active call.');
        setLatestActionNotice(`Decision required on active call`);
        break;
      }
      case 'CONTACT_SAVED': {
        if (action.contact?.name) {
          setLatestActionNotice(`Contact synced: ${action.contact.name}`);
        }
        break;
      }
      case 'CONTACT_DELETED': {
        if (action.target) {
          setLatestActionNotice(`Contact removed: ${action.target}`);
        }
        break;
      }
      case 'CONTACTS_LISTED': {
        break;
      }
      case 'CONTACT_RESOLVED': {
        if (action.contact) {
          setLatestActionNotice(`Resolved: ${action.contact.name || ''}`);
        }
        break;
      }
      case 'OPEN_GMAIL': {
        setIsGmailOpen(true);
        addToast('OPEN_GMAIL', 'Gmail Command Center Active', 'Opening secure Google Workspace interface.');
        setLatestActionNotice('Gmail Command Center engaged');
        break;
      }
      case 'CONTROL_HUD_VIEW': {
        const view = (action.view || '').toLowerCase();
        const act = action.action || 'open';

        if (act === 'close') {
          if (view === 'gmail' || view === 'mail' || view === 'all') {
            setIsGmailOpen(false);
          }
          if (view === 'sessions' || view === 'archives' || view === 'all') {
            setIsLeftDrawerOpen(false);
          }
          if (['memory', 'reminders', 'tasks', 'notes', 'jobs', 'telemetry', 'all'].includes(view)) {
            setActiveRightTab(null);
          }
          setLatestActionNotice(`Dismissed ${view} overlay`);
        } else {
          // Open or toggle on-demand
          if (view === 'gmail' || view === 'mail' || view === 'email' || view === 'emails') {
            setIsGmailOpen(true);
            addToast('CONTROL_HUD_VIEW', 'Gmail Command Center Active', 'Opening on-demand workspace mailbox viewport.');
            setLatestActionNotice('Gmail Command Center engaged');
          } else if (view === 'sessions' || view === 'history' || view === 'archives') {
            setIsLeftDrawerOpen(true);
            setLatestActionNotice('Archives & Sessions drawer engaged');
          } else {
            const mappedTab = (view === 'tasks' ? 'reminders' : view) as 'memory' | 'reminders' | 'notes' | 'jobs' | 'telemetry';
            setActiveRightTab(mappedTab);
            const tabName = mappedTab.toUpperCase();
            addToast('CONTROL_HUD_VIEW', `${tabName} Engaged`, `Displaying ${tabName} data matrix.`);
            setLatestActionNotice(`Autonomous HUD View engaged: ${tabName}`);
          }
        }
        break;
      }
      default:
        break;
    }
  };

  // Toggle Voice Input (Mic) via ORION Globe Click
  const handleToggleVoice = async () => {
    soundFX.playHudTick();
    isVoiceUnstableRef.current = false;
    recentWsAttemptsRef.current = [];

    if (isListening || isLiveConnected) {
      // If currently connected to live stream -> close session and return to local wake word standby
      closeLiveSession(false);
      addToast('STANDBY_ENGAGED', 'Local Standby Active', 'Live cloud stream closed. Waiting for "Orion".');
      setLatestActionNotice('Local mode active — waiting for wake word "Orion"');
    } else {
      // Direct click on ORION Globe immediately opens live session for direct speaking
      addToast('LIVE_VOICE_STARTED', 'Live Voice Active', 'ORION is listening, you can speak your command directly.');
      openLiveSession();
    }
  };

  // Open Telemetry details for specific task run or all logs
  const handleViewDetails = async (runId?: string | null) => {
    soundFX.playHudTick();
    const targetRun = runId || activeTaskRunId;
    if (targetRun) {
      setActiveTaskRunId(targetRun);
      const logs = await safeFetchJson<ToolLog[]>(`/api/tool-logs?runId=${encodeURIComponent(targetRun)}`, { headers: getAuthHeaders() }, []);
      if (Array.isArray(logs) && logs.length > 0) {
        setToolLogs((prev) => {
          const logIds = new Set(logs.map(l => l.id));
          return [...logs, ...prev.filter(l => !logIds.has(l.id))];
        });
      }
    } else {
      setActiveTaskRunId(null);
    }
    setActiveRightTab('telemetry');
  };

  // Process text or quick turn voice request
  const processQuickTurn = async (inputText: string) => {
    setOrionState('thinking');
    setUserTranscript(inputText);
    setOrionTranscript('');
    setLatestActionNotice(null);

    // Optimistically push user message to transcript list
    const tempUserMsg: Message = {
      id: `msg_tmp_${Date.now()}`,
      conversation_id: currentConversationId,
      sender: 'user',
      text: inputText,
      timestamp: new Date().toISOString()
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const data = await safeFetchJson<{
        replyText?: string;
        error?: string;
        clientActions?: any[];
        audio?: string;
        taskRunId?: string;
        detailsAvailable?: boolean;
        acknowledgment?: string;
      }>('/api/chat', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          message: inputText,
          conversationId: currentConversationId,
          generateAudio: !isMuted
        })
      }, { error: 'Failed to communicate with ORION server' });

      if (data.error && !data.replyText) throw new Error(data.error);

      if (data.taskRunId) {
        setActiveTaskRunId(data.taskRunId);
      }
      setDetailsAvailable(Boolean(data.detailsAvailable || data.taskRunId));

      setOrionTranscript(data.replyText || 'Command acknowledged, Sir.');

      // Handle executed tool actions
      if (data.clientActions && Array.isArray(data.clientActions)) {
        for (const act of data.clientActions) {
          handleClientAction(act);
        }
      }

      // Play generated audio if present
      if (data.audio && !isMuted && audioPlayerRef.current) {
        audioPlayerRef.current.playChunk(data.audio);
      } else {
        setOrionState('idle');
      }

      // Refresh conversations, messages, and tool logs
      fetchMessages(currentConversationId);
      const updatedLogs = await safeFetchJson<ToolLog[]>('/api/tool-logs', { headers: getAuthHeaders() }, []);
      if (Array.isArray(updatedLogs)) {
        setToolLogs(updatedLogs);
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      setOrionTranscript(`Apologies, Sir. An anomaly occurred: ${err.message}`);
      setOrionState('idle');
    }
  };

  // Send Text handler
  const handleSendText = (text: string) => {
    soundFX.playHudTick();
    if (voiceMode === 'live_stream' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setUserTranscript(text);
      setOrionTranscript('');
      setOrionState('thinking');
      wsRef.current.send(JSON.stringify({ type: 'text', text }));
    } else {
      processQuickTurn(text);
    }
  };

  // Barge-in / Interrupt handler
  const handleInterrupt = () => {
    soundFX.playHudTick();
    if (audioPlayerRef.current) {
      audioPlayerRef.current.interrupt();
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    setOrionState(isListening ? 'listening' : 'idle');
  };

  // Handlers for Drawer actions
  const handleCreateConversation = async () => {
    const newConv = await safeFetchJson<Conversation>(
      '/api/conversations',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ title: `Session ${conversations.length + 1}` })
      },
      { id: `conv_${Date.now()}`, user_id: currentUser?.id || 'user_tony', title: `Session ${conversations.length + 1}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    );
    setConversations([newConv, ...conversations]);
    setCurrentConversationId(newConv.id);
    setMessages([]);
    setOrionTranscript('New session initialized, Sir. Awaiting your instructions.');
    addToast('SESSION_CREATED', 'Session Initialized', `ID: ${newConv.id}`);
  };

  const handleDeleteConversation = async (id: string) => {
    await safeFetchJson(`/api/conversations/${id}`, { method: 'DELETE', headers: getAuthHeaders() }, {});
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (currentConversationId === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      if (remaining.length > 0) {
        setCurrentConversationId(remaining[0].id);
        fetchMessages(remaining[0].id);
      } else {
        handleCreateConversation();
      }
    }
  };

  const handleAddFact = async (category: string, key: string, value: string) => {
    const fact = await safeFetchJson<UserProfileFact>(
      '/api/profile',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ category, key, value })
      },
      { id: `fact_${Date.now()}`, user_id: currentUser?.id || 'user_tony', category, key, value, updated_at: new Date().toISOString() }
    );
    setFacts((prev) => [fact, ...prev.filter((f) => f.id !== fact.id)]);
    addToast('PROFILE_UPDATED', 'Fact Stored', `${key}: ${value}`);
  };

  const handleToggleReminder = async (id: string) => {
    await safeFetchJson(`/api/reminders/${id}/toggle`, { method: 'PATCH', headers: getAuthHeaders() }, {});
    setReminders((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, status: r.status === 'pending' ? 'completed' : 'pending' } : r
      )
    );
  };

  const handleDeleteReminder = async (id: string) => {
    await safeFetchJson(`/api/reminders/${id}`, { method: 'DELETE', headers: getAuthHeaders() }, {});
    setReminders((prev) => prev.filter((r) => r.id !== id));
  };

  const handleAddReminder = async (text: string, datetime: string) => {
    const rem = await safeFetchJson<Reminder>(
      '/api/reminders',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ text, datetime })
      },
      { id: `rem_${Date.now()}`, user_id: currentUser?.id || 'user_tony', text, datetime, status: 'pending', created_at: new Date().toISOString() }
    );
    setReminders((prev) => [rem, ...prev]);
    addToast('REMINDER_SAVED', 'Reminder Scheduled', `${text} (${datetime})`);
  };

  const handleDeleteNote = async (id: string) => {
    await safeFetchJson(`/api/notes/${id}`, { method: 'DELETE', headers: getAuthHeaders() }, {});
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  const handleAddNote = async (category: string, content: string) => {
    const note = await safeFetchJson<Note>(
      '/api/notes',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ category, content })
      },
      { id: `note_${Date.now()}`, user_id: currentUser?.id || 'user_tony', category, content, created_at: new Date().toISOString() }
    );
    setNotes((prev) => [note, ...prev]);
    addToast('NOTE_SAVED', 'Note Archived', note.content.substring(0, 40));
  };

  const handleSearchJobs = async (query: string, location?: string) => {
    const data = await safeFetchJson<Job[]>(
      `/api/jobs?query=${encodeURIComponent(query)}&location=${encodeURIComponent(location || '')}`,
      { headers: getAuthHeaders() },
      []
    );
    if (Array.isArray(data)) setJobs(data);
  };

  const handleManualCompleteOnboarding = async () => {
    const data = await safeFetchJson<{ user?: User }>(
      '/api/auth/complete-onboarding',
      {
        method: 'POST',
        headers: getAuthHeaders()
      },
      {}
    );
    if (data?.user) {
      setCurrentUser(data.user);
      localStorage.setItem('orion_auth_user', JSON.stringify(data.user));
      addToast(
        'ONBOARDING_COMPLETED',
        'Protocol Transitioned',
        'First meeting archived. ORION is now in full operational mode.'
      );
    }
  };

  return (
    <div className={`relative w-screen h-screen overflow-hidden hud-grid-bg ${theme === 'dark' ? 'dark text-slate-100 bg-[#0A0E17]' : 'light text-slate-900 bg-[#F8FAFC]'} flex flex-col justify-between transition-colors duration-300`}>
      {/* Subtle Scanline Overlay */}
      <div className="scanline-overlay fixed inset-0 z-20 pointer-events-none opacity-40" />

      {/* Floating Notification Toasts */}
      <NotificationToast toasts={toasts} onDismiss={dismissToast} />

      {/* Task Completion Visual & Audio Feedback Queue Toast */}
      <TaskCompletionToast
        events={taskCompletionEvents}
        onDismiss={dismissTaskCompletion}
        onClearAll={clearAllTaskCompletions}
        isMuted={isMuted}
      />

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />

      {/* Top HUD Header */}
      <HudHeader
        orionState={orionState}
        currentUser={currentUser}
        isLiveConnected={isLiveConnected}
        voiceMode={voiceMode}
        onToggleVoiceMode={() => {
          soundFX.playHudTick();
          setVoiceMode((prev) => (prev === 'live_stream' ? 'quick_turn' : 'live_stream'));
        }}
        isMuted={isMuted}
        onToggleMute={() => {
          soundFX.playHudTick();
          setIsMuted(!isMuted);
          if (!isMuted && audioPlayerRef.current) {
            audioPlayerRef.current.interrupt();
          }
        }}
        isVoiceEnabled={isVoiceEnabled}
        onEnableVoice={handleEnableVoice}
        onOpenDrawer={(tab) => {
          soundFX.playHudTick();
          if (tab === 'sessions') {
            setIsLeftDrawerOpen(true);
          } else {
            setActiveRightTab(tab);
          }
        }}
        activeDrawerTab={activeRightTab}
        remindersCount={reminders.filter((r) => r.status === 'pending').length}
        factsCount={facts.length}
        notesCount={notes.length}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onLogout={handleLogout}
        onOpenGmail={() => setIsGmailOpen(true)}
        isGmailOpen={isGmailOpen}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        isHandControlEnabled={isHandControlMode}
        onToggleHandControl={() => setIsHandControlMode((prev) => !prev)}
      />

      {/* Hand Control Overlay */}
      {isHandControlMode && (
        <HandControlMode 
          authToken={authToken} 
          onClose={() => setIsHandControlMode(false)} 
        />
      )}

      {/* Gmail Holographic Command Center HUD */}
      <GmailHUD
        isOpen={isGmailOpen}
        onClose={() => setIsGmailOpen(false)}
        onSendToast={addToast}
      />

      {/* Left Drawer (Past Sessions) */}
      <HudLeftDrawer
        isOpen={isLeftDrawerOpen}
        onClose={() => setIsLeftDrawerOpen(false)}
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={(id) => {
          soundFX.playHudTick();
          setCurrentConversationId(id);
          fetchMessages(id);
          setIsLeftDrawerOpen(false);
        }}
        onCreateConversation={handleCreateConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      {/* Right Drawer (Memory, Reminders, Notes, Jobs, Telemetry) */}
      <HudRightDrawer
        isOpen={activeRightTab !== null}
        activeTab={activeRightTab}
        onClose={() => setActiveRightTab(null)}
        onSelectTab={(tab) => {
          soundFX.playHudTick();
          setActiveRightTab(tab);
        }}
        facts={facts}
        reminders={reminders}
        notes={notes}
        jobs={jobs}
        toolLogs={toolLogs}
        selectedRunId={activeTaskRunId}
        onSelectRunId={(runId) => setActiveTaskRunId(runId)}
        onAddFact={handleAddFact}
        onToggleReminder={handleToggleReminder}
        onDeleteReminder={handleDeleteReminder}
        onAddReminder={handleAddReminder}
        onDeleteNote={handleDeleteNote}
        onAddNote={handleAddNote}
        onSearchJobs={handleSearchJobs}
      />

      {/* Center Stage: The Glorious Glowing Holographic Globe */}
      <main className="relative flex-1 w-full flex flex-col items-center justify-center p-2 sm:p-4 z-10">
        {/* First Meeting Protocol Banner if active */}
        {currentUser && !currentUser.has_completed_onboarding && (
          <div className="absolute top-2 z-20 flex items-center gap-3 px-3 py-1.5 rounded-full bg-[#020617]/90 border border-amber-400/50 shadow-[0_0_15px_rgba(251,191,36,0.2)] text-amber-300 text-xs mono">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span>THE FIRST MEETING IN PROGRESS</span>
            <button
              onClick={handleManualCompleteOnboarding}
              className="ml-2 px-2 py-0.5 rounded bg-amber-400/20 hover:bg-amber-400 text-amber-200 hover:text-slate-950 font-bold transition-all text-[10px]"
            >
              Complete Orientation
            </button>
          </div>
        )}

        <div className="w-full max-w-2xl h-[46vh] sm:h-[52vh] flex items-center justify-center relative">
          <OrionGlobe
            state={orionState}
            analyser={activeAnalyser}
            className="w-full h-full"
            onClick={handleToggleVoice}
            isTaskPulse={isSpherePulsing}
            isVoiceEnabled={isVoiceEnabled}
            isLiveConnected={isLiveConnected}
          />
        </div>

        {/* Real-time Holographic Subtitles & Transcript HUD */}
        <div className="w-full mt-2">
          <LiveTranscriptHUD
            orionState={orionState}
            userTranscript={userTranscript}
            orionTranscript={orionTranscript}
            messages={messages}
            isLoadingMessages={isLoadingMessages}
            latestActionNotice={latestActionNotice}
            detailsAvailable={detailsAvailable}
            taskRunId={activeTaskRunId}
            onViewDetails={handleViewDetails}
            activeActionLink={activeActionLink}
            activeBrowserTask={activeBrowserTask}
            activeActionResult={activeActionResult}
            onDismissActionLink={() => setActiveActionLink(null)}
            onDismissActionResult={() => setActiveActionResult(null)}
            onOpenViewport={(url, title) => {
              setViewportModalUrl(url);
              setViewportModalTitle(title);
            }}
            isVoiceEnabled={isVoiceEnabled}
            isListening={isListening}
            isLiveConnected={isLiveConnected}
          />
        </div>
      </main>

      {/* In-HUD Live Web Viewport Modal */}
      <InHudViewportModal
        isOpen={Boolean(viewportModalUrl)}
        url={viewportModalUrl}
        title={viewportModalTitle}
        onClose={() => {
          setViewportModalUrl(null);
          setViewportModalTitle(undefined);
        }}
      />

      {/* Bottom Voice & Text Command Interface */}
      <BottomControls
        orionState={orionState}
        isListening={isListening}
        isVoiceEnabled={isVoiceEnabled}
        onToggleVoice={handleToggleVoice}
        onSendText={handleSendText}
        onInterrupt={handleInterrupt}
      />
    </div>
  );
}

