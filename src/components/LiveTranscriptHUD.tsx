import React, { useEffect, useRef } from 'react';
import { Radio, User, Sparkles, ExternalLink, FileCode, CheckCircle2, Globe, Cpu, ArrowUpRight, ShieldCheck, Lock, Wifi, Mic, Clock } from 'lucide-react';
import { OrionState, Message } from '../types';
import { ActionResultCard, ActionResultData } from './ActionResultCard';

export interface ActionLinkItem {
  url: string;
  targetName: string;
  timestamp: string;
}

export interface BrowserTaskItem {
  runId: string;
  platform: string;
  action_type?: string;
  steps: string[];
  executed_steps?: any[];
  extracted_title?: string;
  extracted_content?: string;
  final_url?: string;
}

interface LiveTranscriptHUDProps {
  orionState: OrionState;
  userTranscript: string;
  orionTranscript: string;
  messages?: Message[];
  isLoadingMessages?: boolean;
  latestActionNotice?: string | null;
  detailsAvailable?: boolean;
  taskRunId?: string | null;
  onViewDetails?: (runId?: string | null) => void;
  activeActionLink?: ActionLinkItem | null;
  activeBrowserTask?: BrowserTaskItem | null;
  activeActionResult?: ActionResultData | null;
  onDismissActionLink?: () => void;
  onDismissActionResult?: () => void;
  onOpenViewport?: (url: string, title?: string) => void;
  isVoiceEnabled?: boolean;
  isListening?: boolean;
  isLiveConnected?: boolean;
}

const formatTimestamp = (ts: string) => {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

export const LiveTranscriptHUD: React.FC<LiveTranscriptHUDProps> = ({
  orionState,
  userTranscript,
  orionTranscript,
  messages = [],
  isLoadingMessages = false,
  latestActionNotice,
  detailsAvailable,
  taskRunId,
  onViewDetails,
  activeActionLink,
  activeBrowserTask,
  activeActionResult,
  onDismissActionLink,
  onDismissActionResult,
  onOpenViewport,
  isVoiceEnabled = false,
  isListening = false,
  isLiveConnected = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const hasUserText = Boolean(userTranscript.trim());
  const hasOrionText = Boolean(orionTranscript.trim());
  const hasHistory = Array.isArray(messages) && messages.length > 0;

  // Auto-scroll to bottom whenever messages or live streams update
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, userTranscript, orionTranscript, activeBrowserTask, activeActionResult, orionState]);

  // If nothing to show and system is idle
  if (!hasHistory && !hasUserText && !hasOrionText && !latestActionNotice && !activeActionLink && !activeBrowserTask && !activeActionResult && !isLoadingMessages && orionState === 'idle') {
    return null;
  }

  // Check if live transcripts are redundant with the latest historical message
  const lastMessage = hasHistory ? messages[messages.length - 1] : null;
  const isLiveUserRedundant = Boolean(lastMessage && lastMessage.sender === 'user' && lastMessage.text.trim() === userTranscript.trim());
  const isLiveOrionRedundant = Boolean(lastMessage && lastMessage.sender === 'orion' && lastMessage.text.trim() === orionTranscript.trim());

  return (
    <div
      id="live-transcript-hud"
      className="w-full max-w-2xl mx-auto px-4 transition-all duration-300 pointer-events-auto"
    >
      <div 
        ref={containerRef}
        className="relative p-4 rounded-sm bg-[#020617]/90 backdrop-blur-xl border border-cyan-400/20 shadow-[0_0_30px_rgba(0,0,0,0.8)] space-y-3 max-h-[38vh] sm:max-h-[44vh] overflow-y-auto pr-2 scroll-smooth"
      >
        {/* Holographic HUD Top Corner Accent lines */}
        <div className="absolute top-0 left-0 w-6 h-[1.5px] bg-cyan-400" />
        <div className="absolute top-0 right-0 w-6 h-[1.5px] bg-cyan-400" />
        <div className="absolute bottom-0 left-0 w-6 h-[1.5px] bg-cyan-400" />
        <div className="absolute bottom-0 right-0 w-6 h-[1.5px] bg-cyan-400" />

        {/* Loading Indicator for Message History Sync */}
        {isLoadingMessages && (
          <div className="flex items-center justify-between px-3 py-1.5 rounded-sm bg-cyan-950/40 border border-cyan-400/20 text-[10px] mono uppercase tracking-wider text-cyan-300 animate-pulse">
            <div className="flex items-center gap-2">
              <Cpu className="w-3 h-3 text-cyan-400 animate-spin" />
              <span>SYNCHRONIZING CONVERSATION ARCHIVES...</span>
            </div>
            <Clock className="w-3 h-3 text-cyan-400/60" />
          </div>
        )}

        {/* Live Action Notice Badge */}
        {latestActionNotice && (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/40 border border-cyan-400/30 text-[10px] mono uppercase tracking-wider text-cyan-300 backdrop-blur-sm transition-all">
            <Sparkles className="w-3 h-3 text-cyan-400 shrink-0 animate-pulse" />
            <span className="truncate max-w-md">{latestActionNotice}</span>
            {onViewDetails && (
              <button
                onClick={() => onViewDetails(taskRunId)}
                className="ml-auto text-[9px] text-cyan-300 hover:text-cyan-100 flex items-center gap-1 underline underline-offset-2 shrink-0"
              >
                <span>Telemetry</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        )}

        {/* Interactive In-HUD Launch Banner for Links/Viewports (Popup-Proof) */}
        {activeActionLink && (
          <div className="p-3 rounded-sm bg-cyan-950/60 border border-cyan-400/40 flex items-center justify-between gap-3 shadow-[0_0_15px_rgba(34,211,238,0.15)] animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-xs bg-cyan-400/20 text-cyan-300 shrink-0">
                <Globe className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] mono text-cyan-400 uppercase tracking-wider font-semibold">
                  EXTERNAL VIEWPORT READY
                </div>
                <div className="text-xs text-cyan-100 font-sans font-medium truncate max-w-sm">
                  {activeActionLink.targetName || activeActionLink.url}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onOpenViewport && (
                <button
                  onClick={() => onOpenViewport(activeActionLink.url, activeActionLink.targetName)}
                  className="px-2.5 py-1.5 rounded-sm bg-cyan-950 hover:bg-cyan-900 border border-cyan-400/40 text-cyan-200 text-xs mono transition-all"
                >
                  Inspect
                </button>
              )}
              <a
                id="btn-launch-target-viewport"
                href={activeActionLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-sm bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold text-xs mono flex items-center gap-1.5 transition-all shadow-[0_0_12px_rgba(34,211,238,0.4)]"
              >
                <span>Launch Portal</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
              {onDismissActionLink && (
                <button
                  onClick={onDismissActionLink}
                  className="text-slate-400 hover:text-slate-200 text-xs px-1.5 py-1"
                  title="Dismiss launcher"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}

        {/* Dedicated Live Action Result Card */}
        {activeActionResult && (
          <ActionResultCard
            result={activeActionResult}
            onOpenViewport={onOpenViewport}
            onViewTelemetry={onViewDetails}
            onDismiss={onDismissActionResult}
          />
        )}

        {/* Interactive Active Browser Task Step Tracker */}
        {activeBrowserTask && activeBrowserTask.steps && activeBrowserTask.steps.length > 0 && !activeActionResult && (
          <div className="p-3 rounded-sm bg-slate-900/80 border border-cyan-400/30 space-y-2">
            <div className="flex items-center justify-between text-xs mono">
              <span className="text-cyan-300 font-bold flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                AUTOMATION PIPELINE: {activeBrowserTask.platform.toUpperCase()}
              </span>
              <span className="text-[10px] text-cyan-400/70">
                {activeBrowserTask.steps.length} STEPS
              </span>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {activeBrowserTask.steps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-slate-200 mono">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="leading-snug">{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Persistent Historical Messages Stream */}
        {hasHistory && (
          <div className="space-y-3">
            {messages.map((m) => {
              if (m.sender === 'user') {
                return (
                  <div key={m.id} className="flex items-start gap-2.5 text-slate-300 text-xs sm:text-sm mono border-b border-cyan-400/10 pb-2.5">
                    <div className="flex items-center gap-1.5 text-slate-400 shrink-0 font-bold text-[10px] uppercase tracking-wider">
                      <User className="w-3.5 h-3.5 text-cyan-400" />
                      <span>COMMANDER:</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-200 italic leading-relaxed break-words">
                        "{m.text}"
                      </p>
                      {m.timestamp && (
                        <span className="text-[9px] text-slate-500 mono block mt-0.5">
                          {formatTimestamp(m.timestamp)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              }

              // ORION message
              return (
                <div key={m.id} className="space-y-2 border-b border-cyan-400/10 pb-2.5 last:border-b-0">
                  <div className="flex items-start gap-2.5 text-cyan-100 text-xs sm:text-sm leading-relaxed">
                    <div className="flex items-center gap-1.5 text-cyan-400 shrink-0 font-bold mono text-[10px] uppercase tracking-wider">
                      <Radio className="w-3.5 h-3.5" />
                      <span>ORION:</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-sans font-medium text-cyan-50 text-glow-cyan text-sm sm:text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                        {m.text}
                      </p>
                      {m.timestamp && (
                        <span className="text-[9px] text-cyan-500/70 mono block mt-1">
                          {formatTimestamp(m.timestamp)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Message-specific View Details Action Link if telemetry is available */}
                  {m.details_available && onViewDetails && (
                    <div className="pt-1 flex items-center justify-end">
                      <button
                        onClick={() => onViewDetails(m.task_run_id)}
                        className="px-2.5 py-1 rounded-sm bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/30 text-cyan-300 hover:text-cyan-100 text-[10px] mono uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-[0_0_10px_rgba(34,211,238,0.1)]"
                      >
                        <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                        <span>View Details & Task Step Logs</span>
                        <ExternalLink className="w-2.5 h-2.5 ml-0.5 text-cyan-400" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* In-Flight Live Spoken User Input */}
        {hasUserText && !isLiveUserRedundant && (
          <div className="flex items-start gap-2.5 text-slate-300 text-xs sm:text-sm mono border-b border-cyan-400/10 pb-2 animate-in fade-in duration-150">
            <div className="flex items-center gap-1.5 text-amber-300 shrink-0 font-bold text-[10px] uppercase tracking-wider">
              <User className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>COMMANDER [LIVE]:</span>
            </div>
            <p className="text-slate-200 italic leading-relaxed break-words">
              "{userTranscript}"
            </p>
          </div>
        )}

        {/* In-Flight Live Orion Response Output */}
        {hasOrionText && !isLiveOrionRedundant && (
          <div className="space-y-2 animate-in fade-in duration-150">
            <div className="flex items-start gap-2.5 text-cyan-100 text-xs sm:text-sm leading-relaxed">
              <div className="flex items-center gap-1.5 text-cyan-400 shrink-0 font-bold mono text-[10px] uppercase tracking-wider">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                <span>ORION [LIVE]:</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-sans font-medium text-cyan-50 text-glow-cyan text-sm sm:text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                  {orionTranscript}
                </p>
              </div>
            </div>

            {/* View Details Action Link if task run logs are available */}
            {detailsAvailable && onViewDetails && (
              <div className="pt-1 flex items-center justify-end">
                <button
                  id="btn-hud-view-details"
                  onClick={() => onViewDetails(taskRunId)}
                  className="px-2.5 py-1 rounded-sm bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/30 text-cyan-300 hover:text-cyan-100 text-[11px] mono uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-[0_0_10px_rgba(34,211,238,0.1)]"
                >
                  <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                  <span>View Details & Task Step Logs</span>
                  <ExternalLink className="w-3 h-3 ml-0.5 text-cyan-400" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Thinking Indicator */}
        {orionState === 'thinking' && !hasOrionText && (
          <div className="flex items-center gap-2 text-cyan-400 mono text-xs uppercase tracking-wider animate-pulse py-1">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            <span>ORION SYNTHESIZING NEURAL RESPONSE...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
};

