import React, { useState, useEffect } from 'react';
import {
  Volume2,
  VolumeX,
  Sparkles,
  User as UserIcon,
  LogOut,
  ShieldCheck,
  Mic,
  MicOff,
  Sun,
  Moon
} from 'lucide-react';
import { OrionState, User } from '../types';

interface HudHeaderProps {
  orionState: OrionState;
  currentUser: User | null;
  isLiveConnected: boolean;
  voiceMode: 'live_stream' | 'quick_turn';
  onToggleVoiceMode: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  isVoiceEnabled?: boolean;
  onEnableVoice?: () => void;
  onOpenDrawer?: (tab: 'sessions' | 'memory' | 'reminders' | 'notes' | 'jobs' | 'telemetry') => void;
  activeDrawerTab?: string | null;
  remindersCount?: number;
  factsCount?: number;
  notesCount?: number;
  onOpenAuth: () => void;
  onLogout: () => void;
  onOpenGmail?: () => void;
  isGmailOpen?: boolean;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  isHandControlEnabled?: boolean;
  onToggleHandControl?: () => void;
}

export const HudHeader: React.FC<HudHeaderProps> = ({
  orionState,
  currentUser,
  isLiveConnected,
  voiceMode,
  onToggleVoiceMode,
  isMuted,
  onToggleMute,
  isVoiceEnabled = false,
  onEnableVoice,
  onOpenAuth,
  onLogout,
  theme = 'dark',
  onToggleTheme,
  isHandControlEnabled = false,
  onToggleHandControl
}) => {
  const [utcTime, setUtcTime] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setUtcTime(
        now.toTimeString().split(' ')[0] + ' UTC'
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header
      id="hud-header"
      className="w-full border-b border-slate-800/60 dark:border-slate-800/60 light:border-slate-200 bg-[#0A0E17]/90 dark:bg-[#0A0E17]/90 light:bg-white/95 backdrop-blur-md px-4 sm:px-8 py-3 flex items-center justify-between z-30 select-none transition-all"
    >
      {/* Brand & Identity (Core Logo & Badge) */}
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
        </div>

        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="w-1 h-6 hud-line rounded-xs opacity-70" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold tracking-[0.18em] text-cyan-400 dark:text-cyan-400 light:text-cyan-600 font-display">
                ORION
              </h1>
              <span className="text-[9px] mono uppercase tracking-[0.2em] px-1.5 py-0.5 rounded-xs bg-slate-800/80 light:bg-slate-200 text-cyan-400 dark:text-cyan-400 light:text-cyan-700 border border-cyan-500/20">
                MK-VII
              </span>
              {currentUser && !currentUser.has_completed_onboarding && (
                <span className="text-[9px] mono uppercase tracking-[0.15em] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 animate-pulse flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  FIRST MEETING ACTIVE
                </span>
              )}
            </div>
            <p className="text-[9px] mono uppercase tracking-[0.25em] text-slate-400 dark:text-slate-400 light:text-slate-500 hidden sm:block">
              Cognitive Intelligence Unit // Jarvis Protocol
            </p>
          </div>
        </div>
      </div>

      {/* Middle Minimalist Telemetry Indicators */}
      <div className="hidden md:flex items-center gap-6 mono text-[11px] uppercase tracking-widest text-slate-400 dark:text-slate-400 light:text-slate-600">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              voiceMode === 'live_stream' && isLiveConnected
                ? 'bg-cyan-400 animate-pulse'
                : 'bg-slate-500'
            }`}
          />
          <span className="text-slate-300 dark:text-slate-300 light:text-slate-700 text-xs tracking-wider">
            {voiceMode === 'live_stream' ? 'Live Audio' : 'Fast Voice'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-slate-400 dark:text-slate-400 light:text-slate-500 text-[10px] tracking-widest">ONLINE</span>
        </div>

        <div className="text-cyan-400 dark:text-cyan-400 light:text-cyan-600 font-semibold tracking-widest text-[11px]">
          {utcTime || '00:00:00 UTC'}
        </div>
      </div>

      {/* Right Controls (Commander Profile, Audio & Theme) */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        {/* User Account / Commander Badge */}
        <div className="relative">
          {currentUser ? (
            <button
              id="btn-user-profile-menu"
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-slate-700/80 light:border-slate-300 bg-slate-900/60 light:bg-slate-100 hover:border-cyan-500/40 text-slate-200 light:text-slate-800 transition-all text-xs mono cursor-pointer"
            >
              <div className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-[10px] font-bold text-cyan-400">
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
              <span className="hidden sm:inline font-semibold max-w-[110px] truncate">
                {currentUser.name}
              </span>
            </button>
          ) : (
            <button
              id="btn-open-auth-header"
              onClick={onOpenAuth}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 light:text-cyan-600 transition-all text-xs mono uppercase tracking-wider font-semibold cursor-pointer"
            >
              <UserIcon className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
          )}

          {/* User Dropdown Menu */}
          {showUserMenu && currentUser && (
            <div
              id="user-dropdown-menu"
              className="absolute right-0 top-full mt-2 w-64 bg-[#0A0E17] dark:bg-[#0A0E17] light:bg-white border border-slate-800 light:border-slate-200 rounded-lg p-3 shadow-xl z-50 flex flex-col gap-2.5 backdrop-blur-md"
            >
              <div className="border-b border-slate-800 light:border-slate-200 pb-2">
                <div className="text-xs font-bold text-slate-100 light:text-slate-900">{currentUser.name}</div>
                <div className="text-[10px] text-slate-400 mono truncate">{currentUser.email}</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[10px] mono">
                  {currentUser.has_completed_onboarding ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> Fully Operational
                    </span>
                  ) : (
                    <span className="text-amber-400 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> In First Meeting
                    </span>
                  )}
                </div>
              </div>

              <button
                id="btn-menu-switch-user"
                onClick={() => {
                  setShowUserMenu(false);
                  onOpenAuth();
                }}
                className="w-full text-left px-2 py-1.5 text-xs text-slate-300 dark:text-slate-300 light:text-slate-700 hover:bg-slate-800/50 light:hover:bg-slate-100 rounded flex items-center gap-2 transition-all mono cursor-pointer"
              >
                <UserIcon className="w-3.5 h-3.5 text-cyan-400" />
                <span>Switch / New Account</span>
              </button>

              <button
                id="btn-menu-logout"
                onClick={() => {
                  setShowUserMenu(false);
                  onLogout();
                }}
                className="w-full text-left px-2 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10 rounded flex items-center gap-2 transition-all mono cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-400" />
                <span>Log Out</span>
              </button>
            </div>
          )}
        </div>

        {/* Voice Mode Toggle */}
        <button
          id="btn-voice-mode-toggle"
          onClick={onToggleVoiceMode}
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded border border-slate-700/80 light:border-slate-300 bg-slate-900/60 light:bg-slate-100 hover:border-cyan-500/40 text-slate-200 light:text-slate-800 text-xs mono uppercase tracking-wider transition-all cursor-pointer"
          title={`Switch Voice Mode (${voiceMode === 'live_stream' ? 'Bidirectional Live Audio' : 'Fast Turn Voice'})`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              voiceMode === 'live_stream' ? 'bg-cyan-400 animate-pulse' : 'bg-slate-500'
            }`}
          />
          <span className="hidden sm:inline">
            {voiceMode === 'live_stream' ? 'LIVE AUDIO' : 'FAST TURN'}
          </span>
        </button>

        {/* Audio Mute */}
        <button
          id="btn-audio-mute"
          onClick={onToggleMute}
          className={`p-2 rounded border transition-all text-xs cursor-pointer ${
            isMuted
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              : 'bg-slate-900/60 light:bg-slate-100 border-slate-700/80 light:border-slate-300 text-slate-300 light:text-slate-700 hover:border-cyan-500/40'
          }`}
          title={isMuted ? 'Unmute Audio Output' : 'Mute Audio Output'}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        {/* Dark / Light Theme Toggle Button */}
        {onToggleTheme && (
          <button
            id="btn-theme-toggle"
            onClick={onToggleTheme}
            className="p-2 rounded border border-slate-700/80 light:border-slate-300 bg-slate-900/60 light:bg-slate-100 hover:border-cyan-500/40 text-slate-300 light:text-slate-700 transition-all text-xs cursor-pointer hidden sm:block"
            title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-cyan-600" />}
          </button>
        )}

        {/* Hand Control Toggle */}
        {onToggleHandControl && (
          <button
            id="btn-hand-control-toggle"
            onClick={onToggleHandControl}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded border transition-all text-xs mono uppercase tracking-wider cursor-pointer ${
              isHandControlEnabled
                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                : 'bg-slate-900/60 light:bg-slate-100 border-slate-700/80 light:border-slate-300 text-slate-300 light:text-slate-700 hover:border-cyan-500/40'
            }`}
            title={isHandControlEnabled ? 'Disable Hand Control (Camera)' : 'Enable Hand Control 3D Interactivity'}
          >
            <span className="hidden sm:inline">HAND CTRL</span>
            <span className={`w-1.5 h-1.5 rounded-full ${isHandControlEnabled ? 'bg-cyan-400 animate-pulse' : 'bg-slate-500'}`} />
          </button>
        )}
      </div>
    </header>
  );
};


