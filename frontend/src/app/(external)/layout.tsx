import "./external.css";
import { ThemeWrapper } from "./theme-wrapper";

export const metadata = {
  title: "SpectraGram",
  description: "Benchmark and profile speech models with ease.",
};

export default function ExternalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme-preset="soft-pop" className="min-h-screen antialiased">
      {/* ✅ ThemeWrapper still applies dynamic classes */}
      <ThemeWrapper>{children}</ThemeWrapper>
    </div>
  );
}
