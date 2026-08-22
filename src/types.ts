export type OrionState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface User {
  id: string;
  email: string;
  name: string;
  has_completed_onboarding: boolean;
  email_verified: boolean;
  created_at: string;
}

export interface UserProfileFact {
  id: string;
  user_id?: string;
  category: string;
  key: string;
  value: string;
  confidence?: number;
  updated_at: string;
}

export interface Insight {
  id: string;
  user_id?: string;
  insight_text: string;
  source_type?: string;
  source_id?: string;
  status: 'pending' | 'shown' | 'dismissed';
  created_at: string;
}

export interface Reminder {
  id: string;
  user_id?: string;
  text: string;
  datetime: string;
  status: 'pending' | 'completed';
  created_at: string;
}

export interface Note {
  id: string;
  user_id?: string;
  category: string;
  content: string;
  created_at: string;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  salary_min: number;
  salary_max: number;
  currency: string;
  type: string;
  description: string;
  url: string;
}

export interface Conversation {
  id: string;
  user_id?: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender: 'user' | 'orion' | 'system' | 'tool';
  text: string;
  tool_calls_json?: string;
  task_run_id?: string;
  details_available?: boolean;
  timestamp: string;
}

export interface ToolLog {
  id: string;
  user_id?: string;
  name: string;
  args: any;
  result?: any;
  task_run_id?: string;
  step_index?: number;
  total_steps?: number;
  target?: string;
  timestamp: string;
  status: 'executing' | 'success' | 'failed';
}

export interface GroundingSource {
  web?: {
    uri: string;
    title: string;
  };
}

export interface Contact {
  id: string;
  user_id?: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  relationship?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId?: string;
  internalDate: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  bodyHtml?: string;
  bodyText?: string;
  isUnread: boolean;
  isStarred: boolean;
  isDraft?: boolean;
  isSent?: boolean;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messagesTotal?: number;
  messagesUnread?: number;
}
