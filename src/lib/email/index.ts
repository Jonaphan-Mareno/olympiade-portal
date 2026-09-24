import nodemailer from 'nodemailer';

// Cache the transporter so we don't create a new one every time
let cachedTransporter: nodemailer.Transporter | null = null;

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // Real SMTP is only used when all credentials are provided (e.g. Brevo:
  // SMTP_HOST=smtp-relay.brevo.com, SMTP_PORT=587)
  if (host && user && pass) {
    const port = parseInt(process.env.SMTP_PORT || '587', 10) || 587;
    return {
      host,
      port,
      // Port 465 uses implicit TLS; other ports upgrade via STARTTLS
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: { user, pass },
    };
  }

  return null;
}

async function getTransporter(): Promise<nodemailer.Transporter> {
  if (cachedTransporter) return cachedTransporter;

  const smtpConfig = getSmtpConfig();

  if (smtpConfig) {
    if (!process.env.EMAIL_FROM) {
      console.warn(
        'EMAIL_FROM is not set — using the default sender address. Most SMTP ' +
          'providers (e.g. Brevo) reject senders that are not verified, so set ' +
          'EMAIL_FROM to your verified sender address.'
      );
    }

    cachedTransporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.auth.user,
        pass: smtpConfig.auth.pass,
      },
    });

    return cachedTransporter;
  }

  // No SMTP credentials configured — fall back to Ethereal
  // (fake SMTP that captures emails for preview during development)
  const testAccount = await nodemailer.createTestAccount();

  console.warn(
    'SMTP_HOST / SMTP_USER / SMTP_PASS are not set — sending via an Ethereal ' +
      'test account. Emails are NOT actually delivered, preview links only.'
  );
  console.log('--- Ethereal Test Email Account ---');
  console.log(`  User:     ${testAccount.user}`);
  console.log(`  Pass:     ${testAccount.pass}`);
  console.log(`  SMTP:     ${testAccount.smtp.host}:${testAccount.smtp.port}`);
  console.log(`  Webmail:  ${testAccount.web}`);
  console.log('-----------------------------------');

  cachedTransporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  return cachedTransporter;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ previewUrl?: string }> {
  const from =
    process.env.EMAIL_FROM ||
    '"Olympiad Portal" <noreply@olympiad-portal.local>';

  const transporter = await getTransporter();

  const info = await transporter.sendMail({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info) as string | undefined;
  if (previewUrl) {
    // Ethereal fallback — log the preview link
    console.log(`Email preview for ${params.to}: ${previewUrl}`);
  } else {
    console.log(
      `Email sent to ${params.to} (subject: "${params.subject}", message id: ${info.messageId})`
    );
  }

  return { previewUrl };
}

export async function sendInviteEmail(params: {
  to: string;
  portalName: string;
  schoolName: string;
  inviteToken: string;
  role?: string;
}): Promise<{ previewUrl?: string }> {
  const role = params.role ?? 'educator';
  // Strip trailing slashes so links stay correct whether or not the env var has one
  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  ).replace(/\/+$/, '');
  const inviteLink = `${baseUrl}/signup?inviteToken=${params.inviteToken}`;

  if (process.env.NODE_ENV === 'development') {
    console.log('\n=============================================');
    console.log(' TEST INVITE LINK (Local Development Fallback)');
    console.log(` To: ${params.to}`);
    console.log(` Role: ${role}`);
    console.log(` Link: ${inviteLink}`);
    console.log('=============================================\n');
    return { previewUrl: inviteLink };
  }

  try {
    const info = await sendEmail({
      to: params.to,
      subject: `You've been invited to join ${params.portalName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #6366f1;">You're Invited!</h2>
          <p>You have been added as a <strong>${role}</strong> at <strong>${params.schoolName}</strong> for the <strong>${params.portalName}</strong> olympiad.</p>
          <p>Click the link below to create your account and join the portal:</p>
          <a href="${inviteLink}"
             style="display: inline-block; padding: 12px 24px; background: #6366f1; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
            Accept Invitation
          </a>
          <p style="color: #a1a1aa; font-size: 0.85rem;">
            If you did not expect this invitation, you can safely ignore this email.
          </p>
        </div>
      `,
    });
    return info;
  } catch (error) {
    console.error(`Email delivery failed for ${params.to}:`, error);
    throw error;
  }
}
