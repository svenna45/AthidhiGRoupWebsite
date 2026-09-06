import { GitBranch, ShieldCheck, Gauge } from "lucide-react";

const RateMeter = ({ rl }) => {
  if (!rl?.limit) return <span className="eyebrow" data-testid="rate-limit-meter">rate limit —</span>;
  const pct = Math.round((rl.remaining / rl.limit) * 100);
  const color = pct > 50 ? "bg-emerald-500" : pct > 20 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2" data-testid="rate-limit-meter" title={`Resets ${rl.reset ? new Date(rl.reset).toLocaleTimeString() : ""}`}>
      <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${color} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-muted-foreground" data-testid="rate-limit-text">{rl.remaining}/{rl.limit}</span>
    </div>
  );
};

export const Header = ({ status }) => (
  <header className="sticky top-0 z-20 border-b border-border bg-[#0B0E14]/80 backdrop-blur-md">
    <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3 md:px-6">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 border border-primary/40 text-primary"><GitBranch className="h-5 w-5" /></div>
        <div>
          <h1 className="font-display text-lg font-bold leading-none tracking-tight" data-testid="app-title">GitHub Sync</h1>
          <p className="eyebrow mt-1">backup · dry-run · branch+pr on conflict</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <RateMeter rl={status?.rate_limit} />
        {status?.connected ? (
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 py-1 pl-1 pr-3" data-testid="connection-badge">
            {status.avatar_url ? <img src={status.avatar_url} alt="" className="h-6 w-6 rounded-full" /> : <ShieldCheck className="h-5 w-5 text-emerald-400" />}
            <span className="font-mono text-xs text-emerald-300">{status.login}</span>
          </div>
        ) : (
          <span className="pill pill-danger" data-testid="connection-badge">disconnected</span>
        )}
      </div>
    </div>
  </header>
);
