/**
 * Emergency Kit dialog shown after successful SRP registration.
 *
 * Displays the Secret Key (which NEVER touches the server) and provides:
 * - Copy to clipboard button
 * - Download Emergency Kit PDF (server-generated template without Secret Key)
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
import { authApi } from '@/lib/api';

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

  const handleDownloadPDF = useCallback(async () => {
    setDownloading(true);
    try {
      const blob = await authApi.getEmergencyKitPDF();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'MikroTik-Portal-Emergency-Kit.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('Emergency Kit PDF downloaded');
    } catch {
      toast.error('Failed to download Emergency Kit PDF');
    } finally {
      setDownloading(false);
    }
  }, []);

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
          Write your Secret Key on the Emergency Kit PDF after printing it, or save it
          in your password manager. Do NOT store it digitally alongside your password.
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
