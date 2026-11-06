"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface TenantInfo {
  tenantSlug: string;
  schemaName: string;
  userRole: string;
}

export function DashboardNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [tenantInfo, setTenantInfo] = useState<TenantInfo>({
    tenantSlug: "Loading...",
    schemaName: "tenant_...",
    userRole: "STAFF",
  });

  useEffect(() => {
    async function fetchMe() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          setTenantInfo({
            tenantSlug: data.tenant.slug,
            schemaName: data.tenant.schemaName,
            userRole: data.user.role,
          });
        }
      } catch (err) {
        console.error("Failed to fetch tenant identity:", err);
      }
    }
    fetchMe();
  }, []);

  const navLinks = [
    { href: "/dashboard", label: "Overview", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
    { href: "/dashboard/members", label: "Members", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
    { href: "/dashboard/plans", label: "Plans", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
    { href: "/dashboard/attendance", label: "Attendance Desk", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  ];

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  };

  return (
    <aside className="w-full md:w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col justify-between p-4 flex-shrink-0">
      <div className="space-y-6">
        {/* Brand */}
        <div className="flex items-center gap-3 px-2 py-1">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center font-black text-black text-lg shadow-md shadow-emerald-500/20">
            G
          </div>
          <div>
            <div className="font-bold text-base tracking-tight text-white flex items-center gap-1.5">
              Gym<span className="text-emerald-400">Flow</span>
            </div>
            <div className="text-[10px] text-zinc-500 font-mono tracking-wide uppercase">Tenant Dashboard</div>
          </div>
        </div>

        {/* Tenant Isolation Badge */}
        <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-500 font-medium">Active Workspace</span>
            <span className="flex items-center gap-1 text-emerald-400 font-mono text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Isolated
            </span>
          </div>
          <div className="font-semibold text-xs text-white truncate" title={tenantInfo.tenantSlug}>
            {tenantInfo.tenantSlug}
          </div>
          <div className="font-mono text-[10px] text-zinc-400 truncate bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800/80" title={tenantInfo.schemaName}>
            {tenantInfo.schemaName}
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="space-y-1">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-900/60"
                }`}
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={link.icon} />
                </svg>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* User Info & Logout */}
      <div className="pt-4 border-t border-zinc-800 space-y-3">
        <div className="px-2 text-xs">
          <div className="text-zinc-500 font-mono text-[10px]">ROLE</div>
          <div className="text-zinc-300 font-medium">{tenantInfo.userRole}</div>
        </div>

        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-400 hover:text-red-400 border border-zinc-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {loggingOut ? "Signing Out..." : "Sign Out"}
        </button>
      </div>
    </aside>
  );
}
