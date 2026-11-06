import { DashboardNav } from "@/components/dashboard-nav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col md:flex-row selection:bg-emerald-500 selection:text-black">
      <DashboardNav />
      <main className="flex-1 overflow-y-auto p-6 md:p-10 max-w-7xl">
        {children}
      </main>
    </div>
  );
}
