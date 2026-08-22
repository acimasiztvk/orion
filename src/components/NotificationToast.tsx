import React from 'react';
import { Sparkles, CheckCircle2, Bell, FileText, Briefcase, ExternalLink, Globe, Cpu, PhoneCall, AlertCircle, Bot, Send } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: string;
  title: string;
  description: string;
  url?: string;
}

interface NotificationToastProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
      {toasts.map((toast) => {
        let Icon = Sparkles;
        let borderColor = 'border-cyan-500/40';
        let bgGlow = 'shadow-[0_0_15px_rgba(0,240,255,0.2)]';

        if (toast.type === 'PROFILE_UPDATED') {
          Icon = CheckCircle2;
          borderColor = 'border-cyan-400';
        } else if (toast.type === 'REMINDER_SAVED') {
          Icon = Bell;
          borderColor = 'border-amber-400';
          bgGlow = 'shadow-[0_0_15px_rgba(245,158,11,0.2)]';
        } else if (toast.type === 'NOTE_SAVED') {
          Icon = FileText;
          borderColor = 'border-sky-400';
        } else if (toast.type === 'JOBS_FOUND') {
          Icon = Briefcase;
          borderColor = 'border-emerald-400';
          bgGlow = 'shadow-[0_0_15px_rgba(16,185,129,0.2)]';
        } else if (toast.type === 'OPEN_LINK') {
          Icon = ExternalLink;
          borderColor = 'border-blue-400';
        } else if (toast.type === 'WEB_SEARCH_DONE') {
          Icon = Globe;
          borderColor = 'border-indigo-400';
        } else if (toast.type === 'BROWSER_TASK_DISPATCHED') {
          Icon = Cpu;
          borderColor = 'border-cyan-400';
          bgGlow = 'shadow-[0_0_15px_rgba(34,211,238,0.3)]';
        } else if (toast.type === 'NOTIFICATION_DISPATCHED') {
          Icon = Send;
          borderColor = 'border-emerald-400';
          bgGlow = 'shadow-[0_0_15px_rgba(16,185,129,0.3)]';
        } else if (toast.type === 'PHONE_CALL_INITIATED') {
          Icon = PhoneCall;
          borderColor = 'border-emerald-400';
          bgGlow = 'shadow-[0_0_15px_rgba(16,185,129,0.3)]';
        } else if (
          toast.type === 'PHONE_CALL_SETUP_REQUIRED' ||
          toast.type === 'CLAUDE_SETUP_REQUIRED' ||
          toast.type === 'CLAUDE_AUTH_FAILED' ||
          toast.type === 'CLAUDE_CREDITS_LOW' ||
          toast.type === 'PHONE_CALL_FAILED' ||
          toast.type === 'NOTIFICATION_FAILED'
        ) {
          Icon = AlertCircle;
          borderColor = 'border-amber-500';
          bgGlow = 'shadow-[0_0_15px_rgba(245,158,11,0.3)]';
        } else if (toast.type === 'CLAUDE_DELEGATED' || toast.type === 'CLAUDE_FALLBACK_COMPLETED') {
          Icon = Bot;
          borderColor = 'border-purple-400';
          bgGlow = 'shadow-[0_0_15px_rgba(168,85,247,0.3)]';
        }

        return (
          <div
            key={toast.id}
            onClick={() => {
              if (toast.url) {
                window.open(toast.url, '_blank', 'noopener,noreferrer');
              }
              onDismiss(toast.id);
            }}
            className={`pointer-events-auto cursor-pointer px-3 py-2 rounded-lg bg-slate-950/85 backdrop-blur-md border ${borderColor}/50 ${bgGlow} flex items-center gap-2.5 transition-all animate-in slide-in-from-top-2 duration-300 group hover:bg-slate-900/90`}
          >
            <div className="p-1 rounded bg-cyan-400/10 text-cyan-300 shrink-0">
              <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0 mono">
              <div className="flex items-center justify-between gap-2">
                <h5 className="text-[11px] font-bold text-cyan-100 uppercase tracking-wider truncate">
                  {toast.title}
                </h5>
                {toast.url && (
                  <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1 py-0.2 rounded border border-cyan-400/30 flex items-center gap-0.5 group-hover:bg-cyan-500/40 shrink-0">
                    Open ↗
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-300 mt-0.5 truncate">
                {toast.description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
