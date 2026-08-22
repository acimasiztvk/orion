import React, { useState } from 'react';
import {
  Globe,
  ArrowUpRight,
  CheckCircle2,
  FileText,
  Layers,
  X,
  Copy,
  Check,
  Video,
  Share2,
  Users,
  ShieldCheck,
  Radio,
  Calendar,
  Mail,
  Send,
  UserCheck,
  Bot,
  ShoppingBag,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Sparkles
} from 'lucide-react';

export interface ActionResultData {
  runId?: string;
  platform?: string;
  action_type?: string;
  extracted_title?: string;
  extracted_content?: string;
  final_url?: string;
  steps_count?: number;
  steps_executed?: any[];
  timestamp?: string;
  // Meeting-specific properties
  meeting_id?: string;
  meeting_code?: string;
  passcode?: string;
  topic?: string;
  scheduled_time?: string;
  attendees?: string[];
  invitee_name?: string;
  invitee_email?: string;
  calendar_invite_url?: string;
  mailto_invite_url?: string;
  shareable_invite_text?: string;
  proxy_identity?: string;
  phase_tag?: string;
  auto_launch?: boolean;
  in_meeting_automation?: any;
}

export interface ProductItem {
  title: string;
  price?: string;
  image_url?: string;
  link?: string;
  rating?: string;
}

export function parseProductItems(content?: string | object): ProductItem[] {
  if (!content) return [];

  let data: any = content;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        data = JSON.parse(trimmed);
      } catch (e) {
        // Continue to line parsing
      }
    }
  }

  // 1. Handle JSON object or array
  if (data && typeof data === 'object') {
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.products)
      ? data.products
      : Array.isArray(data.results)
      ? data.results
      : null;

    if (list && list.length > 0) {
      const items: ProductItem[] = [];
      for (const item of list) {
        if (!item) continue;
        if (typeof item === 'string') {
          items.push({ title: item });
          continue;
        }
        const title = item.title || item.name || item.product || item.item || item.label || '';
        const price = item.price || item.cost || item.amount || '';
        const image_url = item.image_url || item.image || item.photo || item.thumbnail || item.img || '';
        const link = item.link || item.url || item.product_url || '';
        const rating = item.rating || item.stars || '';

        if (title && String(title).length > 2) {
          items.push({
            title: String(title),
            price: price ? String(price) : undefined,
            image_url: image_url ? String(image_url) : undefined,
            link: link ? String(link) : undefined,
            rating: rating ? String(rating) : undefined
          });
        }
      }
      if (items.length > 0) return items;
    }
  }

  // 2. Handle Text format with lines
  if (typeof content === 'string') {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const items: ProductItem[] = [];

    for (const line of lines) {
      const itemMatch = line.match(/^(?:\d+[\.\)]|[*•-])\s*(.+)$/);
      const lineText = itemMatch ? itemMatch[1].trim() : line;

      const hasPrice = /(\$\d+(?:\.\d{2})?|£\d+(?:\.\d{2})?|€\d+(?:\.\d{2})?|\d+(?:\.\d{2})?\s*USD)/i.test(lineText);
      const hasImage = /(?:Image|Photo|Thumbnail|Img|Pic):\s*(https?:\/\/[^\s—|]+)/i.test(lineText) ||
                       /https?:\/\/[^\s—|]+\.(?:jpg|jpeg|png|webp|gif)[^\s—|]*/i.test(lineText) ||
                       /https?:\/\/[^\s—|]*amazon[^\s—|]*/i.test(lineText);

      if (hasPrice || hasImage || itemMatch) {
        let imageUrl = '';
        const imgMatch = lineText.match(/(?:Image|Photo|Thumbnail|Img|Pic):\s*(https?:\/\/[^\s—|]+)/i) ||
                         lineText.match(/(https?:\/\/[^\s—|]+\.(?:jpg|jpeg|png|webp|gif)[^\s—|]*)/i) ||
                         lineText.match(/(https?:\/\/[^\s—|]*media-amazon[^\s—|]*)/i);
        if (imgMatch) {
          imageUrl = imgMatch[1];
        }

        let price = '';
        const priceMatch = lineText.match(/(\$\d+(?:\.\d{2})?|£\d+(?:\.\d{2})?|€\d+(?:\.\d{2})?|\d+(?:\.\d{2})?\s*USD)/i);
        if (priceMatch) {
          price = priceMatch[1];
        }

        let linkUrl = '';
        const linkMatch = lineText.match(/(?:Link|Url):\s*(https?:\/\/[^\s—|]+)/i) ||
                          lineText.match(/(https?:\/\/(?:www\.)?amazon\.[a-z.]+\/[^\s—|]+)/i);
        if (linkMatch) {
          linkUrl = linkMatch[1];
        }

        let title = lineText
          .replace(/(?:Image|Photo|Thumbnail|Img|Pic):\s*https?:\/\/[^\s—|]+/gi, '')
          .replace(/(?:Link|Url):\s*https?:\/\/[^\s—|]+/gi, '')
          .replace(/https?:\/\/[^\s—|]+\.(?:jpg|jpeg|png|webp|gif)[^\s—|]*/gi, '')
          .replace(/—\s*Image:.*$/i, '')
          .replace(/\|\s*Image:.*$/i, '')
          .replace(/\s*—\s*/g, ' ')
          .replace(/^(?:\d+[\.\)]|[*•-])\s*/, '')
          .trim();

        title = title.replace(/^[\s—|-]+|[\s—|-]+$/g, '').trim();

        if (title.length > 2) {
          items.push({
            title,
            price: price || undefined,
            image_url: imageUrl || undefined,
            link: linkUrl || undefined
          });
        }
      }
    }
    return items;
  }

  return [];
}

interface ProductCardRowProps {
  item: ProductItem;
  defaultUrl?: string;
}

const ProductCardRow: React.FC<ProductCardRowProps> = ({ item, defaultUrl }) => {
  const [imgError, setImgError] = useState(false);
  const targetLink = item.link || defaultUrl;

  return (
    <div className="flex items-start sm:items-center gap-3 p-2.5 rounded-md bg-slate-900/90 border border-slate-800 hover:border-cyan-400/40 transition-all group">
      {/* Thumbnail Frame */}
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-md bg-slate-950 border border-slate-800 p-1 flex items-center justify-center shrink-0 overflow-hidden relative">
        {item.image_url && !imgError ? (
          <img
            src={item.image_url}
            alt={item.title}
            className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-105"
            onError={() => setImgError(true)}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-cyan-400/60 p-1">
            <ShoppingBag className="w-6 h-6 mb-0.5 text-cyan-400/70" />
            <span className="text-[8px] mono text-slate-500 uppercase">Product</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1">
        <h5 className="text-xs sm:text-sm font-semibold text-slate-100 line-clamp-2 leading-snug group-hover:text-cyan-200 transition-colors">
          {item.title}
        </h5>
        {item.rating && (
          <div className="flex items-center gap-1 text-[10px] text-amber-400 font-mono">
            <span>★</span>
            <span className="text-slate-300 truncate">{item.rating}</span>
          </div>
        )}
      </div>

      {/* Price & Direct Action */}
      <div className="flex flex-col items-end gap-1.5 shrink-0 pl-1">
        {item.price && (
          <span className="px-2.5 py-1 rounded-xs bg-emerald-500/15 text-emerald-300 border border-emerald-400/30 text-xs font-mono font-bold">
            {item.price}
          </span>
        )}
        {targetLink && (
          <a
            href={targetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] mono text-cyan-400 hover:text-cyan-200 flex items-center gap-0.5 underline underline-offset-2 transition-colors"
          >
            <span>View ↗</span>
          </a>
        )}
      </div>
    </div>
  );
};

interface ActionResultCardProps {
  result: ActionResultData;
  onOpenViewport?: (url: string, title?: string) => void;
  onViewTelemetry?: (runId?: string) => void;
  onDismiss?: () => void;
}

export const ActionResultCard: React.FC<ActionResultCardProps> = ({
  result,
  onOpenViewport,
  onViewTelemetry,
  onDismiss
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const isMeeting = Boolean(
    result.action_type === 'create_instant_meeting' ||
    result.action_type === 'schedule_meeting' ||
    result.action_type === 'MEETING_CREATED' ||
    result.meeting_code ||
    result.calendar_invite_url ||
    result.final_url?.includes('meet.google.com') ||
    result.final_url?.includes('zoom.us')
  );

  const isMeetingProxy = Boolean(
    result.action_type === 'attend_meeting_proxy' ||
    result.action_type === 'MEETING_PROXY_DISPATCHED' ||
    result.proxy_identity ||
    result.phase_tag?.includes('MEETING_JOINED')
  );

  const targetTitle = result.extracted_title || result.topic || result.platform || 'Automation Target';
  const url = result.final_url;
  const content = result.extracted_content;
  const stepCount = result.steps_count || result.steps_executed?.length || 0;
  const meetingCode = result.meeting_code;
  const attendees = result.attendees || (result.invitee_name ? [result.invitee_name] : []);

  const productItems = parseProductItems(content);
  const isProductSearch = productItems.length > 0;

  const handleCopyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (e) {
      console.warn('Copy to clipboard failed:', e);
    }
  };

  const handleCopyCode = async () => {
    if (!meetingCode) return;
    try {
      await navigator.clipboard.writeText(meetingCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (e) {
      console.warn('Copy code failed:', e);
    }
  };

  const handleCopyInviteText = async () => {
    const inviteText = result.shareable_invite_text || 
      `Topic: ${targetTitle}\nLink: ${url || 'https://meet.google.com/new'}\nCode: ${meetingCode || ''}${attendees.length > 0 ? `\nAttendees: ${attendees.join(', ')}` : ''}`;
    try {
      await navigator.clipboard.writeText(inviteText);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch (e) {
      console.warn('Copy invite text failed:', e);
    }
  };

  return (
    <div
      id="orion-action-result-card"
      className="relative my-3 p-3.5 rounded-sm bg-gradient-to-b from-cyan-950/50 to-slate-950/90 border border-cyan-400/40 shadow-[0_0_25px_rgba(34,211,238,0.2)] space-y-3 animate-in fade-in slide-in-from-top-2 duration-300 pointer-events-auto"
    >
      {/* Corner glowing accents */}
      <div className="absolute top-0 left-0 w-3 h-[2px] bg-cyan-400" />
      <div className="absolute top-0 right-0 w-3 h-[2px] bg-cyan-400" />
      <div className="absolute bottom-0 left-0 w-3 h-[2px] bg-cyan-400" />
      <div className="absolute bottom-0 right-0 w-3 h-[2px] bg-cyan-400" />

      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-cyan-400/20 pb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-xs bg-cyan-400/20 text-cyan-300 shrink-0">
            {isProductSearch ? (
              <ShoppingBag className="w-4 h-4 text-cyan-300" />
            ) : isMeeting || isMeetingProxy ? (
              <Video className="w-4 h-4 text-cyan-300" />
            ) : (
              <Globe className="w-4 h-4 text-cyan-300" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] mono text-cyan-400 uppercase font-bold tracking-wider">
                {isProductSearch
                  ? 'PRODUCT SEARCH RESULTS'
                  : isMeetingProxy
                  ? 'MEETING PROXY AGENT'
                  : isMeeting
                  ? 'INSTANT MEETING ROOM'
                  : 'AUTOMATION RESULT'}
              </span>
              {isProductSearch && (
                <>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 font-bold">
                    {productItems.length} ITEM{productItems.length > 1 ? 'S' : ''} EXTRACTED
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 font-bold">
                    SOURCE: {
                      (typeof content === 'string' && content.includes('"source": "eBay"')) ? 'EBAY' :
                      (typeof content === 'string' && content.includes('"source": "Google Shopping"')) ? 'GOOGLE SHOPPING' :
                      url?.includes('ebay') ? 'EBAY' :
                      url?.includes('google') ? 'GOOGLE SHOPPING' :
                      url?.includes('amazon') ? 'AMAZON' : 'EBAY'
                    }
                  </span>
                </>
              )}
              {isMeetingProxy && (
                <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/50 flex items-center gap-1">
                  <Radio className="w-2.5 h-2.5 animate-pulse text-emerald-400" />
                  [STATUS: MEETING_JOINED]
                </span>
              )}
            </div>
            <h4 className="text-xs sm:text-sm font-semibold text-slate-100 truncate mt-0.5">
              {targetTitle}
            </h4>
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-slate-400 hover:text-slate-200 text-xs p-1 rounded-xs hover:bg-slate-800 transition-colors shrink-0"
            title="Dismiss result"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Main Visual Display: Product Cards Rows */}
      {isProductSearch ? (
        <div className="space-y-2 my-1">
          {productItems.map((item, idx) => (
            <ProductCardRow key={idx} item={item} defaultUrl={url} />
          ))}
        </div>
      ) : content && !isMeeting ? (
        /* Non-Product Raw Content Display */
        <div className="p-2.5 rounded-xs bg-slate-900/90 border border-cyan-400/20 text-xs text-slate-200 leading-relaxed font-sans max-h-48 overflow-y-auto pr-1 whitespace-pre-wrap">
          <div className="flex items-center gap-1.5 text-[10px] mono text-cyan-400/80 mb-1 font-semibold uppercase">
            <FileText className="w-3 h-3 text-cyan-400" />
            <span>Extracted Intelligence</span>
          </div>
          {content}
        </div>
      ) : null}

      {/* Meeting Room Specific Quick-Action / Code Bar */}
      {(meetingCode || url) && isMeeting && (
        <div className="space-y-2">
          {result.auto_launch && (
            <div className="px-2.5 py-1.5 rounded-xs bg-emerald-500/10 border border-emerald-400/40 flex items-center justify-between text-[11px] font-mono text-emerald-300">
              <span className="flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
                <span className="font-bold">AUTONOMOUS AUTO-LAUNCH ACTIVE:</span> Redirecting to live room session...
              </span>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-white shrink-0 font-bold"
                >
                  Direct Link ↗
                </a>
              )}
            </div>
          )}

          {/* Attendees Roster Tag */}
          {attendees.length > 0 && (
            <div className="p-2 rounded-xs bg-cyan-950/30 border border-cyan-500/30 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-cyan-200 min-w-0">
                <UserCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="text-[11px] mono text-cyan-300 font-semibold uppercase shrink-0">Invited:</span>
                <span className="text-[11px] font-mono text-slate-200 truncate">
                  {attendees.join(', ')}
                </span>
              </div>
            </div>
          )}

          <div className="p-2.5 rounded-xs bg-cyan-950/40 border border-cyan-400/30 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            <div className="min-w-0 space-y-0.5">
              <div className="text-[10px] mono text-cyan-300 uppercase font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3 text-cyan-400" />
                <span>Real Instant Meeting Portal</span>
              </div>
              <div className="text-xs font-mono text-slate-200 truncate select-all">
                {url || `https://meet.google.com/new`}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              {meetingCode && meetingCode !== 'meet.google.com/new' && (
                <button
                  id="btn-copy-meeting-code"
                  onClick={handleCopyCode}
                  className="px-2.5 py-1 rounded-xs bg-slate-900 hover:bg-slate-800 border border-cyan-400/30 text-cyan-200 hover:text-white text-[11px] font-mono flex items-center gap-1 transition-all"
                  title="Copy Meeting Code"
                >
                  {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCode ? 'Code Copied' : meetingCode}</span>
                </button>
              )}

              {url && (
                <button
                  id="btn-copy-meeting-link"
                  onClick={handleCopyLink}
                  className="px-2.5 py-1 rounded-xs bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-100 text-[11px] font-mono flex items-center gap-1 transition-all"
                  title="Copy Shareable Link"
                >
                  {copiedLink ? <Check className="w-3 h-3 text-emerald-400" /> : <Share2 className="w-3 h-3" />}
                  <span>{copiedLink ? 'Link Copied!' : 'Copy Link'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Collapsed Technical / Debug / Viewport Details Section */}
      <div className="border-t border-cyan-400/20 pt-2">
        <button
          onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
          className="text-[10px] mono text-slate-400 hover:text-cyan-300 flex items-center justify-between w-full transition-colors group py-0.5"
        >
          <span className="flex items-center gap-1">
            {showTechnicalDetails ? <ChevronUp className="w-3 h-3 text-cyan-400" /> : <ChevronDown className="w-3 h-3 text-cyan-400" />}
            <span>Technical Details & Telemetry</span>
          </span>
          {stepCount > 0 && (
            <span className="text-[9px] text-slate-500 group-hover:text-slate-400">
              {stepCount} steps logged
            </span>
          )}
        </button>

        {showTechnicalDetails && (
          <div className="mt-2.5 space-y-2 animate-in fade-in duration-200">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/60 p-2 rounded-xs border border-slate-800">
              <div className="flex items-center gap-2">
                {result.runId && onViewTelemetry && (
                  <button
                    id="btn-view-telemetry"
                    onClick={() => onViewTelemetry(result.runId)}
                    className="px-2.5 py-1 rounded-xs bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/30 text-cyan-300 hover:text-cyan-100 text-[10px] mono flex items-center gap-1.5 transition-all"
                  >
                    <Layers className="w-3 h-3 text-cyan-400" />
                    <span>Telemetry Logs</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {url && onOpenViewport && (
                  <button
                    id="btn-inspect-in-hud"
                    onClick={() => onOpenViewport(url, targetTitle)}
                    className="px-2.5 py-1 rounded-xs bg-cyan-950/80 hover:bg-cyan-900/80 border border-cyan-400/50 text-cyan-200 hover:text-cyan-50 font-bold text-[10px] mono flex items-center gap-1.5 transition-all"
                  >
                    <span>{isMeeting ? 'In-HUD Room' : 'Inspect Viewport'}</span>
                    <Layers className="w-3 h-3" />
                  </button>
                )}

                {url && (
                  <a
                    id="btn-open-live-target"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 rounded-xs bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-[10px] mono flex items-center gap-1.5 transition-all border border-cyan-400/30"
                  >
                    <span>{isMeeting ? 'Join Meeting' : 'Open Target'}</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>

            {content && isProductSearch && (
              <div className="p-2 rounded-xs bg-slate-950/80 border border-slate-800 text-[10px] mono text-slate-400 max-h-32 overflow-y-auto whitespace-pre-wrap">
                <div className="text-[9px] text-cyan-400/70 uppercase mb-1 font-bold">Raw Scraped Extraction:</div>
                {content}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
