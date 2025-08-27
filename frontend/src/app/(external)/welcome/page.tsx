"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function WelcomePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [answer, setAnswer] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const [cooldownTime, setCooldownTime] = useState(10);

  // ✅ Check verification & cooldown from server
  useEffect(() => {
    const checkVerification = async () => {
      const res = await fetch("/api/check-verification");
      const data = await res.json();

      if (data.verified) {
        router.push("/model/leaderboard");
      } else {
        if (data.cooldown > 0) {
          setCooldown(data.cooldown);
          setCooldownTime(data.cooldown);
        }
        setMounted(true);
      }
      setLoading(false);
    };
    checkVerification();
  }, [router]);

  // ✅ Countdown
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  if (loading) return <div className="flex min-h-screen items-center justify-center">Checking beta access...</div>;
  if (!mounted) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const res = await fetch("/api/verify-beta-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer, website }),
    });

    const data = await res.json();

    if (data.success) {
      router.push("/model/leaderboard");
    } else {
      let match = data.error?.match(/(\d+)s/);
      let banSeconds = match ? parseInt(match[1]) : cooldownTime;
      setCooldown(banSeconds);
      if (!match) setCooldownTime((prev) => prev * 2);
      setError(data.error || "❌ Incorrect. Try again.");
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="mb-4 text-3xl font-bold">🚧 This Website is Under Construction 🚧</h1>
      <p className="mb-6 text-center">Please answer this question for beta access:</p>

      <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4">
        <label htmlFor="botcheck" className="font-medium">
          What is the last name of the person who created this website?
        </label>

        <input
          id="botcheck"
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          className="w-64 rounded border px-3 py-2 text-center"
          placeholder="Enter name"
          required
          disabled={cooldown > 0}
        />

        <input
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="hidden"
          tabIndex={-1}
          autoComplete="off"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={cooldown > 0}
          className={`rounded px-4 py-2 text-white ${
            cooldown > 0 ? "cursor-not-allowed bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {cooldown > 0 ? `Retry in ${cooldown}s` : "Verify & Continue"}
        </button>
      </form>
    </div>
  );
}
