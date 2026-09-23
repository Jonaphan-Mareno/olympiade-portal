import { ReactNode } from 'react';
import StudentNavbar from '@/components/student/StudentNavbar';

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#F8FAFC',
      }}
    >
      <StudentNavbar />
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}
