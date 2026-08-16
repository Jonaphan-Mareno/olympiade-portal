import './globals.css';

export const metadata = {
  title: 'Olympiad Portal',
  description: 'Manage and participate in olympiads seamlessly.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
