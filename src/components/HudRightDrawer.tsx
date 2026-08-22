import React, { useState } from 'react';
import {
  X,
  Brain,
  Bell,
  FileText,
  Briefcase,
  Layers,
  Trash2,
  CheckCircle2,
  Circle,
  ExternalLink,
  Search,
  Sparkles,
  MapPin,
  DollarSign,
  Plus
} from 'lucide-react';
import { UserProfileFact, Reminder, Note, Job, ToolLog } from '../types';

interface HudRightDrawerProps {
  isOpen: boolean;
  activeTab: 'memory' | 'reminders' | 'notes' | 'jobs' | 'telemetry' | null;
  onClose: () => void;
  onSelectTab: (tab: 'memory' | 'reminders' | 'notes' | 'jobs' | 'telemetry') => void;
  facts: UserProfileFact[];
  reminders: Reminder[];
  notes: Note[];
  jobs: Job[];
  toolLogs: ToolLog[];
  selectedRunId?: string | null;
  onSelectRunId?: (runId: string | null) => void;
  onAddFact: (category: string, key: string, value: string) => void;
  onToggleReminder: (id: string) => void;
  onDeleteReminder: (id: string) => void;
  onAddReminder: (text: string, datetime: string) => void;
  onDeleteNote: (id: string) => void;
  onAddNote: (category: string, content: string) => void;
  onSearchJobs: (query: string, location?: string) => void;
}

export const HudRightDrawer: React.FC<HudRightDrawerProps> = ({
  isOpen,
  activeTab,
  onClose,
  onSelectTab,
  facts,
  reminders,
  notes,
  jobs,
  toolLogs,
  selectedRunId = null,
  onSelectRunId,
  onAddFact,
  onToggleReminder,
  onDeleteReminder,
  onAddReminder,
  onDeleteNote,
  onAddNote,
  onSearchJobs,
}) => {
  if (!isOpen || !activeTab) return null;

  // Local form states
  const [newFactCat, setNewFactCat] = useState('preference');
  const [newFactKey, setNewFactKey] = useState('');
  const [newFactVal, setNewFactVal] = useState('');

  const [newRemText, setNewRemText] = useState('');
  const [newRemDate, setNewRemDate] = useState('');

  const [newNoteCat, setNewNoteCat] = useState('Personal');
  const [newNoteContent, setNewNoteContent] = useState('');

  const [jobQuery, setJobQuery] = useState('');

  return (
    <aside
      id="hud-right-drawer"
      className="fixed inset-y-0 right-0 w-96 max-w-[90vw] bg-[#020617]/95 border-l border-cyan-400/20 backdrop-blur-xl z-40 flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.8)] transition-transform duration-300 animate-in slide-in-from-right"
    >
      {/* Drawer Top Navigation Bar */}
      <div className="p-3 border-b border-cyan-400/20 flex items-center justify-between bg-slate-950">
        <div className="flex items-center gap-1 overflow-x-auto py-1 scrollbar-none">
          <button
            id="tab-btn-memory"
            onClick={() => onSelectTab('memory')}
            className={`px-2.5 py-1 rounded-sm text-xs mono tracking-wider flex items-center gap-1.5 transition-all ${
              activeTab === 'memory'
                ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40 shadow-[0_0_8px_rgba(34,211,238,0.2)]'
                : 'text-slate-400 hover:text-cyan-300'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>MEMORY</span>
          </button>

          <button
            id="tab-btn-reminders"
            onClick={() => onSelectTab('reminders')}
            className={`px-2.5 py-1 rounded-sm text-xs mono tracking-wider flex items-center gap-1.5 transition-all ${
              activeTab === 'reminders'
                ? 'bg-amber-400/20 text-amber-200 border border-amber-400/40 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                : 'text-slate-400 hover:text-amber-300'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>TASKS</span>
          </button>

          <button
            id="tab-btn-notes"
            onClick={() => onSelectTab('notes')}
            className={`px-2.5 py-1 rounded-sm text-xs mono tracking-wider flex items-center gap-1.5 transition-all ${
              activeTab === 'notes'
                ? 'bg-sky-400/20 text-sky-200 border border-sky-400/40'
                : 'text-slate-400 hover:text-sky-300'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>NOTES</span>
          </button>

          <button
            id="tab-btn-jobs"
            onClick={() => onSelectTab('jobs')}
            className={`px-2.5 py-1 rounded-sm text-xs mono tracking-wider flex items-center gap-1.5 transition-all ${
              activeTab === 'jobs'
                ? 'bg-emerald-400/20 text-emerald-200 border border-emerald-400/40'
                : 'text-slate-400 hover:text-emerald-300'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>JOBS</span>
          </button>

          <button
            id="tab-btn-telemetry"
            onClick={() => onSelectTab('telemetry')}
            className={`px-2.5 py-1 rounded-sm text-xs mono tracking-wider flex items-center gap-1.5 transition-all ${
              activeTab === 'telemetry'
                ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40'
                : 'text-slate-400 hover:text-cyan-300'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>LOGS</span>
          </button>
        </div>

        <button
          id="btn-close-right-drawer"
          onClick={onClose}
          className="p-1.5 rounded-sm text-slate-400 hover:text-cyan-300 hover:bg-cyan-400/10 shrink-0 ml-2"
          title="Close Panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Content Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 1. MEMORY PROFILE TAB */}
        {activeTab === 'memory' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs mono font-bold tracking-[0.2em] text-cyan-400 uppercase">
                  USER MEMORY MATRIX
                </h3>
                <p className="text-[11px] mono text-cyan-400/60">
                  Autonomously learned via natural speech
                </p>
              </div>
              <span className="text-[10px] mono px-2 py-0.5 rounded-sm bg-cyan-400/10 border border-cyan-400/30 text-cyan-300">
                {facts.length} ARCHIVED
              </span>
            </div>

            {/* Quick Add Fact Form */}
            <div className="p-3 rounded-sm bg-cyan-400/5 border border-cyan-400/20 space-y-2">
              <div className="text-[10px] mono text-cyan-400 uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>Inject Memory Fact</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Category (e.g. tech)"
                  value={newFactCat}
                  onChange={(e) => setNewFactCat(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded-sm bg-slate-950 border border-cyan-400/20 text-cyan-200 placeholder-slate-500 mono focus:outline-none focus:border-cyan-400"
                />
                <input
                  type="text"
                  placeholder="Key (e.g. main_lang)"
                  value={newFactKey}
                  onChange={(e) => setNewFactKey(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded-sm bg-slate-950 border border-cyan-400/20 text-cyan-200 placeholder-slate-500 mono focus:outline-none focus:border-cyan-400"
                />
              </div>
              <input
                type="text"
                placeholder="Value (e.g. TypeScript & Rust)"
                value={newFactVal}
                onChange={(e) => setNewFactVal(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-sm bg-slate-950 border border-cyan-400/20 text-cyan-200 placeholder-slate-500 mono focus:outline-none focus:border-cyan-400"
              />
              <button
                id="btn-add-fact"
                onClick={() => {
                  if (newFactKey.trim() && newFactVal.trim()) {
                    onAddFact(newFactCat || 'General', newFactKey.trim(), newFactVal.trim());
                    setNewFactKey('');
                    setNewFactVal('');
                  }
                }}
                className="w-full py-1.5 rounded-sm bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/30 text-cyan-300 text-[11px] mono uppercase tracking-wider flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3 h-3" />
                <span>COMMIT TO MEMORY</span>
              </button>
            </div>

            {/* List of Facts */}
            <div className="space-y-2">
              {facts.map((fact) => (
                <div
                  key={fact.id}
                  id={`fact-${fact.id}`}
                  className="p-3 rounded-sm bg-cyan-400/5 border border-cyan-400/20 hover:border-cyan-400/40 transition-all space-y-1"
                >
                  <div className="flex items-center justify-between text-[10px] mono">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded-xs bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 uppercase">
                        {fact.category}
                      </span>
                      {fact.confidence !== undefined && (
                        <span className="px-1 py-0.2 rounded-xs bg-cyan-950/60 border border-cyan-500/20 text-cyan-400/80 text-[9px]">
                          {Math.round((fact.confidence || 0.9) * 100)}% CONF
                        </span>
                      )}
                    </div>
                    <span className="text-slate-500">
                      {new Date(fact.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-xs mono font-semibold text-cyan-200">
                    {fact.key}
                  </div>
                  <div className="text-xs text-slate-300 font-light leading-relaxed">
                    {fact.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. REMINDERS TAB */}
        {activeTab === 'reminders' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs mono font-bold tracking-[0.2em] text-amber-400 uppercase">
                  SCHEDULED REMINDERS
                </h3>
                <p className="text-[11px] mono text-amber-400/60">
                  Target timestamps & alerts
                </p>
              </div>
              <span className="text-[10px] mono px-2 py-0.5 rounded-sm bg-amber-400/10 border border-amber-400/30 text-amber-300">
                {reminders.filter((r) => r.status === 'pending').length} PENDING
              </span>
            </div>

            {/* Quick Add Reminder */}
            <div className="p-3 rounded-sm bg-amber-400/5 border border-amber-400/20 space-y-2">
              <input
                type="text"
                placeholder="Reminder task (e.g. Review neural schematics)"
                value={newRemText}
                onChange={(e) => setNewRemText(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-sm bg-slate-950 border border-amber-400/20 text-amber-100 placeholder-slate-500 mono focus:outline-none focus:border-amber-400"
              />
              <input
                type="text"
                placeholder="Date/Time (e.g. Tomorrow 9:00 AM)"
                value={newRemDate}
                onChange={(e) => setNewRemDate(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-sm bg-slate-950 border border-amber-400/20 text-amber-100 placeholder-slate-500 mono focus:outline-none focus:border-amber-400"
              />
              <button
                id="btn-add-reminder"
                onClick={() => {
                  if (newRemText.trim()) {
                    onAddReminder(newRemText.trim(), newRemDate.trim() || 'Today 6:00 PM');
                    setNewRemText('');
                    setNewRemDate('');
                  }
                }}
                className="w-full py-1.5 rounded-sm bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 text-amber-300 text-[11px] mono uppercase tracking-wider flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3 h-3" />
                <span>SCHEDULE REMINDER</span>
              </button>
            </div>

            {/* Reminders List */}
            <div className="space-y-2">
              {reminders.length === 0 ? (
                <div className="p-4 text-center text-xs mono text-slate-500">
                  NO ACTIVE REMINDERS
                </div>
              ) : (
                reminders.map((rem) => (
                  <div
                    key={rem.id}
                    id={`reminder-${rem.id}`}
                    className={`p-3 rounded-sm border transition-all flex items-start gap-3 ${
                      rem.status === 'completed'
                        ? 'bg-slate-950/50 border-slate-800 opacity-60'
                        : 'bg-amber-400/5 border-amber-400/20 hover:border-amber-400/40'
                    }`}
                  >
                    <button
                      onClick={() => onToggleReminder(rem.id)}
                      className="mt-0.5 text-amber-400 hover:text-amber-300 shrink-0"
                    >
                      {rem.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Circle className="w-4 h-4" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-xs font-light leading-relaxed ${
                          rem.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-100'
                        }`}
                      >
                        {rem.text}
                      </div>
                      <div className="text-[10px] mono text-amber-400/90 mt-1 flex items-center gap-1">
                        <Bell className="w-3 h-3" />
                        <span>{rem.datetime}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => onDeleteReminder(rem.id)}
                      className="text-slate-500 hover:text-rose-400 p-1 rounded-sm"
                      title="Delete Reminder"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* 3. NOTES TAB */}
        {activeTab === 'notes' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs mono font-bold tracking-[0.2em] text-sky-400 uppercase">
                  NOTES ARCHIVE
                </h3>
                <p className="text-[11px] mono text-sky-400/60">
                  Categorized memos & technical logs
                </p>
              </div>
              <span className="text-[10px] mono px-2 py-0.5 rounded-sm bg-sky-400/10 border border-sky-400/30 text-sky-300">
                {notes.length} ARCHIVED
              </span>
            </div>

            {/* Quick Add Note */}
            <div className="p-3 rounded-sm bg-sky-400/5 border border-sky-400/20 space-y-2">
              <input
                type="text"
                placeholder="Category (e.g. Project Stark, Architecture)"
                value={newNoteCat}
                onChange={(e) => setNewNoteCat(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-sm bg-slate-950 border border-sky-400/20 text-sky-100 placeholder-slate-500 mono focus:outline-none focus:border-sky-400"
              />
              <textarea
                placeholder="Note content..."
                rows={2}
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-sm bg-slate-950 border border-sky-400/20 text-sky-100 placeholder-slate-500 mono focus:outline-none focus:border-sky-400 resize-none"
              />
              <button
                id="btn-add-note"
                onClick={() => {
                  if (newNoteContent.trim()) {
                    onAddNote(newNoteCat || 'General', newNoteContent.trim());
                    setNewNoteContent('');
                  }
                }}
                className="w-full py-1.5 rounded-sm bg-sky-400/10 hover:bg-sky-400/20 border border-sky-400/30 text-sky-300 text-[11px] mono uppercase tracking-wider flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3 h-3" />
                <span>ARCHIVE NOTE</span>
              </button>
            </div>

            {/* Notes List */}
            <div className="space-y-2">
              {notes.length === 0 ? (
                <div className="p-4 text-center text-xs mono text-slate-500">
                  NO NOTES ARCHIVED
                </div>
              ) : (
                notes.map((note) => (
                  <div
                    key={note.id}
                    id={`note-${note.id}`}
                    className="p-3 rounded-sm bg-sky-400/5 border border-sky-400/20 hover:border-sky-400/40 transition-all space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[10px] mono">
                      <span className="px-1.5 py-0.5 rounded-xs bg-sky-400/15 border border-sky-400/30 text-sky-300 uppercase">
                        {note.category}
                      </span>
                      <button
                        onClick={() => onDeleteNote(note.id)}
                        className="text-slate-500 hover:text-rose-400 p-1 rounded-sm"
                        title="Delete Note"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-200 font-light leading-relaxed whitespace-pre-wrap">
                      {note.content}
                    </p>
                    <div className="text-[9px] mono text-slate-500">
                      {new Date(note.created_at).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* 4. JOB RADAR TAB */}
        {activeTab === 'jobs' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs mono font-bold tracking-[0.2em] text-emerald-400 uppercase">
                  CAREER & OPPORTUNITY RADAR
                </h3>
                <p className="text-[11px] mono text-emerald-400/60">
                  High-tech, AI research & systems engineering
                </p>
              </div>
            </div>

            {/* Search Input */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-emerald-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter (e.g. AI Engineer, London, Remote)"
                  value={jobQuery}
                  onChange={(e) => {
                    setJobQuery(e.target.value);
                    onSearchJobs(e.target.value);
                  }}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-sm bg-slate-950 border border-emerald-400/25 text-emerald-100 placeholder-slate-500 mono focus:outline-none focus:border-emerald-400"
                />
              </div>
            </div>

            {/* Jobs List */}
            <div className="space-y-3">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  id={`job-${job.id}`}
                  className="p-3 rounded-sm bg-emerald-400/5 border border-emerald-400/20 hover:border-emerald-400/50 transition-all space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-semibold text-emerald-200">{job.title}</h4>
                      <p className="text-[11px] text-slate-300 mono">{job.company}</p>
                    </div>
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 rounded-xs bg-emerald-400/10 hover:bg-emerald-400/25 text-emerald-300 border border-emerald-400/30"
                      title="Open Job Portal"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[10px] mono text-slate-400">
                    <span className="flex items-center gap-1 text-slate-300">
                      <MapPin className="w-3 h-3 text-emerald-400" />
                      {job.location}
                    </span>
                    <span className="flex items-center gap-1 text-emerald-300 font-bold">
                      <DollarSign className="w-3 h-3" />
                      {job.currency} {job.salary_min.toLocaleString()} - {job.salary_max.toLocaleString()}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 font-light leading-relaxed">{job.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 5. TELEMETRY & TOOL LOGS TAB */}
        {activeTab === 'telemetry' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs mono font-bold tracking-[0.2em] text-cyan-400 uppercase">
                  TOOL EXECUTION TELEMETRY
                </h3>
                <p className="text-[11px] mono text-cyan-400/60">
                  Autonomous task runs & step-by-step audit
                </p>
              </div>
              <span className="text-[10px] mono px-2 py-0.5 rounded-sm bg-cyan-400/10 border border-cyan-400/30 text-cyan-300">
                {toolLogs.length} LOGGED
              </span>
            </div>

            {/* Task Run Filter (if any task runs exist) */}
            {selectedRunId && (
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-sm bg-cyan-400/10 border border-cyan-400/30 text-[11px] mono">
                <span className="text-cyan-300 truncate">
                  Filtered Run: <span className="font-bold text-cyan-100">{selectedRunId}</span>
                </span>
                <button
                  onClick={() => onSelectRunId && onSelectRunId(null)}
                  className="text-slate-400 hover:text-cyan-200 ml-2 text-[10px] uppercase underline shrink-0"
                >
                  Show All
                </button>
              </div>
            )}

            {/* Tool Logs List */}
            <div className="space-y-2.5">
              {toolLogs.length === 0 ? (
                <div className="p-4 text-center text-xs mono text-slate-500">
                  AWAITING AGENT ACTIONS...
                </div>
              ) : (
                toolLogs
                  .filter((log) => !selectedRunId || log.task_run_id === selectedRunId)
                  .map((log) => (
                    <div
                      key={log.id}
                      id={`tool-log-${log.id}`}
                      className="p-3 rounded-sm bg-cyan-400/5 border border-cyan-400/20 mono text-xs space-y-1.5 hover:border-cyan-400/40 transition-all"
                    >
                      <div className="flex items-center justify-between text-[10px]">
                        <div className="flex items-center gap-2">
                          <span className="text-cyan-400 font-bold uppercase tracking-wider">
                            λ {log.name}()
                          </span>
                          {log.step_index && log.total_steps && (
                            <span className="px-1.5 py-0.2 rounded-xs bg-cyan-400/15 border border-cyan-400/30 text-cyan-300 text-[9px]">
                              Step {log.step_index}/{log.total_steps}
                            </span>
                          )}
                          <span
                            className={`px-1.5 py-0.2 rounded-xs text-[9px] uppercase ${
                              log.status === 'success'
                                ? 'bg-emerald-400/15 text-emerald-300 border border-emerald-400/30'
                                : log.status === 'failed'
                                ? 'bg-rose-400/15 text-rose-300 border border-rose-400/30'
                                : 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                            }`}
                          >
                            {log.status}
                          </span>
                        </div>
                        <span className="text-slate-500 text-[9px]">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>

                      {log.target && (
                        <div className="text-[10px] text-cyan-200/80">
                          <span className="text-slate-400">Target: </span>
                          <span className="font-semibold">{log.target}</span>
                        </div>
                      )}

                      {/* Display Phase Tag if present */}
                      {(() => {
                        const parsedArgs = typeof log.args === 'string' ? (() => { try { return JSON.parse(log.args); } catch { return {}; } })() : (log.args || {});
                        const parsedResult = typeof log.result === 'string' ? (() => { try { return JSON.parse(log.result); } catch { return {}; } })() : (log.result || {});
                        const phaseTag = parsedArgs?.phase_tag || parsedResult?.phase_tag;
                        if (!phaseTag) return null;
                        
                        let tagColor = 'bg-cyan-400/20 text-cyan-300 border-cyan-400/40';
                        if (phaseTag.includes('SONUÇ') || phaseTag.includes('TAMAM')) {
                          tagColor = 'bg-emerald-400/20 text-emerald-300 border-emerald-400/40';
                        } else if (phaseTag.includes('TIKLANDI') || phaseTag.includes('FORM')) {
                          tagColor = 'bg-amber-400/20 text-amber-300 border-amber-400/40';
                        }
                        
                        return (
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${tagColor}`}>
                              {phaseTag}
                            </span>
                            {parsedArgs?.description && (
                              <span className="text-[11px] text-slate-300 truncate">
                                {parsedArgs.description}
                              </span>
                            )}
                          </div>
                        );
                      })()}

                      {log.task_run_id && !selectedRunId && (
                        <div className="flex items-center justify-between text-[9px] text-slate-500">
                          <span className="truncate">Run: {log.task_run_id}</span>
                          <button
                            onClick={() => onSelectRunId && onSelectRunId(log.task_run_id || null)}
                            className="text-cyan-400 hover:text-cyan-200 underline shrink-0 ml-2"
                          >
                            Filter Run
                          </button>
                        </div>
                      )}

                      <div className="p-1.5 rounded-xs bg-slate-950 text-[10px] text-slate-400 overflow-x-auto">
                        <span className="text-cyan-300">Args: </span>
                        {typeof log.args === 'string' ? log.args : JSON.stringify(log.args)}
                      </div>

                      {log.result && (
                        <div className="p-1.5 rounded-xs bg-emerald-950/40 border border-emerald-400/20 text-[10px] text-emerald-300 overflow-x-auto">
                          <span className="text-emerald-400">Result: </span>
                          {typeof log.result === 'string' ? log.result : JSON.stringify(log.result)}
                        </div>
                      )}
                    </div>
                  ))
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
