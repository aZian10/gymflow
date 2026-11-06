"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After") || "60";
          setError(`Rate limit exceeded (5 req/min). Please wait ${retryAfter} seconds before retrying.`);
        } else {
          setError(data.error || "Failed to authenticate. Please check your credentials.");
        }
        return;
      }

      // Success: session cookie is set by server (HttpOnly)
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("An unexpected network error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleDemoFill = () => {
    setEmail("leonidas@spartan.com");
    setPassword("SpartanPass123!");
    setError(null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-center py-12 px-6 lg:px-8 selection:bg-emerald-500 selection:text-black">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <Link href="/" className="inline-flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center font-black text-black text-2xl shadow-lg shadow-emerald-500/20">
            G
          </div>
          <span className="font-bold text-2xl tracking-tight text-white">
            Gym<span className="text-emerald-400">Flow</span>
          </span>
        </Link>
        <h2 className="text-2xl font-bold tracking-tight text-white mt-4">
          Sign in to your Gym Workspace
        </h2>
        <p className="text-sm text-zinc-400">
          Enter your gym credentials to load your isolated tenant context
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-zinc-900/70 border border-zinc-800 p-8 rounded-2xl shadow-xl space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-sm flex items-start gap-3">
              <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                Admin Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@spartan.com"
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99] text-sm mt-2"
            >
              {loading ? "Authenticating & Loading Schema..." : "Sign In to Workspace"}
            </button>
          </form>

          {/* Quick Demo Fill for Oral Defense */}
          <div className="pt-4 border-t border-zinc-800/80">
            <button
              type="button"
              onClick={handleDemoFill}
              className="w-full py-2.5 px-3 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 text-xs text-zinc-300 hover:text-white border border-zinc-700/50 flex items-center justify-center gap-2 transition-all font-mono"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              Fill Spartan Fitness Demo (leonidas@spartan.com)
            </button>
          </div>
        </div>

        <p className="text-center text-sm text-zinc-400 mt-6">
          Need a new gym workspace?{" "}
          <Link href="/register" className="font-medium text-emerald-400 hover:underline">
            Register your gym
          </Link>
        </p>
      </div>
    </div>
  );
}
