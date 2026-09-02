import { clearAdminSessionCookie } from '@/lib/admin';
import { json, serverError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await clearAdminSessionCookie();
    return json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
