export interface SMTPPreset {
  id: string;
  label: string;
  host: string;
  port: number;
  useTls: boolean;
  helpText: string;
}

export const SMTP_PRESETS: SMTPPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    host: "smtp.gmail.com",
    port: 587,
    useTls: false, // STARTTLS on 587
    helpText:
      "Use an App Password — enable 2FA in Google Account → Security → App Passwords",
  },
  {
    id: "microsoft365",
    label: "Microsoft 365",
    host: "smtp.office365.com",
    port: 587,
    useTls: false,
    helpText:
      "Use an App Password — go to account.microsoft.com → Security → App Passwords",
  },
  {
    id: "fastmail",
    label: "Fastmail",
    host: "smtp.fastmail.com",
    port: 465,
    useTls: true, // implicit TLS on 465
    helpText:
      "Use an App Password — go to Settings → Privacy & Security → App Passwords",
  },
  {
    id: "sendgrid",
    label: "SendGrid",
    host: "smtp.sendgrid.net",
    port: 587,
    useTls: false,
    helpText: 'Username is "apikey", password is your SendGrid API key',
  },
  {
    id: "amazon_ses",
    label: "Amazon SES",
    host: "email-smtp.us-east-1.amazonaws.com",
    port: 587,
    useTls: false,
    helpText:
      "Use SMTP credentials from AWS SES console (not IAM access keys)",
  },
  {
    id: "mailpit",
    label: "Mailpit (Dev)",
    host: "mailpit",
    port: 1025,
    useTls: false,
    helpText: "Local dev testing — Mailpit UI at http://localhost:8026",
  },
  {
    id: "custom",
    label: "Custom SMTP",
    host: "",
    port: 587,
    useTls: false,
    helpText: "Enter your SMTP server details manually",
  },
];
