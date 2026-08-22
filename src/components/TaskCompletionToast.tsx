import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Bell,
  PhoneCall,
  ExternalLink,
  Sparkles,
  ShieldCheck,
  Briefcase,
  Database,
  Layers,
  X
} from 'lucide-react';
import { soundFX } from '../utils/audio';

export type TaskCompletionCategory =
  | 'subscription'
  | 'reminder'
  | 'call'
  | 'browser'
  | 'insight'
  | 'jobs'
  | 'note'
  | 'memory'
  | 'default';

export interface TaskCompletionEvent {
  id: string;
  category: TaskCompletionCategory;
  title: string;
  detail?: string;
  timestamp?: number;
}

interface TaskCompletionToastProps {
  events: TaskCompletionEvent[];
  onDismiss: (id: string) => void;
  onClearAll?: () => void;
  onTriggerSpherePulse?: () => void;
  isMuted?: boolean;
}

/**
 * Returns line-style Lucide icon and color scheme based on task category
 */
function getCategoryMeta(category: TaskCompletionCategory) {
  switch (category) {
    case 'subscription':
      return {
        Icon: ShieldCheck,
        badgeText: 'SUBSCRIPTION / BILLING',
        glowColor: 'shadow-emerald-500/20 border-emerald-500/40 text-emerald-400'
      };
    case 'reminder':
      return {
        Icon: Bell,
        badgeText: 'SCHEDULED REMINDER',
        glowColor: 'shadow-amber-500/20 border-amber-500/40 text-amber-400'
      };
    case 'call':
      return {
        Icon: PhoneCall,
        badgeText: 'COMMUNICATION DISPATCH',
        glowColor: 'shadow-cyan-500/20 border-cyan-500/40 text-cyan-400'
      };
    case 'browser':
      return {
        Icon: ExternalLink,
        badgeText: 'WEB AUTOMATION',
        glowColor: 'shadow-blue-500/20 border-blue-500/40 text-blue-400'
      };
    case 'insight':
      return {
        Icon: Sparkles,
        badgeText: 'NEURAL SYNTHESIS',
        glowColor: 'shadow-purple-500/20 border-purple-500/40 text-purple-400'
      };
    case 'jobs':
      return {
        Icon: Briefcase,
        badgeText: 'JOB RADAR',
        glowColor: 'shadow-teal-500/20 border-teal-500/40 text-teal-400'
      };
    case 'note':
    case 'memory':
      return {
        Icon: Database,
        badgeText: 'MEMORY ARCHIVED',
        glowColor: 'shadow-cyan-500/20 border-cyan-500/40 text-cyan-300'
      };
    case 'default':
    default:
      return {
        Icon: CheckCircle2,
        badgeText: 'TASK COMPLETED',
        glowColor: 'shadow-emerald-500/20 border-emerald-500/40 text-emerald-400'
      };
  }
}

export const TaskCompletionToast: React.FC<TaskCompletionToastProps> = ({
  events,
  onDismiss,
  onClearAll,
  onTriggerSpherePulse,
  isMuted = false
}) => {
  const [isGroupExpanded, setIsGroupExpanded] = useState(false);

  useEffect(() => {
    if (events.length > 0) {
      const latest = events[events.length - 1];
      if (!isMuted) {
        soundFX.playTaskChime();
      }
      if (onTriggerSpherePulse) {
        onTriggerSpherePulse();
      }
    }
  }, [events.length, isMuted]);

  if (events.length === 0) return null;

  // Group toasts if more than 3 tasks are triggered rapidly
  const isHighVolume = events.length > 3;
  const visibleEvents = isHighVolume ? events.slice(-2) : events.slice(-2); // Max 2 visible at a time

  return (
    <div className="fixed top-20 right-6 z-50 pointer-events-none flex flex-col items-end gap-2.5 max-w-sm w-full">
      <AnimatePresence>
        {isHighVolume && !isGroupExpanded ? (
          <motion.div
            key="grouped-summary-toast"
            initial={{ opacity: 0, scale: 0.88, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            onClick={() => setIsGroupExpanded(true)}
            className="pointer-events-auto cursor-pointer group w-full"
          >
            <div className="p-3.5 rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-cyan-400/50 shadow-2xl flex items-center justify-between gap-3 group-hover:border-cyan-400 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-cyan-500/20 border border-cyan-400/30 text-cyan-300">
                  <Layers className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                    <span>{events.length} Tasks Executed</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                  </div>
                  <p className="text-[11px] text-slate-400 truncate max-w-[180px]">
                    Latest: {events[events.length - 1].title}
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-cyan-300 px-2.5 py-1 rounded bg-cyan-500/10 border border-cyan-400/30">
                VIEW ALL
              </span>
            </div>
          </motion.div>
        ) : (
          visibleEvents.map((event) => {
            const { Icon, badgeText, glowColor } = getCategoryMeta(event.category);
            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, scale: 0.88, y: -20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: -12 }}
                transition={{
                  type: 'spring',
                  stiffness: 420,
                  damping: 28,
                  mass: 0.8
                }}
                onClick={() => onDismiss(event.id)}
                className="pointer-events-auto cursor-pointer group w-full"
              >
                <div
                  className={`flex items-center gap-3.5 px-4 py-3 rounded-2xl bg-slate-950/85 backdrop-blur-xl border shadow-xl transition-all ${glowColor}`}
                >
                  <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-slate-900/80 border border-white/10 shrink-0">
                    <Icon className="w-5 h-5 stroke-[1.75]" />
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0.8 }}
                      animate={{ scale: 1.4, opacity: 0 }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className="absolute inset-0 rounded-xl border border-current opacity-30 pointer-events-none"
                    />
                  </div>

                  <div className="flex flex-col pr-1 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[9px] font-semibold tracking-wider uppercase opacity-80 font-mono">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {badgeText}
                    </div>
                    <div className="text-xs font-medium text-slate-100 tracking-tight leading-snug font-sans truncate">
                      {event.title}
                    </div>
                    {event.detail && (
                      <div className="text-[11px] text-slate-400 truncate max-w-[220px]">
                        {event.detail}
                      </div>
                    )}
                  </div>

                  <div className="ml-1 w-5 h-5 rounded-full border border-emerald-400/40 flex items-center justify-center shrink-0 bg-emerald-400/10">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 stroke-[2]" />
                  </div>
                </div>
              </motion.div>
            );
          })
        )}

        {isGroupExpanded && (
          <motion.div
            key="expanded-toast-list"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="pointer-events-auto w-full p-3 rounded-2xl bg-slate-950/95 backdrop-blur-2xl border border-cyan-400/40 shadow-2xl flex flex-col gap-2"
          >
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
              <span className="text-xs font-bold font-mono text-cyan-300">
                TASK LOG QUEUE ({events.length})
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsGroupExpanded(false);
                  if (onClearAll) onClearAll();
                }}
                className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-52 overflow-y-auto flex flex-col gap-1.5 pr-1">
              {events.map((e) => {
                const { Icon } = getCategoryMeta(e.category);
                return (
                  <div
                    key={e.id}
                    className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon className="w-4 h-4 text-cyan-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-200 truncate">{e.title}</div>
                        {e.detail && <div className="text-[10px] text-slate-400 truncate">{e.detail}</div>}
                      </div>
                    </div>
                    <button
                      onClick={() => onDismiss(e.id)}
                      className="text-slate-500 hover:text-rose-400 text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800"
                    >
                      DISMISS
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

