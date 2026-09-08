import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'SES Agent Desktop | Local-first recruiting operations',
    template: '%s | SES Agent Desktop',
  },
  description:
    'A local-first desktop workspace that turns read-only Gmail job requests into structured recruiting cases.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
