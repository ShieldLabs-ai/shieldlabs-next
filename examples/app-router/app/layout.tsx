import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ShieldLabsProvider } from '@shieldlabs-ai/next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ShieldLabs with the Next.js App Router',
};

// The root layout is a Server Component. ShieldLabsProvider is a client component: it renders its
// children on the server and loads the ShieldLabs agent once in the browser, after hydration.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ShieldLabsProvider publicKey={process.env.NEXT_PUBLIC_SHIELDLABS_PUBLIC_KEY ?? ''}>
          {children}
        </ShieldLabsProvider>
      </body>
    </html>
  );
}
