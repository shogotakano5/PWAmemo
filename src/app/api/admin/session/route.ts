import { currentAdminEmail, isAdminConfigured } from '@/lib/admin';
import { json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const configured = isAdminConfigured();
  if (!configured) return json({ admin: null, configured: false });
  try {
    const email = await currentAdminEmail();
    return json({ admin: email ? { email } : null, configured: true });
  } catch (error) {
    console.error('[admin/session] failed', error);
    return json({ admin: null, configured: false });
  }
}
