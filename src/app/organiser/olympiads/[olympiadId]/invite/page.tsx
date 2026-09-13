import Link from 'next/link';
import InviteSchoolForm from './InviteSchoolForm';

export default async function InviteSchoolPage({
  params,
}: {
  params: Promise<{ olympiadId: string }>;
}) {
  const resolvedParams = await params;
  return (
    <div className="min-h-screen bg-white font-sans flex flex-col">
      <div className="bg-blue-50/50 border-b border-slate-200 py-12 px-6 relative">
        <div className="absolute top-6 left-6">
          <Link href={`/organiser/olympiads/${resolvedParams.olympiadId}`} className="text-blue-900 font-medium hover:underline inline-block">
            &larr; Back to Olympiad
          </Link>
        </div>
        <div className="max-w-4xl mx-auto pt-6">
          <h1 className="font-serif text-4xl font-bold text-slate-900 m-0">Invite Schools</h1>
          <p className="text-slate-500 mt-3 text-lg max-w-2xl">
            Add schools to your Olympiad and invite educators. They will receive an email to join your portal.
          </p>
        </div>
      </div>
      
      <div className="flex-1 bg-white">
        <InviteSchoolForm portalId={resolvedParams.olympiadId} />
      </div>
    </div>
  );
}
