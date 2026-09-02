import type { Metadata } from 'next';
import AdminPanel from '@/components/AdminPanel';

export const metadata: Metadata = {
  title: '管理画面',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminPanel />;
}
