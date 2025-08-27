"use client";

import { useEffect } from "react";

export function ThemeWrapper({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // ✅ Ensure dynamic theme classes are applied on the client
    document.documentElement.setAttribute("data-theme-preset", "soft-pop");

    // If Tailwind / CSS-in-JS generates runtime classnames
    document.body.classList.add("min-h-screen", "antialiased");
  }, []);

  return <>{children}</>;
}
