import "./globals.css";
import type { Metadata } from "next";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Pace: your Quercus study coach",
  description: "Turns Quercus deadlines into a study plan you can keep, with Gemini.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">
          <Nav signOut={!!process.env.APP_PASSWORD} />
          {children}
        </div>
      </body>
    </html>
  );
}
