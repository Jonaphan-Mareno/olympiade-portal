import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import RemarkReview from '@/components/remarks/RemarkReview';

export const dynamic = 'force-dynamic';

export default async function EducatorRemarkPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { requestId } = await params;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">
      <Link
        href="/educator/remarks"
        className="text-blue-600 hover:underline text-sm font-medium mb-4 inline-block"
      >
        &larr; Remark requests
      </Link>
      <RemarkReview requestId={requestId} userId={user.id} doneHref="/educator/remarks" />
    </div>
  );
}
