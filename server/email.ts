/**
 * Transactional Email Dispatcher using Resend API
 */

export async function sendVerificationEmail(email: string, code: string, name?: string): Promise<boolean> {
  console.log(`[ORION RESEND EMAIL] Dispatching verification code for ${email}: ${code}`);

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey || resendApiKey.includes("YOUR_") || resendApiKey === "re_123456789" || resendApiKey.trim() === "") {
    console.log(`[ORION RESEND EMAIL] RESEND_API_KEY not configured or is a placeholder. Verification code logged to console: ${code}`);
    return true;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "ORION System <onboarding@resend.dev>",
        to: [email],
        subject: `Your ORION Verification Code: ${code}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #030712; color: #f8fafc; padding: 32px; border-radius: 12px; border: 1px solid #06b6d4; max-width: 540px; margin: 0 auto;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #22d3ee; letter-spacing: 3px; font-size: 24px; margin: 0;">ORION</h1>
              <p style="color: #64748b; font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 4px;">Omniscient Real-time Intelligent Operations Node</p>
            </div>
            <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6;">Welcome, ${name || 'Commander'}. Use the single-use authorization code below to verify your email address and calibrate your operations console:</p>
            <div style="background: rgba(6, 182, 212, 0.12); border: 1px solid rgba(34, 211, 238, 0.5); padding: 20px; text-align: center; border-radius: 8px; margin: 28px 0;">
              <span style="font-family: monospace; font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #22d3ee;">${code}</span>
            </div>
            <p style="font-size: 12px; color: #94a3b8; line-height: 1.5;">This code expires in <strong>10 minutes</strong>. If you did not initiate this authentication request, please disregard this transmission.</p>
          </div>
        `
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 401 || response.status === 403) {
        console.warn(`[ORION RESEND EMAIL] WARNING: Resend API key is invalid or unauthorized (${response.status}). Proceeding with console-logged code.`);
        return true;
      }
      console.warn(`[ORION RESEND EMAIL] Resend API responded with status ${response.status}:`, errText);
      return false;
    }

    console.log(`[ORION RESEND EMAIL] Verification email dispatched successfully to ${email}`);
    return true;
  } catch (err) {
    console.error(`[ORION RESEND EMAIL] Failed to dispatch email via Resend:`, err);
    return false;
  }
}
