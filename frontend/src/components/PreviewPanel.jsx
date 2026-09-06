import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, Play, ShieldAlert, AlertTriangle, GitCommit, GitPullRequest, ExternalLink, ChevronDown, ChevronRight, RefreshCw, CheckCircle, Anchor } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { DiffView } from "./DiffView";
import { api, errMsg, fmtBytes } from "../lib/api";

const STEPS = ["Reading remote HEAD", "Secret scan", "Checking divergence", "Committing / branch + PR"];

const FileRow = ({ f, findings }) => {
  const [open, setOpen] = useState(false);
  const flagged = findings.filter((x) => x.path === f.path);
  return (
    <div className={`border rounded-md overflow-hidden ${flagged.length ? "border-red-500/60" : "border-border"}`} data-testid={`preview-file-${f.path}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/50 transition-colors" data-testid={`preview-file-toggle-${f.path}`}>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className={`pill pill-${f.status}`}>{f.status}</span>
        <span className="font-mono text-xs flex-1 truncate">{f.path}</span>
        {flagged.length > 0 && <span className="pill pill-danger"><ShieldAlert className="h-3 w-3" /> {flagged.length} secret{flagged.length > 1 ? "s" : ""}</span>}
        <span className="pill border-border text-muted-foreground">{f.source}</span>
        <span className="text-[10px] font-mono text-muted-foreground w-16 text-right">{fmtBytes(f.size)}</span>
      </button>
      <AnimatePresence initial={false}>{open && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden border-t border-border">
          {flagged.map((x, i) => <div key={i} className="px-3 py-1 text-xs font-mono text-red-300 bg-red-500/10" data-testid="secret-finding">line {x.line}: {x.kind}</div>)}
          <DiffView lines={f.diff} path={f.path} />
        </motion.div>
      )}</AnimatePresence>
    </div>
  );
};

export const PreviewPanel = ({ status, sel, onPushed, refresh }) => {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const body = () => ({ workspace_paths: [...sel.workspace], upload_names: [...sel.uploads], collections: [...sel.collections], cms_ids: [...sel.cms], message });
  const total = sel.workspace.size + sel.collections.size + sel.uploads.size + sel.cms.size;
  const ready = status?.connected && status?.repo && total > 0;

  const preview = async () => {
    setResult(null);
    try { setBusy(true); const { data } = await api.post("/push/preview", body()); setReport(data); refresh(); if (data.secret_findings.length) toast.warning(`${data.secret_findings.length} potential secret(s) found — push is blocked`); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const push = async () => {
    setPushing(true); setStep(0);
    const timers = [1, 2, 3].map((i) => setTimeout(() => setStep(i), i * 700));
    try {
      const { data } = await api.post("/push", body());
      setResult(data); setReport(null);
      if (data.mode === "direct") toast.success("Committed directly to base branch");
      else if (data.mode === "pr") toast.success("Remote changed — opened a PR instead");
      else toast.info(data.message);
      onPushed();
    } catch (e) { toast.error(errMsg(e)); const rep = e?.response?.data?.detail?.report; if (rep) setReport(rep); onPushed(); }
    finally { timers.forEach(clearTimeout); setPushing(false); setStep(-1); }
  };
  const acceptBaseline = async () => { try { await api.post("/config/baseline"); toast.success("Remote HEAD accepted as baseline"); await refresh(); setReport(null); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <section className="panel p-4 space-y-4" data-testid="preview-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold flex items-center gap-2"><Eye className="h-4 w-4 text-primary" /> 3 · Dry-run & push</h2>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={preview} disabled={!ready || busy || pushing} data-testid="preview-button" className="hover:bg-secondary/80">{busy ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : <Eye className="h-4 w-4 mr-1" />} Preview diff</Button>
          <Button onClick={push} disabled={!ready || !report || report.blocked || pushing} data-testid="push-to-github-button" className={report && !report.blocked ? "glow-primary" : ""}>{pushing ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />} Push to GitHub</Button>
        </div>
      </div>
      <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Commit message (optional — defaults to chore(sync): backup <timestamp>)" data-testid="commit-message-input" className="bg-input text-sm" />

      {!ready && <p className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-6 text-center" data-testid="preview-empty-state">{!status?.connected ? "Connect GitHub to begin." : !status?.repo ? "Select and save a target repo & branch." : "Select files, collections or uploads on the left, then preview."}</p>}

      {pushing && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="push-progress">
          {STEPS.map((s, i) => <div key={s} className={`rounded-md border px-3 py-2 text-xs font-mono transition-colors ${i < step ? "border-emerald-500/50 text-emerald-300" : i === step ? "border-primary text-white bg-primary/10" : "border-border text-muted-foreground"}`}>{i + 1}. {s}</div>)}
        </div>
      )}

      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`rounded-md border p-4 space-y-2 ${result.mode === "pr" ? "border-amber-500/50 bg-amber-500/5" : "border-emerald-500/50 bg-emerald-500/5"}`} data-testid="push-result">
          <div className="flex items-center gap-2">
            {result.mode === "pr" ? <GitPullRequest className="h-5 w-5 text-amber-400" /> : result.mode === "direct" ? <GitCommit className="h-5 w-5 text-emerald-400" /> : <CheckCircle className="h-5 w-5 text-emerald-400" />}
            <span className="font-semibold" data-testid="push-result-mode">{result.mode === "pr" ? "Pull request opened (conflict-safe)" : result.mode === "direct" ? "Direct commit to base branch" : "Nothing to push"}</span>
          </div>
          <p className="text-sm text-muted-foreground">{result.reason || result.message}</p>
          <div className="flex flex-wrap gap-3 text-xs font-mono">
            {result.history?.commit_url && <a href={result.history.commit_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-400 hover:underline" data-testid="result-commit-link"><GitCommit className="h-3 w-3" />{result.history.commit_sha.slice(0, 10)} <ExternalLink className="h-3 w-3" /></a>}
            {result.history?.pr_url && <a href={result.history.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-amber-400 hover:underline" data-testid="result-pr-link"><GitPullRequest className="h-3 w-3" />PR #{result.history.pr_number} on {result.history.branch} <ExternalLink className="h-3 w-3" /></a>}
          </div>
        </motion.div>
      )}

      {report && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3" data-testid="diff-preview-container">
          <div className={`rounded-md border p-3 flex flex-wrap items-center gap-3 ${report.predicted_mode === "pr" ? "border-amber-500/50 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5"}`} data-testid="predicted-mode">
            {report.predicted_mode === "pr" ? <GitPullRequest className="h-4 w-4 text-amber-400" /> : <GitCommit className="h-4 w-4 text-emerald-400" />}
            <span className="text-sm flex-1">{report.reason}</span>
            <span className="pill pill-info">{report.summary.added} added</span>
            <span className="pill pill-modified">{report.summary.modified} modified</span>
            <span className="pill pill-unchanged">{report.summary.unchanged} unchanged</span>
            <span className="font-mono text-[10px] text-muted-foreground">HEAD {report.remote_head ? report.remote_head.slice(0, 8) : "∅ empty"}</span>
            {report.predicted_mode === "pr" && report.baseline && <Button size="sm" variant="ghost" onClick={acceptBaseline} className="h-7 text-xs text-amber-300 hover:text-white hover:bg-amber-500/20" data-testid="accept-baseline-button"><Anchor className="h-3 w-3 mr-1" />Accept remote as baseline</Button>}
          </div>
          {report.secret_findings.length > 0 && (
            <div className="rounded-md border border-red-500 bg-red-500/15 p-3 text-sm" data-testid="secret-warning">
              <div className="flex items-center gap-2 font-semibold text-red-300"><ShieldAlert className="h-4 w-4" /> Push blocked — {report.secret_findings.length} potential secret(s) detected</div>
              <p className="text-xs text-red-200/80 mt-1">Deselect the flagged files (or scrub the values) before pushing. This tool never commits credential-like strings.</p>
            </div>
          )}
          {report.size_warnings.map((w) => (
            <div key={w.path} className={`rounded-md border p-3 text-xs flex items-start gap-2 ${w.level === "error" ? "border-red-500 bg-red-500/15 text-red-200" : "border-amber-500 bg-amber-500/15 text-amber-100"}`} data-testid="size-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" /> <span><span className="font-mono">{w.path}</span> — {w.message}</span>
            </div>
          ))}
          <div className="space-y-1.5" data-testid="preview-file-list">{report.files.map((f) => <FileRow key={f.path} f={f} findings={report.secret_findings} />)}</div>
        </motion.div>
      )}
    </section>
  );
};
