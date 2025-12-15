import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

// הגדרות מטא-דאטה (מה שרואים כשמשתפים בווצאפ/פייסבוק)
export const metadata: Metadata = {
  title: 'Trivia Rush - מירוץ הידע',
  description: 'האם תצליחו לענות על 50 שאלות לפני שייגמר הזמן? בואו לשחק באתגר היומי!',
  
  // הגדרות Open Graph (עבור פייסבוק, ווצאפ, לינקדאין וכו')
  openGraph: {
    title: 'Trivia Rush - מירוץ הידע',
    description: 'האם תצליחו לענות על 50 שאלות לפני שייגמר הזמן?',
    url: 'https://trivia-rush.vercel.app', // החלף בכתובת האמיתית שלך כשתעלה לאוויר
    siteName: 'Trivia Rush',
    locale: 'he_IL',
    type: 'website',
    // כאן אנחנו מגדירים ידנית את התמונה. 
    // עליך לשים קובץ תמונה בשם 'og-image.jpg' בתוך תיקיית public
    images: [
      {
        url: '/og-image.jpg', 
        width: 1200,
        height: 630,
        alt: 'Trivia Rush Game Preview',
      },
    ],
  },

  // הגדרות טוויטר
  twitter: {
    card: 'summary_large_image',
    title: 'Trivia Rush - מירוץ הידע',
    description: 'משחק הטריוויה המהיר בישראל. נראה אתכם מנצחים!',
    // גם כאן משתמשים באותה תמונה מתיקיית public
    images: ['/og-image.jpg'], 
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <head>
        {/* גופנים: Heebo לעברית ו-Rubik Glitch לכותרות */}
        <link
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;700;900&family=Rubik+Glitch&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}

        {/* טעינת ספריית האייקונים Lucide */}
        <Script
          src="https://unpkg.com/lucide@latest"
          strategy="afterInteractive"
        />

        {/* טעינת ספריית האפקטים (קונפטי) */}
        <Script
          src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js"
          strategy="afterInteractive"
        />

        {/* אתחול האייקונים לאחר טעינת העמוד */}
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