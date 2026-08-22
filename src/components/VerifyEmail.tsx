import React, { useState, useEffect, useRef } from 'react';
import { Mail, ArrowRight, RotateCw, AlertCircle, CheckCircle2, Shield, ArrowLeft } from 'lucide-react';
import { User } from '../types';
import { soundFX } from '../utils/audio';

interface VerifyEmailProps {
  userId: string;
  email: string;
  onSuccess: (token: string, refreshToken: string, user: User, isNewSignup: boolean) => void;
  onBackToLogin: () => void;
}

export const VerifyEmail: React.FC<VerifyEmailProps> = ({
  userId,
  email,
  onSuccess,
  onBackToLogin
}) => {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState<number>(60);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // 60-second resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleDigitChange = (index: number, value: string) => {
    setError(null);
    setResendNotice(null);

    // Handle paste of multiple digits
    if (value.length > 1) {
      const sanitized = value.replace(/\D/g, '').slice(0, 6);
      if (sanitized) {
        const newDigits = [...digits];
        for (let i = 0; i < sanitized.length; i++) {
          newDigits[i] = sanitized[i];
        }
        setDigits(newDigits);
        const nextFocus = Math.min(sanitized.length, 5);
        inputRefs.current[nextFocus]?.focus();
        
        if (sanitized.length === 6) {
          submitVerificationCode(sanitized);
        }
        return;
      }
    }

    const sanitizedChar = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = sanitizedChar;
    setDigits(newDigits);

    if (sanitizedChar && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Check if code is complete
    const fullCode = newDigits.join('');
    if (fullCode.length === 6 && !newDigits.includes('')) {
      submitVerificationCode(fullCode);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pastedData) {
      const newDigits = [...digits];
      for (let i = 0; i < 6; i++) {
        newDigits[i] = pastedData[i] || '';
      }
      setDigits(newDigits);
      const nextIndex = Math.min(pastedData.length, 5);
      inputRefs.current[nextIndex]?.focus();

      if (pastedData.length === 6) {
        submitVerificationCode(pastedData);
      }
    }
  };

  const submitVerificationCode = async (codeToVerify?: string) => {
    const code = codeToVerify || digits.join('');
    if (code.length !== 6) {
      setError('Please enter all 6 digits of your verification code.');
      return;
    }

    setError(null);
    setResendNotice(null);
    setIsLoading(true);
    soundFX.playHudTick();

    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, code })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Verification failed. Please verify the code and try again.');
      }

      soundFX.playPowerOn();
      onSuccess(data.token, data.refreshToken || '', data.user, true);
    } catch (err: any) {
      setError(err.message || 'Failed to verify email code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendCooldown > 0 || isResending) return;

    setError(null);
    setResendNotice(null);
    setIsResending(true);
    soundFX.playHudTick();

    try {
      const res = await fetch('/api/auth/resend-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to resend code');
      }

      setResendNotice(data.message || 'A new verification code has been dispatched.');
      setResendCooldown(60);
      setDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } catch (err: any) {
      setError(err.message || 'Could not resend verification code');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div id="verify-email-view" className="flex flex-col gap-5">
      {/* Informational Callout */}
      <div className="bg-cyan-400/5 border border-cyan-400/25 rounded-sm p-3.5 text-xs text-cyan-300/90 leading-relaxed flex items-start gap-3">
        <div className="p-1.5 rounded-sm bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 shrink-0 mt-0.5">
          <Mail className="w-4 h-4" />
        </div>
        <div>
          <p className="font-semibold text-cyan-200">6-Digit Verification Dispatched</p>
          <p className="mt-0.5 text-slate-400">
            We sent an operations calibration code to <span className="text-cyan-300 font-mono font-medium">{email}</span>. Please enter the 6 digits below:
          </p>
        </div>
      </div>

      {/* Error & Success Notices */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/40 rounded-sm p-3 text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {resendNotice && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-sm p-3 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{resendNotice}</span>
        </div>
      )}

      {/* 6 Digit Input Boxes */}
      <div className="flex flex-col items-center gap-3 my-2">
        <label className="text-[11px] mono uppercase tracking-widest text-slate-300">
          Authorization Passcode
        </label>
        <div className="flex items-center justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(el) => { inputRefs.current[index] = el; }}
              id={`digit-input-${index}`}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={digit}
              onChange={(e) => handleDigitChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              className="w-11 h-13 sm:w-12 sm:h-14 bg-slate-950/90 border border-cyan-400/30 focus:border-cyan-400 rounded-sm text-center text-xl sm:text-2xl font-mono font-bold text-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/50 shadow-[inset_0_0_10px_rgba(6,182,212,0.1)] transition-all"
              autoComplete="off"
            />
          ))}
        </div>
        <p className="text-[10px] mono text-slate-500 tracking-wider">
          Codes expire after 10 minutes.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-3">
        <button
          id="btn-verify-submit"
          type="button"
          disabled={isLoading || digits.join('').length !== 6}
          onClick={() => submitVerificationCode()}
          className="w-full py-3 px-4 rounded-sm bg-cyan-400 text-slate-950 hover:bg-cyan-300 active:bg-cyan-500 font-bold mono text-xs uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(34,211,238,0.35)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {isLoading ? (
            <span className="inline-block w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <span>CONFIRM & INITIALIZE ORION</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        <div className="flex items-center justify-between pt-2 border-t border-cyan-400/15">
          <button
            type="button"
            onClick={onBackToLogin}
            className="text-xs text-slate-400 hover:text-cyan-300 mono flex items-center gap-1 cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Log In</span>
          </button>

          <button
            type="button"
            id="btn-resend-code"
            disabled={resendCooldown > 0 || isResending}
            onClick={handleResendCode}
            className="text-xs mono text-cyan-400 hover:text-cyan-300 disabled:text-slate-600 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isResending ? 'animate-spin' : ''}`} />
            <span>
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend Code'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
