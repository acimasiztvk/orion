import React from 'react';
import { X, Plus, Trash2, MessageSquare, Clock } from 'lucide-react';
import { Conversation } from '../types';

interface HudLeftDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  currentConversationId: string;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (id: string) => void;
}

export const HudLeftDrawer: React.FC<HudLeftDrawerProps> = ({
  isOpen,
  onClose,
  conversations,
  currentConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
}) => {
  if (!isOpen) return null;

  return (
    <aside
      id="hud-left-drawer"
      className="fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-[#020617]/95 border-r border-cyan-400/20 backdrop-blur-xl z-40 flex flex-col shadow-[10px_0_30px_rgba(0,0,0,0.8)] transition-transform duration-300 animate-in slide-in-from-left"
    >
      {/* Header */}
      <div className="p-4 border-b border-cyan-400/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 hud-line rounded-xs" />
          <h2 className="text-xs mono font-bold tracking-[0.2em] text-cyan-400 uppercase">
            RECENT ARCHIVES
          </h2>
        </div>
        <button
          id="btn-close-sessions"
          onClick={onClose}
          className="p-1 rounded-sm text-slate-400 hover:text-cyan-300 hover:bg-cyan-400/10"
          title="Close Drawer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* New Session Button */}
      <div className="p-3 border-b border-cyan-400/10">
        <button
          id="btn-new-session"
          onClick={onCreateConversation}
          className="w-full py-2 px-3 rounded-sm bg-cyan-400/5 hover:bg-cyan-400/15 border border-cyan-400/20 hover:border-cyan-400 text-cyan-300 flex items-center justify-center gap-2 text-xs mono tracking-wider transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>INITIALIZE NEW SESSION</span>
        </button>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {conversations.length === 0 ? (
          <div className="p-4 text-center text-xs mono text-slate-500">
            NO SESSIONS ARCHIVED
          </div>
        ) : (
          conversations.map((conv) => {
            const isSelected = conv.id === currentConversationId;
            return (
              <div
                key={conv.id}
                id={`session-item-${conv.id}`}
                className={`group p-3 rounded-sm border transition-all flex items-start justify-between gap-2 cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-400/10 border-cyan-400 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                    : 'bg-cyan-400/5 border-cyan-400/10 text-slate-300 hover:border-cyan-400/30 hover:bg-cyan-400/10'
                }`}
                onClick={() => onSelectConversation(conv.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <MessageSquare
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isSelected ? 'text-cyan-400' : 'text-slate-500'
                      }`}
                    />
                    <h4 className="text-xs font-light leading-relaxed truncate">{conv.title}</h4>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] mono text-slate-500">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(conv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>

                <button
                  id={`btn-delete-session-${conv.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(conv.id);
                  }}
                  className="opacity-60 group-hover:opacity-100 p-1.5 rounded-sm text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-opacity"
                  title="Purge Session Log"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-cyan-400/20 bg-slate-950 text-[10px] mono uppercase tracking-wider text-cyan-400/60 flex items-center justify-between">
        <span>ENCRYPTION: AES-256</span>
        <span>STATUS: SECURE</span>
      </div>
    </aside>
  );
};
