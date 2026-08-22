import React, { useState } from 'react';
import { Globe, ExternalLink, X, RotateCw, ShieldCheck, Maximize2, Minimize2 } from 'lucide-react';

interface InHudViewportModalProps {
  isOpen: boolean;
  url: string | null;
  title?: string;
  onClose: () => void;
}

export const InHudViewportModal: React.FC<InHudViewportModalProps> = ({
  isOpen,
  url,
  title,
  onClose
}) => {
  const [iframeKey, setIframeKey] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const [loadError, setLoadError] = useState(false);

  if (!isOpen || !url) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={`relative w-full ${
          isMaximized ? 'h-[96vh] max-w-[98vw]' : 'h-[85vh] max-w-5xl'
        } bg-[#020617] border border-cyan-400/50 rounded-sm shadow-[0_0_50px_rgba(34,211,238,0.25)] flex flex-col overflow-hidden transition-all duration-300`}
      >
        {/* Holographic Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-cyan-400/30">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-xs bg-cyan-400/20 text-cyan-300">
              <Globe className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] mono text-cyan-400 uppercase font-bold tracking-wider">
                  ORION LIVE WEB VIEWPORT
                </span>
                <span className="flex items-center gap-1 text-[9px] mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-400/30">
                  <ShieldCheck className="w-2.5 h-2.5" /> SECURE SANDBOX
                </span>
              </div>
              <p className="text-xs text-slate-200 truncate font-mono mt-0.5">
                {title || url}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setLoadError(false);
                setIframeKey(k => k + 1);
              }}
              className="p-1.5 rounded-xs text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
              title="Reload Viewport"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>

            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1 rounded-xs bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/30 text-cyan-300 hover:text-cyan-100 text-xs mono flex items-center gap-1 transition-colors"
              title="Open in new window"
            >
              <span>External Tab</span>
              <ExternalLink className="w-3 h-3" />
            </a>

            <button
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-1.5 rounded-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title={isMaximized ? "Restore size" : "Maximize"}
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xs text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
              title="Close Viewport"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Viewport Address Bar */}
        <div className="px-4 py-1.5 bg-[#050b14] border-b border-cyan-400/20 flex items-center justify-between text-[11px] mono text-slate-400">
          <span className="truncate max-w-xl text-cyan-300/80">{url}</span>
          <span className="text-[10px] text-slate-500 hidden sm:inline">SANDBOX: ALLOW-SCRIPTS ALLOW-SAME-ORIGIN</span>
        </div>

        {/* Iframe Viewport Container */}
        <div className="relative flex-1 bg-white/5 w-full h-full overflow-hidden">
          {loadError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950 space-y-4">
              <Globe className="w-12 h-12 text-cyan-400/50" />
              <div className="max-w-md space-y-1">
                <h4 className="text-sm font-bold text-slate-200 mono">External Domain Embed Protected</h4>
                <p className="text-xs text-slate-400">
                  This website prevents direct iframe embedding via <code className="text-cyan-300">X-Frame-Options</code> or CSP. You can still open it directly in a dedicated tab.
                </p>
              </div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-xs bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold text-xs mono flex items-center gap-1.5 shadow-[0_0_15px_rgba(34,211,238,0.4)]"
              >
                <span>Open Live in New Tab</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <iframe
              key={iframeKey}
              src={url}
              title={title || "ORION Web Viewport"}
              className="w-full h-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onError={() => setLoadError(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
};
