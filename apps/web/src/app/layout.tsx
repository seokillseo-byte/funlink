import type {Metadata} from "next";
import "./globals.css";
import {siteUrl} from "../lib/site-url";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: "FunLink — URL management",
  description: "Quản lý liên kết và workspace của bạn.",
  alternates: {canonical: "/"}
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="vi"><body>{children}</body></html>;
}
