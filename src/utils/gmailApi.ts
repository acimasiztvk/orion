import { GmailMessage, GmailProfile, GmailLabel } from '../types';

const GMAIL_BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Base64URL safe decoder that properly handles UTF-8 characters
export function decodeBase64Url(base64Url: string): string {
  try {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (err) {
    try {
      return atob(base64Url.replace(/-/g, '+').replace(/_/g, '/'));
    } catch {
      return '';
    }
  }
}

// Base64URL safe encoder for sending emails (RFC 2822)
export function encodeBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Parse Gmail payload to extract plain body text, HTML, and headers
function parseGmailPayload(payload: any): { bodyText: string; bodyHtml: string } {
  let bodyText = '';
  let bodyHtml = '';

  if (!payload) return { bodyText, bodyHtml };

  const extractParts = (part: any) => {
    if (!part) return;

    const mimeType = part.mimeType || '';
    const data = part.body?.data;

    if (data) {
      const decoded = decodeBase64Url(data);
      if (mimeType.includes('text/plain')) {
        bodyText += decoded;
      } else if (mimeType.includes('text/html')) {
        bodyHtml += decoded;
      }
    }

    if (part.parts && Array.isArray(part.parts)) {
      part.parts.forEach(extractParts);
    }
  };

  extractParts(payload);

  if (!bodyText && bodyHtml) {
    // Strip tags for preview text if only HTML exists
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = bodyHtml;
    bodyText = tempDiv.textContent || tempDiv.innerText || '';
  }

  return { bodyText: bodyText.trim(), bodyHtml: bodyHtml.trim() };
}

// Parse raw Gmail API Message resource to our typed GmailMessage
export function transformGmailResource(raw: any): GmailMessage {
  const headers = raw.payload?.headers || [];
  const getHeader = (name: string) => {
    const h = headers.find((item: any) => item.name?.toLowerCase() === name.toLowerCase());
    return h ? h.value : '';
  };

  const { bodyText, bodyHtml } = parseGmailPayload(raw.payload);
  const labelIds = raw.labelIds || [];

  return {
    id: raw.id,
    threadId: raw.threadId || raw.id,
    labelIds,
    snippet: raw.snippet || '',
    historyId: raw.historyId,
    internalDate: raw.internalDate || String(Date.now()),
    from: getHeader('From') || 'Unknown Sender',
    to: getHeader('To') || '',
    subject: getHeader('Subject') || '(No Subject)',
    date: getHeader('Date') || new Date(Number(raw.internalDate || Date.now())).toLocaleString(),
    bodyHtml,
    bodyText,
    isUnread: labelIds.includes('UNREAD'),
    isStarred: labelIds.includes('STARRED'),
    isDraft: labelIds.includes('DRAFT'),
    isSent: labelIds.includes('SENT'),
  };
}

// 1. Get user profile
export async function getGmailProfile(accessToken: string): Promise<GmailProfile> {
  const res = await fetch(`${GMAIL_BASE_URL}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to load Gmail profile (${res.status}): ${errorText}`);
  }

  return res.json();
}

// 2. List messages with details
export async function listGmailMessages(
  accessToken: string,
  options?: {
    q?: string;
    maxResults?: number;
    pageToken?: string;
    labelIds?: string[];
  }
): Promise<{ messages: GmailMessage[]; nextPageToken?: string; resultSizeEstimate?: number }> {
  const params = new URLSearchParams();
  if (options?.q) params.append('q', options.q);
  if (options?.maxResults) params.append('maxResults', String(options.maxResults));
  if (options?.pageToken) params.append('pageToken', options.pageToken);
  if (options?.labelIds && options.labelIds.length > 0) {
    options.labelIds.forEach((label) => params.append('labelIds', label));
  }

  const url = `${GMAIL_BASE_URL}/messages?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gmail list messages error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const rawList: Array<{ id: string; threadId: string }> = data.messages || [];

  if (rawList.length === 0) {
    return { messages: [], nextPageToken: data.nextPageToken, resultSizeEstimate: 0 };
  }

  // Fetch full details for the top batch in parallel
  const detailPromises = rawList.slice(0, 25).map(async (item) => {
    try {
      return await getGmailMessage(accessToken, item.id);
    } catch (e) {
      console.warn(`[Gmail API] Failed to fetch details for ${item.id}:`, e);
      return null;
    }
  });

  const detailedResults = (await Promise.all(detailPromises)).filter(Boolean) as GmailMessage[];

  return {
    messages: detailedResults,
    nextPageToken: data.nextPageToken,
    resultSizeEstimate: data.resultSizeEstimate,
  };
}

// 3. Get single message details
export async function getGmailMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
  const res = await fetch(`${GMAIL_BASE_URL}/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gmail fetch message ${messageId} error (${res.status}): ${errorText}`);
  }

  const raw = await res.json();
  return transformGmailResource(raw);
}

// 4. Send an email (RFC 2822 format encoded in base64url)
export async function sendGmailMessage(
  accessToken: string,
  params: {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
  }
): Promise<{ id: string; threadId: string; labelIds: string[] }> {
  const { to, subject, body, inReplyTo, references, threadId } = params;

  // Build standard RFC 2822 email
  const headers = [
    `To: ${to}`,
    `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];

  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
  }
  if (references) {
    headers.push(`References: ${references}`);
  }

  const emailRaw = `${headers.join('\r\n')}\r\n\r\n${body}`;
  const rawBase64 = encodeBase64Url(emailRaw);

  const requestBody: any = { raw: rawBase64 };
  if (threadId) {
    requestBody.threadId = threadId;
  }

  const res = await fetch(`${GMAIL_BASE_URL}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gmail send error (${res.status}): ${errorText}`);
  }

  return res.json();
}

// 5. Trash message
export async function trashGmailMessage(accessToken: string, messageId: string): Promise<any> {
  const res = await fetch(`${GMAIL_BASE_URL}/messages/${messageId}/trash`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to trash message (${res.status}): ${errorText}`);
  }

  return res.json();
}

// 6. Delete message permanently
export async function deleteGmailMessage(accessToken: string, messageId: string): Promise<void> {
  const res = await fetch(`${GMAIL_BASE_URL}/messages/${messageId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok && res.status !== 204) {
    const errorText = await res.text();
    throw new Error(`Failed to delete message (${res.status}): ${errorText}`);
  }
}

// 7. Toggle star on message
export async function toggleMessageStar(
  accessToken: string,
  messageId: string,
  currentlyStarred: boolean
): Promise<GmailMessage> {
  const body = currentlyStarred
    ? { removeLabelIds: ['STARRED'] }
    : { addLabelIds: ['STARRED'] };

  const res = await fetch(`${GMAIL_BASE_URL}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to modify star status (${res.status}): ${errorText}`);
  }

  const raw = await res.json();
  return transformGmailResource(raw);
}

// 8. Mark message as read/unread
export async function markMessageRead(
  accessToken: string,
  messageId: string,
  isRead: boolean
): Promise<GmailMessage> {
  const body = isRead
    ? { removeLabelIds: ['UNREAD'] }
    : { addLabelIds: ['UNREAD'] };

  const res = await fetch(`${GMAIL_BASE_URL}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to mark read status (${res.status}): ${errorText}`);
  }

  const raw = await res.json();
  return transformGmailResource(raw);
}

// 9. Create draft
export async function createGmailDraft(
  accessToken: string,
  params: { to: string; subject: string; body: string }
): Promise<any> {
  const emailRaw = `To: ${params.to}\r\nSubject: =?utf-8?B?${btoa(
    unescape(encodeURIComponent(params.subject))
  )}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${params.body}`;

  const rawBase64 = encodeBase64Url(emailRaw);

  const res = await fetch(`${GMAIL_BASE_URL}/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw: rawBase64 } }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to create draft (${res.status}): ${errorText}`);
  }

  return res.json();
}

// 10. List Gmail labels
export async function listGmailLabels(accessToken: string): Promise<GmailLabel[]> {
  const res = await fetch(`${GMAIL_BASE_URL}/labels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to list labels (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return (data.labels || []).map((l: any) => ({
    id: l.id,
    name: l.name,
    type: l.type,
    messagesTotal: l.messagesTotal,
    messagesUnread: l.messagesUnread,
  }));
}
