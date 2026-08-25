import { currentUser } from '@/lib/auth';
import { isDatabaseConfigured } from '@/lib/db';
import { json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const accountsEnabled = isDatabaseConfigured() && Boolean(process.env.AUTH_SECRET);
  if (!accountsEnabled) {
    return json({ user: null, accountsEnabled: false });
  }
  try {
    return json({ user: await currentUser(), accountsEnabled: true });
  } catch (error) {
    console.error('[auth/me] failed', error);
    return json({ user: null, accountsEnabled: false });
  }
}
