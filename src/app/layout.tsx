import './globals.css';
import { Inter, Lora } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const lora = Lora({ subsets: ['latin'], variable: '--font-lora' });

export const metadata = {
  title: 'Olympiad Portal',
  description: 'Manage and participate in olympiads seamlessly.',
  icons: {
    icon: '/images/logo-BIG.jpg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
