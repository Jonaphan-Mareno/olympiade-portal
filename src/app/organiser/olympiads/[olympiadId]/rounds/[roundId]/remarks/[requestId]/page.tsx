import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import RemarkReview from '@/components/remarks/RemarkReview';

export const dynamic = 'force-dynamic';

export default async function OrganiserRemarkPage({
  params,
}: {
  params: Promise<{ olympiadId: string; roundId: string; requestId: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { olympiadId, roundId, requestId } = await params;
  const back = `/organiser/olympiads/${olympiadId}/rounds/${roundId}/remarks`;

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 md:px-8">
      <div className="max-w-5xl mx-auto">
        <Link href={back} className="text-blue-600 hover:underline text-sm font-medium mb-4 inline-block">
          &larr; Remarks
        </Link>
        <RemarkReview requestId={requestId} userId={user.id} doneHref={back} />
      </div>
    </div>
  );
}
