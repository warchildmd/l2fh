import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "L2 Farm Helper",
  description: "Farming calculator for mages and fighters on the Lineage 2 Reborn servers (C1, C2, C5).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased dark">
        {children}
      </body>
    </html>
  );
}
