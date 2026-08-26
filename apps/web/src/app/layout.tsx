import type { Metadata } from "next";
import { Space_Grotesk, Inter, Oswald } from "next/font/google";
import "../styles/tokens.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display-loaded",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body-loaded",
  display: "swap",
});

const oswald = Oswald({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-third-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Skybox",
  description:
    "Live TV, sports, and your movies and shows — one unified viewing experience.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark">
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} ${oswald.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
