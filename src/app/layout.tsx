import type { ReactNode } from "react";
import "./globals.css";
import { navA } from "./nav.a";
import { navB } from "./nav.b";
import { Shell } from "@/components/shell/Shell";

export const metadata = { title: "Vinayak procurement", description: "From site requirement to approved vendor." };
export const viewport = { themeColor: "#010102", colorScheme: "dark" as const };

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><Shell nav={[...navA, ...navB]}>{children}</Shell></body>
    </html>
  );
}
