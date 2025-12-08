// app/layout.tsx
import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'מירוץ הידע - Trivia Rush',
  description: 'משחק טריוויה חכם בעברית, מופעל ע״י Gemini',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <head>
        {/* גופנים כמו במשחק המקורי */}
        <link
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;700;900&family=Rubik+Glitch&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}

        {/* אייקונים של Lucide */}
        <Script
          src="https://unpkg.com/lucide@latest"
          strategy="afterInteractive"
        />

        {/* ספריית קונפטי */}
        <Script
          src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js"
          strategy="afterInteractive"
        />

        {/* הפעלת האייקונים אחרי שה-DOM והסקריפט נטענו */}
        <Script id="lucide-init" strategy="afterInteractive">
          {`
            if (window.lucide && window.lucide.createIcons) {
              window.lucide.createIcons();
            }
          `}
        </Script>
      </body>
    </html>
  );
}
