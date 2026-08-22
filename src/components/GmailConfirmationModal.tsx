import React from 'react';
import { AlertTriangle, Send, Trash2, ShieldAlert, X } from 'lucide-react';
import { soundFX } from '../utils/audio';

export interface ConfirmationPayload {
  type: 'send_email' | 'trash_email' | 'delete_email' | 'batch_delete';
  title: string;
  description: string;
  target?: string;
  details?: Record<string, any>;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

interface GmailConfirmationModalProps {
  payload: ConfirmationPayload | null;
  onClose: () => void;
  isLoading?: boolean;
}

export const GmailConfirmationModal: React.FC<GmailConfirmationModalProps> = ({
  payload,
  onClose,
  isLoading = false,
}) => {
  if (!payload) return null;

  const isSend = payload.type === 'send_email';
  const isDelete = payload.type === 'delete_email' || payload.type === 'batch_delete' || payload.type === 'trash_email';

  const handleConfirm = async () => {
    soundFX.playHudTick();
    await payload.onConfirm();
    onClose();
  };

  const handleCancel = () => {
    soundFX.playHudTick();
    if (payload.onCancel) payload.onCancel();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#020617]/85 backdrop-blur-md animate-fade-in select-none">
      <div
        id="gmail-confirmation-modal"
        className={`relative w-full max-w-md bg-[#020617]/95 border rounded-lg p-6 sm:p-7 shadow-[0_0_40px_rgba(0,0,0,0.8)] flex flex-col gap-4 ${
          isSend
            ? 'border-cyan-400/40 shadow-[0_0_35px_rgba(34,211,238,0.2)]'
            : 'border-rose-500/50 shadow-[0_0_35px_rgba(244,63,94,0.25)]'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-sm border ${
                isSend
                  ? 'bg-cyan-400/10 border-cyan-400/30 text-cyan-400'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-400'
              }`}
            >
              {isSend ? <Send className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div>
              <h3
                className={`text-sm font-bold tracking-wider font-mono uppercase ${
                  isSend ? 'text-cyan-300' : 'text-rose-300'
                }`}
              >
                {payload.title}
              </h3>
              <p className="text-[10px] mono uppercase tracking-wider text-slate-400">
                Security Protocol Verification
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isLoading}
            className="p-1 rounded-sm bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Description */}
        <div className="flex flex-col gap-3 text-xs leading-relaxed text-slate-300 font-sans">
          <p>{payload.description}</p>

          {payload.details && (
            <div className="bg-slate-950/80 border border-slate-800 rounded p-3 text-[11px] mono flex flex-col gap-1.5">
              {payload.details.to && (
                <div className="flex items-start gap-2">
                  <span className="text-slate-500 w-16 shrink-0">Recipient:</span>
                  <span className="text-cyan-300 font-semibold truncate">{payload.details.to}</span>
                </div>
              )}
              {payload.details.subject && (
                <div className="flex items-start gap-2">
                  <span className="text-slate-500 w-16 shrink-0">Subject:</span>
                  <span className="text-slate-200 font-semibold">{payload.details.subject}</span>
                </div>
              )}
              {payload.details.preview && (
                <div className="flex flex-col gap-1 mt-1 pt-1 border-t border-slate-800/80 text-slate-400 italic line-clamp-3">
                  "{payload.details.preview}"
                </div>
              )}
              {payload.details.messageId && (
                <div className="flex items-start gap-2">
                  <span className="text-slate-500 w-16 shrink-0">Message ID:</span>
                  <span className="text-slate-400 truncate">{payload.details.messageId}</span>
                </div>
              )}
            </div>
          )}

          <div
            className={`p-2.5 rounded-sm border text-[11px] flex items-center gap-2 ${
              isSend
                ? 'bg-cyan-400/5 border-cyan-400/20 text-cyan-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>
              {isSend
                ? 'This transmission will be officially dispatched from your authorized Gmail account.'
                : 'This action will immediately modify your mailbox state in Google Workspace.'}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            id="btn-cancel-workspace-action"
            onClick={handleCancel}
            disabled={isLoading}
            className="py-2.5 px-4 rounded-sm bg-slate-900 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white font-mono text-xs uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50"
          >
            Abort / Cancel
          </button>

          <button
            type="button"
            id="btn-confirm-workspace-action"
            onClick={handleConfirm}
            disabled={isLoading}
            className={`py-2.5 px-4 rounded-sm font-mono text-xs uppercase tracking-wider font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
              isSend
                ? 'bg-cyan-400 text-slate-950 hover:bg-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.35)]'
                : 'bg-rose-500 text-white hover:bg-rose-600 shadow-[0_0_15px_rgba(244,63,94,0.35)]'
            }`}
          >
            {isLoading ? (
              <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                {isSend ? <Send className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{isSend ? 'Confirm & Send' : 'Confirm Action'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
