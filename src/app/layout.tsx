import { DebugErrorOverlay } from '@/components/debug-error-overlay'
import { WebAnalytics } from '@/components/web-analytics'
import { metadataBase } from '@/shared/metadata-base'
import { ThemeProvider, Toaster } from '@cbrl/design'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: metadataBase(),
  applicationName: 'Oilio',
  title: 'Oilio',
  description:
    'Plataforma de gestão para negócios de serviço recorrente: agenda, assinatura e comissões.',
  appleWebApp: {
    capable: true,
    title: 'Oilio',
    statusBarStyle: 'default',
  },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: 'Oilio',
    title: 'Oilio',
    description:
      'Plataforma de gestão para negócios de serviço recorrente: agenda, assinatura e comissões.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Oilio',
    description:
      'Plataforma de gestão para negócios de serviço recorrente: agenda, assinatura e comissões.',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster />
          <DebugErrorOverlay />
        </ThemeProvider>
        {process.env.VERCEL_ENV === 'production' ? <WebAnalytics /> : null}
      </body>
    </html>
  )
}
