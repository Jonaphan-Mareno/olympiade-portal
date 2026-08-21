import nodemailer from 'nodemailer';

// Cache the test account so we don't create a new one every time
let cachedTransporter: nodemailer.Transporter | null = null;

async function getTransporter(): Promise<nodemailer.Transporter> {
  if (cachedTransporter) return cachedTransporter;

  // For local development, use Ethereal (fake SMTP that captures emails)
  const testAccount = await nodemailer.createTestAccount();

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

export async function sendInviteEmail(params: {
  to: string;
  portalName: string;
  schoolName: string;
  inviteToken: string;
  role?: string;
}): Promise<{ previewUrl?: string }> {
  const role = params.role ?? 'educator';
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const inviteLink = `${baseUrl}/signup?inviteToken=${params.inviteToken}`;

  const transporter = await getTransporter();

  const info = await transporter.sendMail({
    from: '"Olympiad Portal" <noreply@olympiad-portal.local>',
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

  const previewUrl = nodemailer.getTestMessageUrl(info) as string | undefined;
  if (previewUrl) {
    console.log(`Invite email preview: ${previewUrl}`);
  }

  return { previewUrl };
}
