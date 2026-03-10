/**
 * Emergency Kit dialog shown after successful SRP registration.
 *
 * Displays the Secret Key (which NEVER touches the server) and provides:
 * - Copy to clipboard button
 * - Download Emergency Kit PDF (generated client-side with the actual Secret Key)
 * - Mandatory acknowledgment checkbox before closing
 *
 * The Secret Key is only shown once — if the user closes this dialog
 * without saving it, they cannot recover it from the server.
 */

import { useState, useCallback } from 'react';
import { ShieldAlert, Copy, Download, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

/** Build a self-contained HTML page for the Emergency Kit with the actual Secret Key. */
function buildEmergencyKitHTML(email: string, secretKey: string, signinUrl: string, date: string): string {
  // Escape HTML entities
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>TOD - Emergency Kit</title>
<style>
@page { size: A4; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #1E293B; background: white; line-height: 1.5; }
.page { width: 210mm; min-height: 297mm; padding: 0; position: relative; }
.header { background: #0F172A; color: white; padding: 32px 40px; display: flex; align-items: center; gap: 16px; }
.logo { width: 48px; height: 48px; background: #38BDF8; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; color: #0F172A; flex-shrink: 0; }
.header-text h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.025em; }
.header-text p { font-size: 13px; color: #94A3B8; margin-top: 2px; }
.content { padding: 32px 40px; }
.warning-box { background: #FEF3C7; border: 1px solid #FCD34D; border-radius: 8px; padding: 16px 20px; margin-bottom: 28px; font-size: 13px; color: #92400E; line-height: 1.6; }
.warning-box strong { display: block; margin-bottom: 4px; font-size: 14px; }
.field { margin-bottom: 20px; }
.field-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748B; margin-bottom: 6px; }
.field-value { font-size: 15px; color: #0F172A; padding: 10px 14px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; }
.secret-key-box { border: 2px dashed #38BDF8; border-radius: 8px; padding: 18px 20px; text-align: center; background: #F0F9FF; margin-bottom: 20px; }
.secret-key-box .field-label { margin-bottom: 10px; }
.secret-key-value { font-family: 'SF Mono', 'Fira Code', Consolas, 'Courier New', monospace; font-size: 20px; font-weight: 600; letter-spacing: 0.05em; color: #0F172A; }
.write-in { margin-bottom: 28px; }
.write-in .field-label { margin-bottom: 8px; }
.write-line { border-bottom: 1px solid #CBD5E1; height: 32px; }
.separator { border: none; border-top: 1px solid #E2E8F0; margin: 24px 0; }
.instructions { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 20px 24px; margin-bottom: 28px; }
.instructions h3 { font-size: 14px; font-weight: 600; color: #0F172A; margin-bottom: 12px; }
.instructions ul { list-style: none; padding: 0; }
.instructions li { font-size: 13px; color: #475569; padding: 5px 0 5px 20px; position: relative; line-height: 1.5; }
.instructions li::before { content: ''; position: absolute; left: 0; top: 12px; width: 6px; height: 6px; background: #38BDF8; border-radius: 50%; }
.instructions li.warning { color: #B91C1C; font-weight: 500; }
.instructions li.warning::before { background: #EF4444; }
.footer { position: absolute; bottom: 0; left: 0; right: 0; padding: 16px 40px; border-top: 1px solid #E2E8F0; display: flex; justify-content: space-between; align-items: center; }
.footer-text { font-size: 11px; color: #94A3B8; }
.footer-accent { font-size: 11px; color: #38BDF8; font-weight: 600; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="logo">T</div>
    <div class="header-text">
      <h1>Emergency Kit</h1>
      <p>TOD Zero-Knowledge Recovery</p>
    </div>
  </div>
  <div class="content">
    <div class="warning-box">
      <strong>Keep this document safe</strong>
      This Emergency Kit is your only way to recover access if you lose your Secret Key.
      Store it in a secure location such as a home safe or safety deposit box.
    </div>
    <div class="field">
      <div class="field-label">Email Address</div>
      <div class="field-value">${esc(email)}</div>
    </div>
    <div class="field">
      <div class="field-label">Sign-in URL</div>
      <div class="field-value">${esc(signinUrl)}</div>
    </div>
    <div class="secret-key-box">
      <div class="field-label">Secret Key</div>
      <div class="secret-key-value">${esc(secretKey)}</div>
    </div>
    <div class="write-in">
      <div class="field-label">Master Password (write by hand)</div>
      <div class="write-line"></div>
    </div>
    <hr class="separator">
    <div class="instructions">
      <h3>Instructions</h3>
      <ul>
        <li>This Emergency Kit contains your Secret Key needed to log in on new devices.</li>
        <li>Store this document in a safe place — a home safe, safety deposit box, or other secure location.</li>
        <li>Do NOT store this document digitally alongside your password.</li>
        <li>Consider writing your Master Password on this sheet and storing it securely.</li>
        <li class="warning">If you lose both your Emergency Kit and forget your Secret Key, your encrypted data cannot be recovered. There is no reset mechanism.</li>
      </ul>
    </div>
  </div>
  <div class="footer">
    <span class="footer-text">Generated ${esc(date)} — TOD</span>
    <span class="footer-accent">CONFIDENTIAL</span>
  </div>
</div>
</body>
</html>`;
}

interface EmergencyKitDialogProps {
  open: boolean;
  onClose: () => void;
  secretKey: string; // Formatted A3-XXXXXX-...
  email: string;
}

export function EmergencyKitDialog({
  open,
  onClose,
  secretKey,
  email,
}: EmergencyKitDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(secretKey);
      setCopied(true);
      toast.success('Secret Key copied to clipboard');
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback for environments without clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = secretKey;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      toast.success('Secret Key copied to clipboard');
      setTimeout(() => setCopied(false), 3000);
    }
  }, [secretKey]);

  const handleDownloadPDF = useCallback(() => {
    setDownloading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const html = buildEmergencyKitHTML(email, secretKey, window.location.origin, today);
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error('Pop-up blocked. Please allow pop-ups and try again.');
        return;
      }
      printWindow.document.write(html);
      printWindow.document.close();
      // Wait for content to render then trigger print dialog (Save as PDF)
      printWindow.onload = () => {
        printWindow.print();
      };
      // Fallback if onload doesn't fire (some browsers)
      setTimeout(() => printWindow.print(), 500);
      toast.success('Print dialog opened — choose "Save as PDF" to download');
    } catch {
      toast.error('Failed to generate Emergency Kit');
    } finally {
      setDownloading(false);
    }
  }, [email, secretKey]);

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
            </div>
            <DialogTitle className="text-lg">Save Your Emergency Kit</DialogTitle>
          </div>
          <DialogDescription className="text-sm leading-relaxed">
            Your Secret Key is shown below. This is the <strong>only time</strong> it
            will be displayed. You need it when signing in from a new browser or computer.
          </DialogDescription>
        </DialogHeader>

        {/* Secret Key Display */}
        <div className="my-4 rounded-lg border-2 border-dashed border-accent/50 bg-accent/5 p-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-text-secondary">
            Your Secret Key
          </div>
          <div className="font-mono text-lg font-semibold tracking-wide text-text-primary select-all break-all">
            {secretKey}
          </div>
          <div className="mt-2 text-xs text-text-secondary">
            Account: {email}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-green-500" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy Secret Key
              </>
            )}
          </button>
          <button
            onClick={handleDownloadPDF}
            disabled={downloading}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {downloading ? 'Downloading...' : 'Download PDF'}
          </button>
        </div>

        {/* Instructions */}
        <div className="mt-3 rounded-md bg-surface-secondary p-3 text-xs text-text-secondary leading-relaxed">
          The PDF includes your Secret Key. Print it or save it securely.
          You can also store the key in your password manager. Do NOT store it alongside your password.
        </div>

        {/* Help toggle */}
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="mt-2 text-xs text-accent hover:underline"
        >
          What is a Secret Key?
        </button>
        {showHelp && (
          <div className="mt-2 rounded-md bg-elevated p-3 text-xs text-text-secondary leading-relaxed">
            Your Secret Key is a unique code generated on your device. Combined with your password,
            it creates the encryption keys that protect your data. The server never sees your Secret Key
            or your password — this is called zero-knowledge encryption. If you lose both your Secret Key
            and your password, your data cannot be recovered.
          </div>
        )}

        <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col">
          {/* Acknowledgment Checkbox */}
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-secondary leading-snug">
              I have saved my Secret Key and understand that it cannot be recovered
              if lost.
            </span>
          </label>

          {/* Close Button */}
          <button
            onClick={onClose}
            disabled={!acknowledged}
            className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            I Have Saved My Emergency Kit
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
