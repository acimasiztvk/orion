import React, { useState } from 'react';
import { Mic, MicOff, Send, Sparkles, Compass, Globe, Bell, FileText, Briefcase } from 'lucide-react';
import { OrionState } from '../types';

interface BottomControlsProps {
  orionState: OrionState;
  isListening: boolean;
  isVoiceEnabled?: boolean;
  onToggleVoice: () => void;
  onSendText: (text: string) => void;
  onInterrupt: () => void;
  disabled?: boolean;
}

export const BottomControls: React.FC<BottomControlsProps> = ({
  orionState,
  isListening,
  isVoiceEnabled = false,
  onToggleVoice,
  onSendText,
  onInterrupt,
  disabled = false,
}) => {
  const [inputText, setInputText] = useState('');
  const [showQuickChips, setShowQuickChips] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || disabled) return;
    onSendText(inputText.trim());
    setInputText('');
  };

  const quickPrompts = [
    {
      label: "Remember Profile",
      icon: Sparkles,
      text: "Remember that I'm building an autonomous AI robotics system in San Francisco."
    },
    {
      label: "Schedule Task",
      icon: Bell,
      text: "Remind me tomorrow at 9:00 AM to review the quantum neural telemetry logs."
    },
    {
      label: "Archive Note",
      icon: FileText,
      text: "Save a note under Architecture: Sub-50ms bidirectional audio requires WebSockets with raw PCM 16kHz/24kHz."
    },
    {
      label: "Search Jobs",
      icon: Briefcase,
      text: "Search for high-paying AI Engineer and Multimodal LLM positions."
    },
    {
      label: "Open YouTube",
      icon: Globe,
      text: "Open YouTube in a new tab."
    },
    {
      label: "Web Search",
      icon: Compass,
      text: "Who designed the original JARVIS AI in Marvel lore, and what does the acronym stand for?"
    }
  ];

  return (
    <footer
      id="bottom-controls"
      className="w-full max-w-3xl mx-auto px-6 pb-6 pt-2 z-30 flex flex-col items-center gap-3 select-none"
    >
      {/* Quick Suggestion Chips (Togglable) */}
      {showQuickChips && (
        <div className="w-full flex flex-wrap items-center justify-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {quickPrompts.map((q, idx) => {
            const Icon = q.icon;
            return (
              <button
                key={idx}
                onClick={() => {
                  onSendText(q.text);
                  setShowQuickChips(false);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 light:bg-slate-100 border border-slate-700/60 light:border-slate-300 hover:border-cyan-500/40 text-[11px] mono uppercase tracking-wider text-slate-300 light:text-slate-700 hover:text-cyan-400 transition-all cursor-pointer"
              >
                <Icon className="w-3 h-3 text-cyan-400" />
                <span>{q.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Interactive Controls Bar */}
      <div className="w-full relative">
        <div className="relative flex items-center bg-[#0D121F]/90 dark:bg-[#0D121F]/90 light:bg-white border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 px-3 sm:px-4 py-2.5 rounded-xl shadow-lg gap-2">
          {/* Quick Chips Toggle Button */}
          <button
            id="btn-toggle-chips"
            type="button"
            onClick={() => setShowQuickChips(!showQuickChips)}
            className={`p-2 rounded-lg border transition-all shrink-0 cursor-pointer ${
              showQuickChips
                ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400'
                : 'bg-slate-800/40 light:bg-slate-100 border-slate-700/60 light:border-slate-300 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/30'
            }`}
            title="Toggle Quick Voice Scenarios"
          >
            <Sparkles className="w-4 h-4 text-cyan-400" />
          </button>

          {/* Text Input Form */}
          <form onSubmit={handleSubmit} className="flex-1 flex items-center min-w-0">
            <input
              id="text-input-field"
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={disabled}
              placeholder={
                isListening
                  ? "LISTENING TO VOICE STREAM..."
                  : "TRANSMIT MANUAL COMMAND OR SPEAK..."
              }
              className="bg-transparent border-none outline-none flex-grow text-slate-100 dark:text-slate-100 light:text-slate-800 placeholder-slate-500 mono text-xs sm:text-sm uppercase tracking-wider min-w-0"
            />
            {inputText.trim() && (
              <button
                id="btn-send-text"
                type="submit"
                disabled={disabled}
                className="p-2 ml-1 rounded-lg text-cyan-400 hover:bg-cyan-500/10 transition-all shrink-0 cursor-pointer"
                title="Transmit Manual Command"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </form>

          {/* Master Voice Activation Button */}
          <button
            id="btn-master-voice"
            type="button"
            onClick={() => {
              if (orionState === 'speaking') {
                onInterrupt();
              } else {
                onToggleVoice();
              }
            }}
            className={`px-3 py-2 sm:px-3 sm:py-2 rounded-lg border transition-all flex items-center justify-center gap-1.5 shrink-0 cursor-pointer ${
              isListening
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.25)] animate-pulse'
                : orionState === 'speaking'
                ? 'bg-rose-500/20 border-rose-400 text-rose-300'
                : isVoiceEnabled
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25'
                : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/30'
            }`}
            title={
              orionState === 'speaking'
                ? 'Interrupt Speech (Barge-in)'
                : isListening
                ? 'Close Live Stream (Return to local standby)'
                : isVoiceEnabled
                ? 'Local Standby Active (Click to turn off voice)'
                : 'Enable Local Wake Word Detector'
            }
          >
            {isListening ? (
              <>
                <Mic className="w-4 h-4 text-cyan-300 animate-pulse" />
                <span className="text-[10px] mono font-bold text-cyan-300 hidden sm:inline uppercase">LIVE AUDIO</span>
              </>
            ) : orionState === 'speaking' ? (
              <>
                <MicOff className="w-4 h-4 text-rose-300" />
                <span className="text-[10px] mono font-bold text-rose-300 hidden sm:inline uppercase">MUTE</span>
              </>
            ) : isVoiceEnabled ? (
              <>
                <Mic className="w-4 h-4 text-emerald-400" />
                <span className="text-[10px] mono font-bold text-emerald-400 hidden sm:inline uppercase">STANDBY</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 text-slate-400" />
                <span className="text-[10px] mono font-bold text-slate-400 hidden sm:inline uppercase">ENABLE VOICE</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Terminal Session ID Footnote */}
      <div className="text-[9px] mono uppercase tracking-[0.3em] opacity-50 text-slate-400 dark:text-slate-400 light:text-slate-500 text-center">
        Secure Terminal Session // User ID: STARK_PROT_01 // MK-VII Core
      </div>
    </footer>
  );
};
