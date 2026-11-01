import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlas Trading Co. | Operations",
  description: "A clear view of sales, stock, and receivables at Atlas Trading Co.",
};

export default async function RootLayout({ children, params }: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale?: string }>;
}>) {
  const { locale = "en" } = await params;
  return <html lang={locale}><body>{children}</body></html>;
}
