import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-cairo",
});

export const metadata: Metadata = {
  title: "منصة الطباعة الذكية والبراندينج | YouAdv Hub",
  description: "خدمات الطباعة المباشرة، باقات الهوية والتغليف للمشاريع، وأداة المعاينة والتصميم الحية للطباعة الفورية.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${cairo.variable} font-sans bg-slate-50 text-slate-900 antialiased min-h-screen flex flex-col`}>
        {children}
      </body>
    </html>
  );
}
