import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

export interface User {
  id: string;
  email: string;
  name: string;
  google_id?: string;
  auth_provider: 'email' | 'google';
  has_completed_onboarding: boolean;
  email_verified: boolean;
  created_at: string;
}

export interface EmailVerificationCode {
  id: string;
  user_id: string;
  code: string;
  expires_at: string;
  attempts: number;
  created_at: string;
}

export interface UserProfileFact {
  id: string;
  user_id: string;
  category: string;
  key: string;
  value: string;
  confidence?: number;
  updated_at: string;
}

export interface Insight {
  id: string;
  user_id: string;
  insight_text: string;
  source_type?: string;
  source_id?: string;
  status: 'pending' | 'shown' | 'dismissed';
  created_at: string;
}

export interface Reminder {
  id: string;
  user_id: string;
  text: string;
  datetime: string;
  status: 'pending' | 'completed' | 'fired';
  fired_at?: string;
  created_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  category: string;
  content: string;
  created_at: string;
}

export interface Contact {
  id: string;
  user_id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  relationship?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
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
  timestamp: string;
  task_run_id?: string;
  details_available?: boolean;
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

export interface ToolLog {
  id: string;
  user_id: string;
  task_run_id?: string;
  name: string;
  step_index?: number;
  total_steps?: number;
  target?: string;
  args: any;
  result?: any;
  timestamp: string;
  status: 'executing' | 'success' | 'failed';
}

export interface PhoneCall {
  id: string;
  user_id: string;
  vapi_call_id?: string;
  phone_number: string;
  task_description: string;
  context?: string;
  status: string;
  summary?: string;
  transcript?: string;
  requires_user_action: boolean;
  user_action_prompt?: string;
  user_action_response?: string;
  created_at: string;
  updated_at: string;
}

export interface PasswordResetToken {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
  used: boolean;
  created_at: string;
}

export interface RefreshToken {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
  created_at: string;
}

// ----------------------------------------------------
// UNIFIED POSTGRESQL DRIVER (PGlite local + Hosted pg.Pool)
// ----------------------------------------------------

interface DbClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount?: number }>;
  isRemote: boolean;
}

let dbClientInstance: DbClient | null = null;
const PG_DATA_DIR = path.join(process.cwd(), 'orion_postgres_data');

export async function getDb(): Promise<DbClient> {
  if (dbClientInstance) return dbClientInstance;

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && !databaseUrl.includes('sqlite')) {
    console.log('[ORION DB] Connecting to hosted PostgreSQL instance via DATABASE_URL...');
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.NODE_ENV === 'production' && !databaseUrl.includes('localhost') ? { rejectUnauthorized: false } : undefined,
    });

    const client: DbClient = {
      query: async <T = any>(sql: string, params: any[] = []) => {
        const res = await pool.query(sql, params);
        return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
      },
      isRemote: true,
    };

    await initPostgresSchema(client);
    dbClientInstance = client;
    return client;
  }

  // Local PGlite PostgreSQL instance with disk persistence, self-healing recovery & memory fallback
  console.log('[ORION DB] Initializing local PostgreSQL engine (PGlite)...');
  
  let pgliteInstance: PGlite | null = null;
  try {
    if (!fs.existsSync(PG_DATA_DIR)) {
      fs.mkdirSync(PG_DATA_DIR, { recursive: true });
    }
    const pglite = new PGlite(PG_DATA_DIR);
    await pglite.waitReady;
    pgliteInstance = pglite;
    console.log('[ORION DB] Local persistent PostgreSQL storage mounted at', PG_DATA_DIR);
  } catch (diskErr) {
    console.warn('[ORION DB] Persistent PGlite data directory unreadable or locked. Attempting clean recovery...');
    try {
      if (fs.existsSync(PG_DATA_DIR)) {
        fs.rmSync(PG_DATA_DIR, { recursive: true, force: true });
        fs.mkdirSync(PG_DATA_DIR, { recursive: true });
      }
      const pgliteRetry = new PGlite(PG_DATA_DIR);
      await pgliteRetry.waitReady;
      pgliteInstance = pgliteRetry;
      console.log('[ORION DB] Persistent PostgreSQL storage healed and mounted at', PG_DATA_DIR);
    } catch (retryErr) {
      console.warn('[ORION DB] Disk persistent PGlite unavailable, mounting in-memory PostgreSQL engine:', retryErr);
      try {
        const memPglite = new PGlite();
        await memPglite.waitReady;
        pgliteInstance = memPglite;
        console.log('[ORION DB] In-memory PostgreSQL engine online.');
      } catch (memErr) {
        console.error('[ORION DB] Fatal PGlite memory initialization error:', memErr);
        throw memErr;
      }
    }
  }

  const pglite = pgliteInstance!;
  const client: DbClient = {
    query: async <T = any>(sql: string, params: any[] = []) => {
      const res = await pglite.query<T>(sql, params);
      return { rows: res.rows, rowCount: res.rows.length };
    },
    isRemote: false,
  };

  await initPostgresSchema(client);
  dbClientInstance = client;
  return client;
}

async function initPostgresSchema(db: DbClient) {
  // Create all production tables individually to ensure cross-driver compatibility
  const tableStatements = [
    `CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      name VARCHAR(255) NOT NULL,
      google_id VARCHAR(255) UNIQUE,
      auth_provider VARCHAR(32) NOT NULL DEFAULT 'email',
      has_completed_onboarding BOOLEAN NOT NULL DEFAULT FALSE,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS email_verification_codes (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code VARCHAR(16) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(512) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS user_profile (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category VARCHAR(128) NOT NULL,
      key VARCHAR(128) NOT NULL,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.9,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, category, key)
    )`,

    `CREATE TABLE IF NOT EXISTS insights (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      insight_text TEXT NOT NULL,
      source_type VARCHAR(64),
      source_id VARCHAR(64),
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS conversations (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(64) PRIMARY KEY,
      conversation_id VARCHAR(64) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender VARCHAR(32) NOT NULL,
      text TEXT NOT NULL,
      tool_calls_json TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS reminders (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      datetime TEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS notes (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category VARCHAR(128) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS tool_logs (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(128) NOT NULL,
      args_json TEXT NOT NULL,
      result_json TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'success',
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS jobs (
      id VARCHAR(64) PRIMARY KEY,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT NOT NULL,
      salary_min INTEGER NOT NULL,
      salary_max INTEGER NOT NULL,
      currency VARCHAR(16) NOT NULL,
      type VARCHAR(64) NOT NULL,
      description TEXT NOT NULL,
      url TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS phone_calls (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vapi_call_id VARCHAR(128),
      phone_number VARCHAR(64) NOT NULL,
      task_description TEXT NOT NULL,
      context TEXT,
      status VARCHAR(64) NOT NULL DEFAULT 'initiated',
      summary TEXT,
      transcript TEXT,
      requires_user_action BOOLEAN NOT NULL DEFAULT FALSE,
      user_action_prompt TEXT,
      user_action_response TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS contacts (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      phone VARCHAR(64),
      company VARCHAR(255),
      relationship VARCHAR(128),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  ];

  for (const stmt of tableStatements) {
    await db.query(stmt);
  }

  // Schema migrations for existing databases
  try {
    await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE");
    await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32) NOT NULL DEFAULT 'email'");
    await db.query("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL");
    await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE");
  } catch (e) {
    // Migration handled or columns already exist
  }
  try {
    await db.query("ALTER TABLE tool_logs ADD COLUMN IF NOT EXISTS task_run_id VARCHAR(64)");
    await db.query("ALTER TABLE tool_logs ADD COLUMN IF NOT EXISTS step_index INTEGER");
    await db.query("ALTER TABLE tool_logs ADD COLUMN IF NOT EXISTS total_steps INTEGER");
    await db.query("ALTER TABLE tool_logs ADD COLUMN IF NOT EXISTS target TEXT");
    await db.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS task_run_id VARCHAR(64)");
    await db.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS details_available BOOLEAN DEFAULT FALSE");
    await db.query("ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS confidence REAL NOT NULL DEFAULT 0.9");
    await db.query("ALTER TABLE reminders ADD COLUMN IF NOT EXISTS fired_at TIMESTAMPTZ");
    await db.query("CREATE INDEX IF NOT EXISTS idx_messages_conv_timestamp ON messages (conversation_id, timestamp ASC)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations (user_id, updated_at DESC)");
  } catch (e) {
    // Migration handled
  }

  // Seed default Demo user if not present
  const userCheck = await db.query("SELECT id, email FROM users WHERE email = $1", ['tony@stark.ai']);
  const now = new Date().toISOString();
  const demoHash = bcrypt.hashSync('iamironman', 10);

  if (userCheck.rows.length === 0) {
    await db.query(
      `INSERT INTO users (id, email, password_hash, name, has_completed_onboarding, email_verified, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, TRUE, TRUE, $5, $5)
       ON CONFLICT (id) DO UPDATE SET email_verified = TRUE`,
      ['user_tony', 'tony@stark.ai', demoHash, 'Tony Stark', now]
    );

    // Seed Tony Stark profile facts
    const tonyFacts = [
      { id: 'p1', cat: 'identity', key: 'designation', val: 'Chief Architect & Commander' },
      { id: 'p2', cat: 'preference', key: 'preferred_tone', val: 'Concise, witty, JARVIS-style executive clarity' },
      { id: 'p3', cat: 'tech_stack', key: 'primary_interests', val: 'Artificial Intelligence, Robotics, Arc Reactor Tech, Quantum Systems' },
      { id: 'p4', cat: 'goals', key: 'current_focus', val: 'Next-generation autonomous clean energy and quantum telemetry' }
    ];

    for (const f of tonyFacts) {
      await db.query(
        `INSERT INTO user_profile (id, user_id, category, key, value, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, category, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [f.id, 'user_tony', f.cat, f.key, f.val, now]
      );
    }

    // Seed conversation for Tony
    await db.query(
      `INSERT INTO conversations (id, user_id, title, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (id) DO NOTHING`,
      ['conv_tony_init', 'user_tony', 'Stark Core Telemetry Session', now]
    );

    await db.query(
      `INSERT INTO messages (id, conversation_id, sender, text, tool_calls_json, timestamp) 
       VALUES ($1, $2, $3, $4, NULL, $5)
       ON CONFLICT (id) DO NOTHING`,
      ['msg_tony_1', 'conv_tony_init', 'orion', 'Welcome back, Sir. All suit systems, PostgreSQL telemetry, and laboratory neural channels are online.', now]
    );
  }

  // Seed sample jobs if empty
  const jobCheck = await db.query("SELECT COUNT(*) as count FROM jobs");
  const jobCount = parseInt(jobCheck.rows[0]?.count || '0', 10);
  if (jobCount === 0) {
    const sampleJobs = [
      {
        id: 'job_1',
        title: 'Lead Autonomous Systems & AI Engineer',
        company: 'Stark Industries Advanced Dynamics',
        location: 'San Francisco, CA (Hybrid / Remote)',
        salary_min: 220000,
        salary_max: 310000,
        currency: 'USD',
        type: 'Full-time',
        description: 'Lead next-generation multi-agent control loops, multimodal sensory fusion, and real-time telemetry systems.',
        url: 'https://careers.google.com'
      },
      {
        id: 'job_2',
        title: 'Principal Multimodal AI Researcher',
        company: 'Nexus Quantum Laboratories',
        location: 'New York, NY (On-site / Hybrid)',
        salary_min: 250000,
        salary_max: 360000,
        currency: 'USD',
        type: 'Full-time',
        description: 'Conduct pioneering research in ultra-low latency voice-to-voice streaming architectures and persistent cognitive architectures.',
        url: 'https://deepmind.google'
      },
      {
        id: 'job_3',
        title: 'Senior Embedded Robotics & Firmware Specialist',
        company: 'AeroStark Flight Systems',
        location: 'Austin, TX (Remote)',
        salary_min: 185000,
        salary_max: 260000,
        currency: 'USD',
        type: 'Full-time',
        description: 'Architect embedded sensor fusion nodes, microsecond actuation controls, and secure telemetry relays.',
        url: 'https://github.com/careers'
      }
    ];

    for (const job of sampleJobs) {
      await db.query(
        `INSERT INTO jobs (id, title, company, location, salary_min, salary_max, currency, type, description, url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [job.id, job.title, job.company, job.location, job.salary_min, job.salary_max, job.currency, job.type, job.description, job.url]
      );
    }
  }

  // Seed default core contacts if empty
  const contactCheck = await db.query("SELECT COUNT(*) as count FROM contacts");
  const contactCount = parseInt(contactCheck.rows[0]?.count || '0', 10);
  if (contactCount === 0) {
    const defaultContacts = [
      {
        id: 'contact_rifat_1',
        user_id: 'user_tony',
        name: 'Rıfat Sağın',
        email: 'rifat@example.com',
        phone: '05320000000',
        company: 'Stark Quantum Neural Labs',
        relationship: 'Colleague / Tech Lead',
        notes: 'Lead systems architect and primary operational collaborator.'
      },
      {
        id: 'contact_sarah_2',
        user_id: 'user_tony',
        name: 'Dr. Sarah Connor',
        email: 'sarah.connor@cyberdyne.org',
        phone: '+1 555-019-2834',
        company: 'Cyberdyne Systems',
        relationship: 'Strategic Advisor',
        notes: 'Autonomous systems security and threat mitigation consultant.'
      }
    ];

    for (const c of defaultContacts) {
      await db.query(
        `INSERT INTO contacts (id, user_id, name, email, phone, company, relationship, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.user_id, c.name, c.email, c.phone, c.company, c.relationship, c.notes]
      );
    }
  }
}

// ----------------------------------------------------
// VALIDATION & AUTH UTILITIES
// ----------------------------------------------------

const COMMON_WEAK_PASSWORDS = new Set([
  'password', 'password123', '12345678', '123456789', 'qwerty123',
  'admin123', 'welcome123', 'pass1234', 'iloveyou', 'letmein123',
  'stark123', 'orion123', '12345678a', 'abcdefgh'
]);

export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters in length' };
  }
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase().trim())) {
    return { valid: false, error: 'Password is too common or easily guessable. Please choose a stronger password.' };
  }
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumberOrSymbol = /[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  if (!hasLetter || !hasNumberOrSymbol) {
    return { valid: false, error: 'Password must contain at least one letter and at least one number or special character.' };
  }
  return { valid: true };
}

export function validateEmailFormat(email: string): { valid: boolean; error?: string } {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email address is required' };
  }
  const trimmed = email.trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Please provide a valid email address (e.g., commander@stark.ai)' };
  }
  return { valid: true };
}

// ----------------------------------------------------
// USER REPOSITORY
// ----------------------------------------------------

export async function createUser(email: string, plainPassword: string, name?: string): Promise<User> {
  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();

  // Validate email
  const emailVal = validateEmailFormat(normalizedEmail);
  if (!emailVal.valid) {
    throw new Error(emailVal.error);
  }

  // Validate password
  const passVal = validatePasswordStrength(plainPassword);
  if (!passVal.valid) {
    throw new Error(passVal.error);
  }

  // Check duplicate email
  const existing = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existing.rows.length > 0) {
    throw new Error('An account with this email address already exists. Please log in or request a password reset.');
  }

  const id = `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const passwordHash = await bcrypt.hash(plainPassword, 10);
  const displayName = name?.trim() || normalizedEmail.split('@')[0];
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO users (id, email, password_hash, name, auth_provider, has_completed_onboarding, email_verified, created_at, updated_at) 
     VALUES ($1, $2, $3, $4, 'email', FALSE, FALSE, $5, $5)`,
    [id, normalizedEmail, passwordHash, displayName, now]
  );

  return {
    id,
    email: normalizedEmail,
    name: displayName,
    auth_provider: 'email',
    has_completed_onboarding: false,
    email_verified: false,
    created_at: now
  };
}

export async function authenticateUser(email: string, plainPassword: string): Promise<User | null> {
  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const res = await db.query(
    'SELECT id, email, password_hash, name, google_id, auth_provider, has_completed_onboarding, email_verified, created_at FROM users WHERE email = $1',
    [normalizedEmail]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0];

  if (!row.password_hash) {
    // User registered via Google OAuth without password
    return null;
  }

  const match = await bcrypt.compare(plainPassword, row.password_hash);
  if (!match) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    google_id: row.google_id || undefined,
    auth_provider: (row.auth_provider as 'email' | 'google') || 'email',
    has_completed_onboarding: Boolean(row.has_completed_onboarding),
    email_verified: Boolean(row.email_verified),
    created_at: row.created_at
  };
}

export async function getUserById(id: string): Promise<User | null> {
  const db = await getDb();
  const res = await db.query(
    'SELECT id, email, name, google_id, auth_provider, has_completed_onboarding, email_verified, created_at FROM users WHERE id = $1',
    [id]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    google_id: row.google_id || undefined,
    auth_provider: (row.auth_provider as 'email' | 'google') || 'email',
    has_completed_onboarding: Boolean(row.has_completed_onboarding),
    email_verified: Boolean(row.email_verified),
    created_at: row.created_at
  };
}

export async function findOrCreateOAuthUser(email: string, name?: string, googleId?: string): Promise<User> {
  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date().toISOString();

  // If googleId provided, try finding by google_id first
  if (googleId) {
    const googleCheck = await db.query(
      'SELECT id, email, name, google_id, auth_provider, has_completed_onboarding, email_verified, created_at FROM users WHERE google_id = $1',
      [googleId]
    );
    if (googleCheck.rows.length > 0) {
      const row = googleCheck.rows[0];
      return {
        id: row.id,
        email: row.email,
        name: row.name || name || normalizedEmail.split('@')[0],
        google_id: row.google_id,
        auth_provider: 'google',
        has_completed_onboarding: Boolean(row.has_completed_onboarding),
        email_verified: true,
        created_at: row.created_at
      };
    }
  }

  // Check if user exists by email
  const res = await db.query(
    'SELECT id, email, name, google_id, auth_provider, has_completed_onboarding, email_verified, created_at FROM users WHERE email = $1',
    [normalizedEmail]
  );

  if (res.rows.length > 0) {
    const row = res.rows[0];
    const targetGoogleId = googleId || row.google_id || null;
    await db.query(
      'UPDATE users SET email_verified = TRUE, google_id = COALESCE($1, google_id), updated_at = $2 WHERE id = $3',
      [targetGoogleId, now, row.id]
    );
    return {
      id: row.id,
      email: row.email,
      name: row.name || name || normalizedEmail.split('@')[0],
      google_id: targetGoogleId || undefined,
      auth_provider: row.auth_provider || 'google',
      has_completed_onboarding: Boolean(row.has_completed_onboarding),
      email_verified: true,
      created_at: row.created_at
    };
  }

  const id = `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const displayName = name?.trim() || normalizedEmail.split('@')[0];

  await db.query(
    `INSERT INTO users (id, email, password_hash, name, google_id, auth_provider, has_completed_onboarding, email_verified, created_at, updated_at) 
     VALUES ($1, $2, NULL, $3, $4, 'google', FALSE, TRUE, $5, $5)`,
    [id, normalizedEmail, displayName, googleId || null, now]
  );

  return {
    id,
    email: normalizedEmail,
    name: displayName,
    google_id: googleId || undefined,
    auth_provider: 'google',
    has_completed_onboarding: false,
    email_verified: true,
    created_at: now
  };
}

export async function setUserEmailVerified(userId: string, verified: boolean = true): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.query(
    'UPDATE users SET email_verified = $1, updated_at = $2 WHERE id = $3',
    [verified, now, userId]
  );
}

export async function createEmailVerificationCode(userId: string): Promise<string> {
  const db = await getDb();
  // Generate random 6-digit numeric code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const id = `evc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  // 10 minutes expiry
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO email_verification_codes (id, user_id, code, expires_at, attempts, created_at)
     VALUES ($1, $2, $3, $4, 0, $5)`,
    [id, userId, code, expiresAt, now]
  );

  return code;
}

export async function getLastVerificationCodeTime(userId: string): Promise<Date | null> {
  const db = await getDb();
  const res = await db.query(
    'SELECT created_at FROM email_verification_codes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  if (res.rows.length === 0) return null;
  return new Date(res.rows[0].created_at);
}

export async function verifyEmailCode(userId: string, inputCode: string): Promise<{ success: boolean; error?: string; user?: User }> {
  const db = await getDb();
  const trimmedCode = (inputCode || '').trim();

  if (!trimmedCode || trimmedCode.length !== 6) {
    return { success: false, error: 'Please enter a valid 6-digit verification code.' };
  }

  // Find latest active code
  const res = await db.query(
    'SELECT id, code, expires_at, attempts FROM email_verification_codes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );

  if (res.rows.length === 0) {
    return { success: false, error: 'No verification code found. Please request a new code.' };
  }

  const record = res.rows[0];
  const expiresAt = new Date(record.expires_at).getTime();
  const now = Date.now();

  if (now > expiresAt) {
    return { success: false, error: 'Verification code has expired. Please request a new code.' };
  }

  if (record.attempts >= 5) {
    return { success: false, error: 'Too many incorrect attempts. Please request a new verification code.' };
  }

  if (record.code !== trimmedCode) {
    await db.query('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1', [record.id]);
    return { success: false, error: 'Incorrect verification code. Please check your email and try again.' };
  }

  // Correct code -> verify user and delete used verification codes
  await setUserEmailVerified(userId, true);
  await db.query('DELETE FROM email_verification_codes WHERE user_id = $1', [userId]);

  const verifiedUser = await getUserById(userId);
  if (!verifiedUser) {
    return { success: false, error: 'User account not found.' };
  }

  return { success: true, user: verifiedUser };
}

export async function completeUserOnboarding(userId: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.query(
    'UPDATE users SET has_completed_onboarding = TRUE, updated_at = $1 WHERE id = $2',
    [now, userId]
  );
}

// ----------------------------------------------------
// PASSWORD RESET & REFRESH TOKENS
// ----------------------------------------------------

export async function createPasswordResetToken(email: string): Promise<{ token: string; user: User } | null> {
  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const res = await db.query('SELECT id, email, name, has_completed_onboarding, created_at FROM users WHERE email = $1', [normalizedEmail]);
  if (res.rows.length === 0) return null;
  const user = res.rows[0];

  const token = `rst_${Date.now()}_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;
  const tokenId = `prt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  // 1 hour expiry
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used, created_at)
     VALUES ($1, $2, $3, $4, FALSE, $5)`,
    [tokenId, user.id, token, expiresAt, now]
  );

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      email_verified: Boolean(user.email_verified),
      has_completed_onboarding: Boolean(user.has_completed_onboarding),
      auth_provider: (user.auth_provider as 'email' | 'google') || 'email',
      created_at: user.created_at
    }
  };
}

export async function resetPasswordWithToken(token: string, newPlainPassword: string): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();

  const passVal = validatePasswordStrength(newPlainPassword);
  if (!passVal.valid) {
    return { success: false, error: passVal.error };
  }

  const res = await db.query(
    'SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = $1',
    [token]
  );

  if (res.rows.length === 0) {
    return { success: false, error: 'Invalid or expired password reset token.' };
  }

  const record = res.rows[0];
  if (record.used) {
    return { success: false, error: 'This reset token has already been used.' };
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    return { success: false, error: 'This reset token has expired. Please request a new one.' };
  }

  const newHash = await bcrypt.hash(newPlainPassword, 10);
  const now = new Date().toISOString();

  await db.query('UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3', [newHash, now, record.user_id]);
  await db.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [record.id]);

  return { success: true };
}

export async function saveRefreshToken(userId: string, token: string, expiresAt: Date): Promise<void> {
  const db = await getDb();
  const id = `rft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  await db.query(
    `INSERT INTO refresh_tokens (id, user_id, token, expires_at, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
    [id, userId, token, expiresAt.toISOString()]
  );
}

export async function verifyAndRotateRefreshToken(oldToken: string): Promise<User | null> {
  const db = await getDb();
  const res = await db.query(
    `SELECT rt.id, rt.user_id, rt.expires_at, u.id as u_id, u.email, u.name, u.email_verified, u.has_completed_onboarding, u.auth_provider, u.created_at
     FROM refresh_tokens rt
     JOIN users u ON rt.user_id = u.id
     WHERE rt.token = $1`,
    [oldToken]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0];

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.query('DELETE FROM refresh_tokens WHERE id = $1', [row.id]);
    return null;
  }

  return {
    id: row.u_id,
    email: row.email,
    name: row.name,
    email_verified: Boolean(row.email_verified),
    has_completed_onboarding: Boolean(row.has_completed_onboarding),
    auth_provider: (row.auth_provider as 'email' | 'google') || 'email',
    created_at: row.created_at
  };
}

export async function deleteRefreshToken(token: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
}

// ----------------------------------------------------
// USER PROFILE REPOSITORY (Flexible Key-Value Store)
// ----------------------------------------------------

export async function getUserProfileFacts(userId: string): Promise<UserProfileFact[]> {
  const db = await getDb();
  const res = await db.query(
    'SELECT id, user_id, category, key, value, confidence, updated_at FROM user_profile WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  return res.rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    category: r.category,
    key: r.key,
    value: r.value,
    confidence: typeof r.confidence === 'number' ? r.confidence : parseFloat(r.confidence || '0.9'),
    updated_at: typeof r.updated_at === 'object' ? r.updated_at.toISOString() : String(r.updated_at)
  }));
}

export async function saveProfileFact(userId: string, category: string, key: string, value: string, confidence: number = 0.9): Promise<UserProfileFact> {
  const db = await getDb();
  const id = `fact_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO user_profile (id, user_id, category, key, value, confidence, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, category, key) 
     DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = EXCLUDED.updated_at`,
    [id, userId, category, key, value, confidence, now]
  );

  return { id, user_id: userId, category, key, value, confidence, updated_at: now };
}

export async function deleteProfileFact(id: string, userId: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM user_profile WHERE id = $1 AND user_id = $2', [id, userId]);
}

// ----------------------------------------------------
// INSIGHTS REPOSITORY (Background Context Synthesis)
// ----------------------------------------------------

export async function saveInsight(
  userId: string,
  insightText: string,
  sourceType?: string,
  sourceId?: string
): Promise<Insight> {
  const db = await getDb();
  const id = `insight_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO insights (id, user_id, insight_text, source_type, source_id, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
    [id, userId, insightText, sourceType || null, sourceId || null, now]
  );

  return {
    id,
    user_id: userId,
    insight_text: insightText,
    source_type: sourceType,
    source_id: sourceId,
    status: 'pending',
    created_at: now
  };
}

export async function getPendingInsights(userId: string): Promise<Insight[]> {
  const db = await getDb();
  const res = await db.query(
    `SELECT * FROM insights WHERE user_id = $1 AND status = 'pending' ORDER BY created_at ASC`,
    [userId]
  );
  return res.rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    insight_text: r.insight_text,
    source_type: r.source_type || undefined,
    source_id: r.source_id || undefined,
    status: r.status,
    created_at: typeof r.created_at === 'object' ? r.created_at.toISOString() : String(r.created_at)
  }));
}

export async function markInsightShown(id: string): Promise<void> {
  const db = await getDb();
  await db.query(`UPDATE insights SET status = 'shown' WHERE id = $1`, [id]);
}

export async function markInsightDismissed(id: string): Promise<void> {
  const db = await getDb();
  await db.query(`UPDATE insights SET status = 'dismissed' WHERE id = $1`, [id]);
}

// ----------------------------------------------------
// REMINDERS & NOTES
// ----------------------------------------------------

export async function getReminders(userId: string): Promise<Reminder[]> {
  const db = await getDb();
  const res = await db.query(
    'SELECT id, user_id, text, datetime, status, fired_at, created_at FROM reminders WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return res.rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    text: r.text,
    datetime: r.datetime,
    status: r.status,
    fired_at: r.fired_at ? (typeof r.fired_at === 'object' ? r.fired_at.toISOString() : String(r.fired_at)) : undefined,
    created_at: typeof r.created_at === 'object' ? r.created_at.toISOString() : String(r.created_at)
  }));
}

export async function saveReminder(userId: string, text: string, datetime: string): Promise<Reminder> {
  const db = await getDb();
  const id = `rem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO reminders (id, user_id, text, datetime, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, userId, text, datetime, 'pending', now]
  );
  return { id, user_id: userId, text, datetime, status: 'pending', created_at: now };
}

export async function toggleReminderStatus(id: string, userId: string): Promise<void> {
  const db = await getDb();
  const res = await db.query('SELECT status FROM reminders WHERE id = $1 AND user_id = $2', [id, userId]);
  if (res.rows.length === 0) return;
  const current = res.rows[0].status;
  const next = current === 'completed' ? 'pending' : 'completed';
  await db.query('UPDATE reminders SET status = $1 WHERE id = $2 AND user_id = $3', [next, id, userId]);
}

export async function deleteReminder(id: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM reminders WHERE id = $1', [id]);
}

export async function getNotes(userId: string): Promise<Note[]> {
  const db = await getDb();
  const res = await db.query(
    'SELECT id, user_id, category, content, created_at FROM notes WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return res.rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    category: r.category,
    content: r.content,
    created_at: typeof r.created_at === 'object' ? r.created_at.toISOString() : String(r.created_at)
  }));
}

export async function saveNote(userId: string, category: string, content: string): Promise<Note> {
  const db = await getDb();
  const id = `note_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO notes (id, user_id, category, content, created_at) VALUES ($1, $2, $3, $4, $5)',
    [id, userId, category, content, now]
  );
  return { id, user_id: userId, category, content, created_at: now };
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM notes WHERE id = $1', [id]);
}

// ----------------------------------------------------
// CONVERSATIONS & MESSAGES
// ----------------------------------------------------

export async function getConversations(userId: string): Promise<Conversation[]> {
  const db = await getDb();
  const res = await db.query(
    'SELECT id, user_id, title, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  return res.rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    title: r.title,
    created_at: typeof r.created_at === 'object' ? r.created_at.toISOString() : String(r.created_at),
    updated_at: typeof r.updated_at === 'object' ? r.updated_at.toISOString() : String(r.updated_at)
  }));
}

export async function createConversation(userId: string, title?: string): Promise<Conversation> {
  const db = await getDb();
  const id = `conv_${userId}_${Date.now()}`;
  const now = new Date().toISOString();
  const t = title || `Tactical Session ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  await db.query(
    'INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
    [id, userId, t, now]
  );
  return { id, user_id: userId, title: t, created_at: now, updated_at: now };
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM messages WHERE conversation_id = $1', [id]);
  await db.query('DELETE FROM conversations WHERE id = $1', [id]);
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const db = await getDb();
  const res = await db.query(
    'SELECT id, conversation_id, sender, text, tool_calls_json, timestamp, task_run_id, details_available FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
    [conversationId]
  );
  return res.rows.map(r => ({
    id: r.id,
    conversation_id: r.conversation_id,
    sender: r.sender,
    text: r.text,
    tool_calls_json: r.tool_calls_json,
    timestamp: typeof r.timestamp === 'object' ? r.timestamp.toISOString() : String(r.timestamp),
    task_run_id: r.task_run_id || undefined,
    details_available: Boolean(r.details_available)
  }));
}

export async function saveMessage(
  conversationId: string,
  sender: 'user' | 'orion' | 'system' | 'tool',
  text: string,
  toolCallsJson?: string,
  taskRunId?: string,
  detailsAvailable?: boolean,
  userId?: string
): Promise<Message> {
  const db = await getDb();
  const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();

  // Ensure conversation exists
  const convCheck = await db.query('SELECT id, user_id FROM conversations WHERE id = $1', [conversationId]);
  if (convCheck.rows.length === 0) {
    let targetUserId = userId || 'user_tony';
    if (!userId && conversationId.startsWith('conv_')) {
      const parts = conversationId.split('_');
      if (parts.length >= 3) {
        targetUserId = parts.slice(1, -1).join('_');
      }
    }
    const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [targetUserId]);
    if (userCheck.rows.length === 0) {
      targetUserId = userId || 'user_tony';
    }

    await db.query(
      'INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
      [conversationId, targetUserId, 'Session', now]
    );
  } else {
    await db.query('UPDATE conversations SET updated_at = $1 WHERE id = $2', [now, conversationId]);
  }

  await db.query(
    'INSERT INTO messages (id, conversation_id, sender, text, tool_calls_json, timestamp, task_run_id, details_available) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [id, conversationId, sender, text, toolCallsJson || null, now, taskRunId || null, detailsAvailable ? true : false]
  );

  return {
    id,
    conversation_id: conversationId,
    sender,
    text,
    tool_calls_json: toolCallsJson,
    timestamp: now,
    task_run_id: taskRunId,
    details_available: detailsAvailable
  };
}

// ----------------------------------------------------
// JOBS & TOOL LOGS
// ----------------------------------------------------

export async function searchJobs(query?: string, location?: string, salaryMin?: number): Promise<Job[]> {
  const db = await getDb();
  let sql = 'SELECT * FROM jobs WHERE 1=1';
  const params: any[] = [];

  if (query) {
    params.push(`%${query.toLowerCase()}%`);
    sql += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(description) LIKE $${params.length} OR LOWER(company) LIKE $${params.length})`;
  }
  if (location) {
    params.push(`%${location.toLowerCase()}%`);
    sql += ` AND LOWER(location) LIKE $${params.length}`;
  }
  if (salaryMin) {
    params.push(salaryMin);
    sql += ` AND salary_max >= $${params.length}`;
  }

  sql += ' ORDER BY salary_max DESC LIMIT 10';
  const res = await db.query(sql, params);
  return res.rows;
}

export async function logToolExecution(
  userId: string,
  name: string,
  args: any,
  result?: any,
  status: 'executing' | 'success' | 'failed' = 'success',
  meta?: {
    task_run_id?: string;
    step_index?: number;
    total_steps?: number;
    target?: string;
  }
): Promise<string> {
  try {
    const db = await getDb();
    const id = `tlog_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    await db.query(
      'INSERT INTO tool_logs (id, user_id, name, args_json, result_json, status, timestamp, task_run_id, step_index, total_steps, target) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [
        id,
        userId,
        name,
        JSON.stringify(args),
        result ? JSON.stringify(result) : null,
        status,
        now,
        meta?.task_run_id || null,
        meta?.step_index != null ? meta.step_index : null,
        meta?.total_steps != null ? meta.total_steps : null,
        meta?.target || null
      ]
    );
    return id;
  } catch (err) {
    console.error('Failed to log tool execution:', err);
    return '';
  }
}

export async function getToolLogs(userId: string, taskRunId?: string): Promise<ToolLog[]> {
  const db = await getDb();
  let sql = 'SELECT id, user_id, name, args_json, result_json, status, timestamp, task_run_id, step_index, total_steps, target FROM tool_logs WHERE user_id = $1';
  const params: any[] = [userId];
  if (taskRunId) {
    params.push(taskRunId);
    sql += ` AND task_run_id = $${params.length}`;
    sql += ' ORDER BY step_index ASC, timestamp ASC LIMIT 100';
  } else {
    sql += ' ORDER BY timestamp DESC LIMIT 50';
  }

  const res = await db.query(sql, params);
  return res.rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    task_run_id: r.task_run_id || undefined,
    name: r.name,
    step_index: r.step_index != null ? Number(r.step_index) : undefined,
    total_steps: r.total_steps != null ? Number(r.total_steps) : undefined,
    target: r.target || undefined,
    args: JSON.parse(r.args_json || '{}'),
    result: r.result_json ? JSON.parse(r.result_json) : undefined,
    status: r.status,
    timestamp: typeof r.timestamp === 'object' ? r.timestamp.toISOString() : String(r.timestamp)
  }));
}

// ----------------------------------------------------
// PHONE CALL MANAGEMENT & PERSISTENCE
// ----------------------------------------------------

export async function savePhoneCall(
  userId: string,
  phoneNumber: string,
  taskDescription: string,
  context?: string,
  vapiCallId?: string,
  status: string = 'initiated'
): Promise<PhoneCall> {
  const db = await getDb();
  const id = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO phone_calls (id, user_id, vapi_call_id, phone_number, task_description, context, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [id, userId, vapiCallId || null, phoneNumber, taskDescription, context || null, status, now]
  );

  return {
    id,
    user_id: userId,
    vapi_call_id: vapiCallId,
    phone_number: phoneNumber,
    task_description: taskDescription,
    context,
    status,
    requires_user_action: false,
    created_at: now,
    updated_at: now
  };
}

export async function updatePhoneCall(
  id: string,
  updates: Partial<PhoneCall>
): Promise<PhoneCall | null> {
  const db = await getDb();
  const now = new Date().toISOString();

  const setClauses: string[] = ['updated_at = $1'];
  const values: any[] = [now];
  let idx = 2;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.vapi_call_id !== undefined) {
    setClauses.push(`vapi_call_id = $${idx++}`);
    values.push(updates.vapi_call_id);
  }
  if (updates.summary !== undefined) {
    setClauses.push(`summary = $${idx++}`);
    values.push(updates.summary);
  }
  if (updates.transcript !== undefined) {
    setClauses.push(`transcript = $${idx++}`);
    values.push(updates.transcript);
  }
  if (updates.requires_user_action !== undefined) {
    setClauses.push(`requires_user_action = $${idx++}`);
    values.push(updates.requires_user_action);
  }
  if (updates.user_action_prompt !== undefined) {
    setClauses.push(`user_action_prompt = $${idx++}`);
    values.push(updates.user_action_prompt);
  }
  if (updates.user_action_response !== undefined) {
    setClauses.push(`user_action_response = $${idx++}`);
    values.push(updates.user_action_response);
  }

  values.push(id);
  const sql = `UPDATE phone_calls SET ${setClauses.join(', ')} WHERE id = $${idx} OR vapi_call_id = $${idx} RETURNING *`;
  const res = await db.query(sql, values);

  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    user_id: r.user_id,
    vapi_call_id: r.vapi_call_id,
    phone_number: r.phone_number,
    task_description: r.task_description,
    context: r.context,
    status: r.status,
    summary: r.summary,
    transcript: r.transcript,
    requires_user_action: r.requires_user_action,
    user_action_prompt: r.user_action_prompt,
    user_action_response: r.user_action_response,
    created_at: typeof r.created_at === 'object' ? r.created_at.toISOString() : String(r.created_at),
    updated_at: typeof r.updated_at === 'object' ? r.updated_at.toISOString() : String(r.updated_at)
  };
}

export async function getPhoneCalls(userId: string): Promise<PhoneCall[]> {
  const db = await getDb();
  const res = await db.query(
    'SELECT * FROM phone_calls WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30',
    [userId]
  );
  return res.rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    vapi_call_id: r.vapi_call_id,
    phone_number: r.phone_number,
    task_description: r.task_description,
    context: r.context,
    status: r.status,
    summary: r.summary,
    transcript: r.transcript,
    requires_user_action: r.requires_user_action,
    user_action_prompt: r.user_action_prompt,
    user_action_response: r.user_action_response,
    created_at: typeof r.created_at === 'object' ? r.created_at.toISOString() : String(r.created_at),
    updated_at: typeof r.updated_at === 'object' ? r.updated_at.toISOString() : String(r.updated_at)
  }));
}

export async function getPhoneCallById(id: string): Promise<PhoneCall | null> {
  const db = await getDb();
  const res = await db.query(
    'SELECT * FROM phone_calls WHERE id = $1 OR vapi_call_id = $1 LIMIT 1',
    [id]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    user_id: r.user_id,
    vapi_call_id: r.vapi_call_id,
    phone_number: r.phone_number,
    task_description: r.task_description,
    context: r.context,
    status: r.status,
    summary: r.summary,
    transcript: r.transcript,
    requires_user_action: r.requires_user_action,
    user_action_prompt: r.user_action_prompt,
    user_action_response: r.user_action_response,
    created_at: typeof r.created_at === 'object' ? r.created_at.toISOString() : String(r.created_at),
    updated_at: typeof r.updated_at === 'object' ? r.updated_at.toISOString() : String(r.updated_at)
  };
}

export async function getPendingDecisionCalls(userId: string): Promise<PhoneCall[]> {
  const db = await getDb();
  const res = await db.query(
    'SELECT * FROM phone_calls WHERE user_id = $1 AND requires_user_action = TRUE ORDER BY updated_at DESC',
    [userId]
  );
  return res.rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    vapi_call_id: r.vapi_call_id,
    phone_number: r.phone_number,
    task_description: r.task_description,
    context: r.context,
    status: r.status,
    summary: r.summary,
    transcript: r.transcript,
    requires_user_action: r.requires_user_action,
    user_action_prompt: r.user_action_prompt,
    user_action_response: r.user_action_response,
    created_at: typeof r.created_at === 'object' ? r.created_at.toISOString() : String(r.created_at),
    updated_at: typeof r.updated_at === 'object' ? r.updated_at.toISOString() : String(r.updated_at)
  }));
}

// ----------------------------------------------------
// CONTACT BOOK HELPERS (PERSISTENT CONTACT REGISTRY)
// ----------------------------------------------------

export async function getContacts(userId?: string): Promise<Contact[]> {
  const db = await getDb();
  let sql = 'SELECT * FROM contacts ORDER BY name ASC';
  const params: any[] = [];
  if (userId) {
    sql = 'SELECT * FROM contacts WHERE user_id = $1 OR user_id = $2 ORDER BY name ASC';
    params.push(userId, 'user_tony');
  }
  const res = await db.query(sql, params);
  return res.rows.map((r: any) => ({
    id: r.id,
    user_id: r.user_id,
    name: r.name,
    email: r.email || undefined,
    phone: r.phone || undefined,
    company: r.company || undefined,
    relationship: r.relationship || undefined,
    notes: r.notes || undefined,
    created_at: typeof r.created_at === 'object' ? r.created_at.toISOString() : String(r.created_at),
    updated_at: typeof r.updated_at === 'object' ? r.updated_at.toISOString() : String(r.updated_at)
  }));
}

export async function getContactById(id: string): Promise<Contact | null> {
  const db = await getDb();
  const res = await db.query('SELECT * FROM contacts WHERE id = $1 LIMIT 1', [id]);
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    user_id: r.user_id,
    name: r.name,
    email: r.email || undefined,
    phone: r.phone || undefined,
    company: r.company || undefined,
    relationship: r.relationship || undefined,
    notes: r.notes || undefined,
    created_at: typeof r.created_at === 'object' ? r.created_at.toISOString() : String(r.created_at),
    updated_at: typeof r.updated_at === 'object' ? r.updated_at.toISOString() : String(r.updated_at)
  };
}

export async function createOrUpdateContact(
  userId: string,
  data: {
    id?: string;
    name: string;
    email?: string;
    phone?: string;
    company?: string;
    relationship?: string;
    notes?: string;
  }
): Promise<Contact> {
  const db = await getDb();
  const contactId = data.id || `contact_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();

  // Check if contact with same name or email exists for user
  const existing = await db.query(
    'SELECT * FROM contacts WHERE (id = $1) OR (user_id = $2 AND LOWER(name) = LOWER($3)) LIMIT 1',
    [contactId, userId, data.name.trim()]
  );

  if (existing.rows.length > 0) {
    const existingId = existing.rows[0].id;
    await db.query(
      `UPDATE contacts 
       SET name = $1, email = COALESCE($2, email), phone = COALESCE($3, phone), 
           company = COALESCE($4, company), relationship = COALESCE($5, relationship), 
           notes = COALESCE($6, notes), updated_at = $7
       WHERE id = $8`,
      [
        data.name.trim(),
        data.email?.trim() || null,
        data.phone?.trim() || null,
        data.company?.trim() || null,
        data.relationship?.trim() || null,
        data.notes?.trim() || null,
        now,
        existingId
      ]
    );
    const updated = await getContactById(existingId);
    return updated!;
  } else {
    await db.query(
      `INSERT INTO contacts (id, user_id, name, email, phone, company, relationship, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [
        contactId,
        userId,
        data.name.trim(),
        data.email?.trim() || null,
        data.phone?.trim() || null,
        data.company?.trim() || null,
        data.relationship?.trim() || null,
        data.notes?.trim() || null,
        now
      ]
    );
    const created = await getContactById(contactId);
    return created!;
  }
}

export async function deleteContact(userId: string, idOrName: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.query(
    'DELETE FROM contacts WHERE (id = $1 OR LOWER(name) = LOWER($1)) AND (user_id = $2 OR user_id = $3)',
    [idOrName.trim(), userId, 'user_tony']
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Intelligent fuzzy contact resolver for voice commands & meeting scheduling
 * Resolves "Rıfat", "Rıfat Sağın", "rifat@example.com", "Sarah", etc.
 */
export async function resolveContactByNameOrEmail(userId: string, query: string): Promise<Contact | null> {
  if (!query || !query.trim()) return null;
  const db = await getDb();
  const clean = query.trim().toLowerCase();

  // 1. Direct email match
  if (clean.includes('@')) {
    const emailRes = await db.query(
      'SELECT * FROM contacts WHERE LOWER(email) = $1 LIMIT 1',
      [clean]
    );
    if (emailRes.rows.length > 0) return getContactById(emailRes.rows[0].id);
  }

  // 2. Exact name match
  const exactRes = await db.query(
    'SELECT * FROM contacts WHERE LOWER(name) = $1 LIMIT 1',
    [clean]
  );
  if (exactRes.rows.length > 0) return getContactById(exactRes.rows[0].id);

  // 3. Partial substring name match or first name match
  const partialRes = await db.query(
    `SELECT * FROM contacts 
     WHERE LOWER(name) LIKE $1 
        OR $2 LIKE '%' || LOWER(name) || '%'
        OR LOWER(email) LIKE $1
     ORDER BY LENGTH(name) ASC LIMIT 1`,
    [`%${clean}%`, clean]
  );
  if (partialRes.rows.length > 0) return getContactById(partialRes.rows[0].id);

  // 4. Token match (e.g. user says "Rifat", contact is "Rıfat Sağın")
  const tokens = clean.split(/\s+/).filter(t => t.length >= 3);
  for (const token of tokens) {
    const normalizedToken = token.replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c');
    const tokenRes = await db.query(
      `SELECT * FROM contacts 
       WHERE LOWER(name) LIKE $1 
          OR LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(name, 'ı', 'i'), 'ğ', 'g'), 'ü', 'u'), 'ş', 's'), 'ö', 'o'), 'ç', 'c')) LIKE $2
       LIMIT 1`,
      [`%${token}%`, `%${normalizedToken}%`]
    );
    if (tokenRes.rows.length > 0) return getContactById(tokenRes.rows[0].id);
  }

  return null;
}

export async function searchContacts(userId: string, query: string): Promise<Contact[]> {
  const db = await getDb();
  if (!query || !query.trim()) {
    return getContacts(userId);
  }
  const clean = `%${query.trim().toLowerCase()}%`;
  const res = await db.query(
    `SELECT * FROM contacts 
     WHERE (LOWER(name) LIKE $1 OR LOWER(email) LIKE $1 OR phone LIKE $1 OR LOWER(company) LIKE $1 OR LOWER(relationship) LIKE $1)
     ORDER BY name ASC`,
    [clean]
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    user_id: r.user_id,
    name: r.name,
    email: r.email || undefined,
    phone: r.phone || undefined,
    company: r.company || undefined,
    relationship: r.relationship || undefined,
    notes: r.notes || undefined,
    created_at: typeof r.created_at === 'object' ? r.created_at.toISOString() : String(r.created_at),
    updated_at: typeof r.updated_at === 'object' ? r.updated_at.toISOString() : String(r.updated_at)
  }));
}

// ----------------------------------------------------
// DATABASE INSPECTION HELPER (FOR VERIFICATION)
// ----------------------------------------------------

export async function inspectDatabaseSummary() {
  const db = await getDb();
  const users = await db.query('SELECT id, email, password_hash, name, has_completed_onboarding, created_at FROM users');
  const profileFacts = await db.query('SELECT id, user_id, category, key, value, updated_at FROM user_profile');
  const conversations = await db.query('SELECT id, user_id, title FROM conversations');
  const messages = await db.query('SELECT id, conversation_id, sender, text, timestamp FROM messages');
  const contacts = await db.query('SELECT id, name, email, phone, relationship FROM contacts');
  return {
    engine: db.isRemote ? 'Hosted PostgreSQL (pg.Pool)' : 'Embedded PostgreSQL (PGlite)',
    users: users.rows,
    profileFacts: profileFacts.rows,
    conversations: conversations.rows,
    messagesCount: messages.rows.length,
    contactsCount: contacts.rows.length,
    contacts: contacts.rows
  };
}
