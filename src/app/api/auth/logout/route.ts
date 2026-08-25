import { clearSessionCookie } from '@/lib/auth';
import { json, serverError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await clearSessionCookie();
    return json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
