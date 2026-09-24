import { db } from '@/lib/db';
import { rounds, certificateTemplates } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import CertificateMapper from './CertificateMapper';
import Link from 'next/link';

export default async function CertificateMappingPage({
  params,
}: {
  params: Promise<{ olympiadId: string; roundId: string }>;
}) {
  const { olympiadId, roundId } = await params;
  
  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));

  if (!round) {
    return <div>Round not found.</div>;
  }

  const templates = await db
    .select()
    .from(certificateTemplates)
    .where(eq(certificateTemplates.roundId, roundId))
    .orderBy(desc(certificateTemplates.minScorePercentage));

  return (
    <div className="min-h-screen bg-slate-50 font-sans w-full px-4 md:px-8 pt-10 pb-20">
      <div className="max-w-6xl mx-auto">
        <Link
          href={`/organiser/olympiads/${olympiadId}`}
          className="text-blue-600 hover:underline text-sm font-medium mb-4 inline-block"
        >
          &larr; Back to Olympiad
        </Link>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h1 className="text-3xl font-bold text-slate-900 m-0">
            Certificate Mapping (Tiered)
          </h1>
        </div>
        <p className="text-slate-600 mb-6">
          Upload certificate templates for different score tiers (e.g., Distinction, Participation). 
          The system will automatically award the highest eligible certificate to the student.
        </p>

        <div className="flex gap-4 border-b border-slate-200 mb-8">
          <Link href={`/organiser/olympiads/${olympiadId}/rounds/${roundId}`} className="pb-3 text-sm font-bold uppercase tracking-wider border-b-2 border-transparent text-slate-500 hover:text-slate-700">
            Manage Round
          </Link>
          <Link href={`/organiser/olympiads/${olympiadId}/rounds/${roundId}/certificate`} className="pb-3 text-sm font-bold uppercase tracking-wider border-b-2 border-slate-900 text-slate-900">
            Certificates
          </Link>
        </div>

        <CertificateMapper 
          roundId={roundId}
          initialTemplates={templates.map(t => ({
            id: t.id,
            minScorePercentage: parseFloat(t.minScorePercentage as string),
            templateUrl: t.templateUrl,
            nameXCoord: parseFloat(t.nameXCoord as string) || 50,
            nameYCoord: parseFloat(t.nameYCoord as string) || 50,
            nameFontSize: t.nameFontSize || 48,
            nameTextColor: t.nameTextColor || '#000000',
          }))}
        />
      </div>
    </div>
  );
}
