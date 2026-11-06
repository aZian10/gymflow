"use client";

import { useEffect, useState } from "react";

interface Member {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
}

interface Attendance {
  id: string;
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
  checkInTime: string;
  notes?: string;
}

export default function AttendanceDeskPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);

  // Check-in form
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadData = async () => {
    try {
      const [membersRes, attendanceRes] = await Promise.all([
        fetch("/api/tenant/members"),
        fetch("/api/tenant/attendance"),
      ]);

      if (membersRes.ok) {
        const m = await membersRes.json();
        setMembers(m.data || []);
      }

      if (attendanceRes.ok) {
        const a = await attendanceRes.json();
        setAttendances(a.data || []);
      }
    } catch (err) {
      console.error("Failed to load attendance desk data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMemberId) return;

    setSubmitting(true);
    setFeedback(null);

    // Client-side generated idempotency key (UUID v4)
    const idempotencyKey = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `checkin-${Date.now()}`;

    try {
      const res = await fetch("/api/tenant/attendance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          memberId: selectedMemberId,
          notes: notes || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After") || "60";
          setFeedback({
            type: "error",
            message: `Check-in rate limit reached (60/min). Retry in ${retryAfter}s.`,
          });
        } else {
          setFeedback({
            type: "error",
            message: data.error || "Failed to log check-in",
          });
        }
        return;
      }

      const isReplay = res.headers.get("X-Idempotent-Replay") === "true";
      setFeedback({
        type: "success",
        message: isReplay
          ? "Check-in acknowledged (Idempotent replay detected - no duplicate record logged)."
          : "Check-in logged successfully!",
      });

      setNotes("");
      loadData();
    } catch {
      setFeedback({
        type: "error",
        message: "Network error occurred while logging check-in.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Attendance Desk
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Rapid athlete check-in terminal with idempotency and double-tap prevention
          </p>
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-mono font-medium">
          <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
          Idempotency 24h Guard Active
        </div>
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-center justify-between ${
            feedback.type === "success"
              ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
              : "bg-red-950/40 border-red-800/60 text-red-300"
          }`}
        >
          <span>{feedback.message}</span>
          <button
            onClick={() => setFeedback(null)}
            className="font-bold text-lg leading-none hover:opacity-75"
          >
            ×
          </button>
        </div>
      )}

      {/* Check-In Action Terminal */}
      <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
          </svg>
          Quick Check-In Terminal
        </h2>

        <form onSubmit={handleCheckIn} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-5">
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              Select Athlete
            </label>
            <select
              required
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="">Choose a member...</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName} {m.lastName} ({m.email}) [{m.status}]
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-4">
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              Workout Notes / Desk Note
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Cardio, Upper body, Guest..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={submitting || !selectedMemberId}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
            >
              {submitting ? "Verifying..." : "Log Check-In"}
            </button>
          </div>
        </form>
      </div>

      {/* Attendance History Table */}
      <div className="space-y-3">
        <h3 className="text-base font-bold text-white">Today&apos;s Check-in Log</h3>
        <div className="rounded-2xl bg-zinc-900/40 border border-zinc-800 overflow-hidden">
          {loading ? (
            <div className="text-sm text-zinc-500 py-16 text-center">Loading check-in activity...</div>
          ) : attendances.length === 0 ? (
            <div className="text-sm text-zinc-500 py-16 text-center">
              No check-ins recorded yet. Select an athlete above to log an entry.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-950/60 border-b border-zinc-800 text-xs font-mono text-zinc-400 uppercase">
                  <tr>
                    <th className="px-6 py-3.5 font-semibold">Athlete</th>
                    <th className="px-6 py-3.5 font-semibold">Timestamp</th>
                    <th className="px-6 py-3.5 font-semibold">Desk Notes</th>
                    <th className="px-6 py-3.5 font-semibold">Security Scope</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {attendances.map((record) => (
                    <tr key={record.id} className="hover:bg-zinc-900/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-white">
                          {record.firstName} {record.lastName}
                        </div>
                        <div className="text-xs text-zinc-500 font-mono">{record.email}</div>
                      </td>
                      <td className="px-6 py-4 text-xs text-zinc-300 font-mono">
                        {new Date(record.checkInTime).toLocaleString([], {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="px-6 py-4 text-xs text-zinc-400">
                        {record.notes || "—"}
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[11px] font-mono">
                          Tenant Isolated
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
