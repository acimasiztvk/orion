import React, { useState, useMemo } from 'react';
import { Shield, Lock, Mail, User as UserIcon, Sparkles, ArrowRight, CheckCircle2, AlertCircle, KeyRound, Database, X, Globe } from 'lucide-react';
import { User } from '../types';
import { soundFX } from '../utils/audio';
import { VerifyEmail } from './VerifyEmail';
import { googleSignIn } from '../utils/googleAuth';

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onAuthSuccess: (token: string, refreshToken: string, user: User, isNewSignup: boolean) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset' | 'verify'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pendingUserId, setPendingUserId] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [generatedResetUrl, setGeneratedResetUrl] = useState<string | null>(null);

  // Universal Google Workspace OAuth Sign-In
  const handleGoogleOnboarding = async () => {
    setError(null);
    setSuccessNotice(null);
    setIsLoading(true);
    soundFX.playHudTick();
    try {
      const authResult = await googleSignIn();
      if (!authResult?.user) {
        throw new Error('Google authentication cancelled or could not be completed.');
      }
      const gUser = authResult.user;
      const res = await fetch('/api/auth/google-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: gUser.email,
          name: gUser.displayName || name || 'Commander',
          google_id: gUser.uid
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to initialize session in PostgreSQL matrix.');
      }
      soundFX.playPowerOn();
      onAuthSuccess(data.token, data.refreshToken || '', data.user, data.isNewSignup);
    } catch (err: any) {
      console.error('[AuthModal] Google Sign-In error:', err);
      setError(err.message || 'Google Authentication failed. Please verify popup permissions.');
    } finally {
      setIsLoading(false);
    }
  };

  // Real-time password strength evaluation
  const passwordStrength = useMemo(() => {
    const p = mode === 'reset' ? newPassword : password;
    if (!p) return { score: 0, label: 'Empty', color: 'bg-slate-700', rules: { length: false, complex: false, nonCommon: true } };

    const length = p.length >= 8;
    const complex = /[a-zA-Z]/.test(p) && /[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p);
    const commonList = ['password', '12345678', 'qwerty123', 'admin123', 'pass1234', 'welcome123'];
    const nonCommon = !commonList.includes(p.toLowerCase().trim());

    let score = 0;
    if (p.length >= 4) score += 1;
    if (length) score += 1;
    if (complex) score += 1;
    if (nonCommon && length && complex) score += 1;

    let label = 'Weak';
    let color = 'bg-rose-500';
    if (score >= 4) {
      label = 'Strong';
      color = 'bg-emerald-400';
    } else if (score >= 3) {
      label = 'Good';
      color = 'bg-cyan-400';
    } else if (score >= 2) {
      label = 'Fair';
      color = 'bg-amber-400';
    }

    return { score, label, color, rules: { length, complex, nonCommon } };
  }, [password, newPassword, mode]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);
    setIsLoading(true);
    soundFX.playHudTick();

    try {
      if (mode === 'forgot') {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Password recovery failed');
        
        setSuccessNotice(data.message || 'Password reset token generated.');
        if (data.resetToken) {
          setResetToken(data.resetToken);
          setGeneratedResetUrl(data.testResetUrl || `/reset-password?token=${data.resetToken}`);
        }
        return;
      }

      if (mode === 'reset') {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: resetToken, newPassword })
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Password reset failed');

        setSuccessNotice('Password updated successfully. You can now log in.');
        setMode('login');
        setPassword(newPassword);
        return;
      }

      if (mode === 'signup') {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() || 'Commander', email, password })
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || 'Registration failed');
        }

        if (data.requiresVerification || data.userId) {
          setPendingUserId(data.userId);
          setPendingEmail(data.email || email);
          setMode('verify');
          return;
        }

        soundFX.playPowerOn();
        onAuthSuccess(data.token, data.refreshToken || '', data.user, true);
        return;
      }

      if (mode === 'login') {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await res.json();
        if (res.status === 403 && data.code === 'EMAIL_NOT_VERIFIED') {
          setPendingUserId(data.userId);
          setPendingEmail(data.email || email);
          setMode('verify');
          return;
        }

        if (!res.ok || data.error) {
          throw new Error(data.error || 'Authentication failed');
        }

        soundFX.playPowerOn();
        onAuthSuccess(data.token, data.refreshToken || '', data.user, false);
        return;
      }
    } catch (err: any) {
      setError(err.message || 'Authentication error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDemo = async () => {
    setError(null);
    setSuccessNotice(null);
    setIsLoading(true);
    soundFX.playHudTick();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'tony@stark.ai', password: 'iamironman' })
      });
      const data = await res.json();
      if (data.token && data.user) {
        soundFX.playPowerOn();
        onAuthSuccess(data.token, data.refreshToken || '', data.user, false);
      } else {
        throw new Error(data.error || 'Demo access rejected');
      }
    } catch (err: any) {
      setError(err.message || 'Could not connect to demo session.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#020617]/85 backdrop-blur-md animate-fade-in select-none">
      <div
        id="auth-modal-card"
        className="relative w-full max-w-md bg-[#020617]/95 border border-cyan-400/30 rounded-lg p-6 sm:p-8 shadow-[0_0_40px_rgba(34,211,238,0.15)] flex flex-col gap-5 max-h-[92vh] overflow-y-auto"
      >
        {/* Holographic Header Bar */}
        <div className="flex items-center justify-between border-b border-cyan-400/20 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-sm bg-cyan-400/10 border border-cyan-400/30 text-cyan-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-wider text-cyan-300 font-sans">
                  ORION SECURITY CLEARANCE
                </h2>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Database className="w-3 h-3 text-cyan-400" />
                <p className="text-[10px] mono uppercase tracking-[0.15em] text-slate-400">
                  PostgreSQL Matrix Active (Hosted Ready)
                </p>
              </div>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-sm bg-slate-900 border border-slate-700 text-slate-400 hover:text-cyan-300 hover:border-cyan-400/40 transition-colors cursor-pointer"
              title="Close Clearance Modal"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tab switch */}
        {mode !== 'verify' && (
          <div className="flex flex-col gap-3">
            {/* Universal Google Workspace OAuth Fast Onboarding */}
            <div className="p-3 rounded-sm bg-gradient-to-r from-cyan-950/60 to-slate-950 border border-cyan-400/30 flex flex-col gap-2 shadow-[0_0_15px_rgba(34,211,238,0.1)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-200">
                  <Globe className="w-3.5 h-3.5 text-cyan-400" />
                  <span>UNIVERSAL WORKSPACE ONBOARDING</span>
                </div>
                <span className="text-[9px] mono px-1.5 py-0.5 rounded-xs bg-cyan-400/20 text-cyan-300 uppercase">
                  All Scopes Pre-Granted
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Connect your Google account with full permissions (<span className="text-cyan-300 font-mono">Gmail, Calendar, Tasks</span>) in a single step for seamless zero-prompt AI execution.
              </p>
              <button
                type="button"
                id="btn-google-workspace-auth"
                onClick={handleGoogleOnboarding}
                disabled={isLoading}
                className="w-full py-2.5 px-3 rounded-sm bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-900 font-bold text-xs mono uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_15px_rgba(255,255,255,0.2)] disabled:opacity-50"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
                <span>Authorize with Google (Full Workspace)</span>
              </button>
            </div>

            <div className="flex items-center gap-2 my-1">
              <div className="h-px bg-cyan-400/20 flex-1" />
              <span className="text-[10px] mono uppercase tracking-widest text-slate-500">Or Manual Clearance</span>
              <div className="h-px bg-cyan-400/20 flex-1" />
            </div>

            <div className="grid grid-cols-2 gap-2 bg-slate-950/80 p-1 rounded-sm border border-cyan-400/20">
              <button
                type="button"
                id="tab-auth-signup"
                onClick={() => {
                  setMode('signup');
                  setError(null);
                  setSuccessNotice(null);
                  soundFX.playHudTick();
                }}
                className={`py-2 px-3 text-xs mono uppercase tracking-wider rounded-xs font-semibold transition-all cursor-pointer ${
                  mode === 'signup'
                    ? 'bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.4)]'
                    : 'text-slate-400 hover:text-cyan-300'
                }`}
              >
                New Commander
              </button>
              <button
                type="button"
                id="tab-auth-login"
                onClick={() => {
                  setMode('login');
                  setError(null);
                  setSuccessNotice(null);
                  soundFX.playHudTick();
                }}
                className={`py-2 px-3 text-xs mono uppercase tracking-wider rounded-xs font-semibold transition-all cursor-pointer ${
                  mode === 'login'
                    ? 'bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.4)]'
                    : 'text-slate-400 hover:text-cyan-300'
                }`}
              >
                Access Session
              </button>
            </div>
          </div>
        )}

        {/* Verification View */}
        {mode === 'verify' ? (
          <VerifyEmail
            userId={pendingUserId}
            email={pendingEmail}
            onSuccess={onAuthSuccess}
            onBackToLogin={() => {
              setMode('login');
              setError(null);
              setSuccessNotice(null);
            }}
          />
        ) : (
          <>
            {/* Mode Information Callout */}
            {mode === 'signup' && (
              <div className="bg-cyan-400/5 border border-cyan-400/20 rounded-sm p-3 text-xs text-cyan-300/90 leading-relaxed flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-cyan-300">The First Meeting:</span> Once initialized, ORION will greet you immediately to conduct a deep, guided voice orientation exploring your identity, goals, and working style.
                </div>
              </div>
            )}

            {mode === 'login' && (
              <div className="bg-cyan-400/5 border border-cyan-400/20 rounded-sm p-3 text-xs text-cyan-300/90 leading-relaxed flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-cyan-300">Welcome Back:</span> Resume your personal archives, active reminders, memory facts, and conversation channels in PostgreSQL.
                </div>
              </div>
            )}

            {mode === 'forgot' && (
              <div className="bg-cyan-400/5 border border-cyan-400/20 rounded-sm p-3 text-xs text-cyan-300/90 leading-relaxed flex items-start gap-2.5">
                <KeyRound className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-amber-300">Account Recovery:</span> Enter your registered email to generate a secure password recovery token.
                </div>
              </div>
            )}

            {mode === 'reset' && (
              <div className="bg-cyan-400/5 border border-cyan-400/20 rounded-sm p-3 text-xs text-cyan-300/90 leading-relaxed flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-cyan-300">Set New Password:</span> Provide your recovery token and define a new secure password.
                </div>
              </div>
            )}

            {/* Notices & Errors */}
            {error && (
              <div className="bg-rose-500/10 border border-rose-500/40 rounded-sm p-3 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {successNotice && (
              <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-sm p-3 text-xs text-emerald-300 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{successNotice}</span>
                </div>
                {generatedResetUrl && (
                  <div className="mt-1 p-2 bg-slate-900 border border-emerald-400/30 rounded text-[11px] mono text-cyan-300 break-all">
                    <span>Recovery Token: </span>
                    <span className="text-white font-bold">{resetToken}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('reset');
                        setSuccessNotice(null);
                      }}
                      className="block mt-2 text-xs text-cyan-400 underline hover:text-cyan-200 cursor-pointer font-sans font-semibold"
                    >
                      Proceed to Reset Password Form &rarr;
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {mode === 'signup' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] mono uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <UserIcon className="w-3.5 h-3.5 text-cyan-400" />
                    Commander Name / Call Sign
                  </label>
                  <input
                    id="input-auth-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Sarah Connor, Tony Stark"
                    className="w-full bg-slate-950/90 border border-cyan-400/25 focus:border-cyan-400 rounded-sm px-3.5 py-2.5 text-sm text-cyan-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 font-sans"
                  />
                </div>
              )}

              {(mode === 'signup' || mode === 'login' || mode === 'forgot') && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] mono uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-cyan-400" />
                    Secure Email Address
                  </label>
                  <input
                    id="input-auth-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="commander@stark.ai"
                    className="w-full bg-slate-950/90 border border-cyan-400/25 focus:border-cyan-400 rounded-sm px-3.5 py-2.5 text-sm text-cyan-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 font-sans"
                  />
                </div>
              )}

              {mode === 'reset' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] mono uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-cyan-400" />
                    Reset Recovery Token
                  </label>
                  <input
                    id="input-auth-reset-token"
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    placeholder="rst_..."
                    className="w-full bg-slate-950/90 border border-cyan-400/25 focus:border-cyan-400 rounded-sm px-3.5 py-2.5 text-sm text-cyan-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 font-mono"
                  />
                </div>
              )}

              {(mode === 'signup' || mode === 'login') && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] mono uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-cyan-400" />
                      Security Password
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('forgot');
                          setError(null);
                          setSuccessNotice(null);
                        }}
                        className="text-[10px] mono text-cyan-400/80 hover:text-cyan-300 underline cursor-pointer"
                      >
                        Forgot Key?
                      </button>
                    )}
                  </div>
                  <input
                    id="input-auth-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950/90 border border-cyan-400/25 focus:border-cyan-400 rounded-sm px-3.5 py-2.5 text-sm text-cyan-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 font-sans"
                  />

                  {mode === 'signup' && password.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1.5 bg-slate-950/60 p-2.5 rounded border border-cyan-400/15 text-[11px] mono">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Password Strength:</span>
                        <span className={`font-semibold ${passwordStrength.color.replace('bg-', 'text-')}`}>
                          {passwordStrength.label}
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${passwordStrength.color} transition-all duration-300`}
                          style={{ width: `${(passwordStrength.score / 4) * 100}%` }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-400 mt-1">
                        <span className={passwordStrength.rules.length ? 'text-emerald-400' : 'text-slate-500'}>
                          • &ge; 8 characters
                        </span>
                        <span className={passwordStrength.rules.complex ? 'text-emerald-400' : 'text-slate-500'}>
                          • Letters + Numbers/Symbols
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {mode === 'reset' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] mono uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-cyan-400" />
                    New Security Password
                  </label>
                  <input
                    id="input-auth-new-password"
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950/90 border border-cyan-400/25 focus:border-cyan-400 rounded-sm px-3.5 py-2.5 text-sm text-cyan-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 font-sans"
                  />
                  {newPassword.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1.5 bg-slate-950/60 p-2.5 rounded border border-cyan-400/15 text-[11px] mono">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Password Strength:</span>
                        <span className={`font-semibold ${passwordStrength.color.replace('bg-', 'text-')}`}>
                          {passwordStrength.label}
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${passwordStrength.color} transition-all duration-300`}
                          style={{ width: `${(passwordStrength.score / 4) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <button
                id="btn-submit-auth"
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 py-3 px-4 rounded-sm bg-cyan-400 text-slate-950 hover:bg-cyan-300 active:bg-cyan-500 font-bold mono text-xs uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(34,211,238,0.35)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="inline-block w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>
                      {mode === 'signup' && 'INITIALIZE & MEET ORION'}
                      {mode === 'login' && 'AUTHORIZE SESSION'}
                      {mode === 'forgot' && 'DISPATCH RECOVERY TOKEN'}
                      {mode === 'reset' && 'CONFIRM NEW PASSWORD'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Back to login if in forgot / reset mode */}
            {(mode === 'forgot' || mode === 'reset') && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setSuccessNotice(null);
                  }}
                  className="text-xs text-slate-400 hover:text-cyan-300 mono underline cursor-pointer"
                >
                  &larr; Return to Access Session
                </button>
              </div>
            )}
          </>
        )}

        {/* Quick Demo & Guest Access */}
        <div className="border-t border-cyan-400/15 pt-4 flex flex-col items-center gap-2.5">
          {onClose && (
            <button
              type="button"
              id="btn-guest-bypass"
              onClick={() => {
                soundFX.playPowerOn();
                onClose();
              }}
              className="w-full py-2 px-3 rounded-sm bg-slate-900/80 border border-slate-700 hover:border-cyan-400/40 text-slate-300 hover:text-cyan-300 text-xs mono uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Continue as Commander (No Token Required)</span>
            </button>
          )}

          <div className="flex items-center gap-2">
            <p className="text-[10px] mono uppercase tracking-wider text-slate-500">
              Returning Demo:
            </p>
            <button
              id="btn-demo-auth"
              type="button"
              onClick={handleQuickDemo}
              disabled={isLoading}
              className="text-xs text-cyan-400/80 hover:text-cyan-300 underline underline-offset-4 decoration-cyan-400/30 transition-all font-mono cursor-pointer"
            >
              Tony Stark Demo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
