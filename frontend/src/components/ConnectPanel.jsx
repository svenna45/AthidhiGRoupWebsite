import { useEffect, useState } from "react";
import { Key, Unplug, RefreshCw, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api, errMsg } from "../lib/api";

export const ConnectPanel = ({ status, refresh }) => {
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const [repos, setRepos] = useState([]);
  const [branches, setBranches] = useState([]);
  const [repo, setRepo] = useState(status?.repo || "");
  const [branch, setBranch] = useState(status?.branch || "");

  useEffect(() => { setRepo(status?.repo || ""); setBranch(status?.branch || ""); }, [status?.repo, status?.branch]);

  const loadRepos = async () => {
    try { setBusy(true); setRepos((await api.get("/github/repos")).data); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  useEffect(() => { if (status?.connected) loadRepos(); }, [status?.connected]); // eslint-disable-line

  useEffect(() => {
    if (!repo || !status?.connected) return;
    api.get("/github/branches", { params: { repo } }).then(({ data }) => {
      setBranches(data.branches);
      if (data.empty) { toast.info("Repository is empty — first push will initialize it."); if (!branch) setBranch(data.default_branch || "main"); }
      else if (!data.branches.includes(branch)) setBranch(data.default_branch || data.branches[0]);
    }).catch((e) => toast.error(errMsg(e)));
  }, [repo, status?.connected]); // eslint-disable-line

  const connect = async () => {
    try { setBusy(true); await api.post("/github/connect", { token: pat.trim() }); setPat(""); toast.success("GitHub connected"); await refresh(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const disconnect = async () => { await api.delete("/github/disconnect"); setRepos([]); setBranches([]); await refresh(); };
  const saveConfig = async () => {
    try { await api.put("/config", { repo, branch }); toast.success(`Target set: ${repo}@${branch}`); await refresh(); } catch (e) { toast.error(errMsg(e)); }
  };
  const saved = status?.repo === repo && status?.branch === branch && !!repo;

  return (
    <section className="panel p-4 space-y-4" data-testid="connect-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2"><Key className="h-4 w-4 text-primary" /> 1 · Connect</h2>
        {status?.connected && <Button size="sm" variant="ghost" onClick={disconnect} data-testid="disconnect-button" className="h-7 text-xs text-muted-foreground hover:text-white hover:bg-secondary"><Unplug className="h-3 w-3 mr-1" />disconnect</Button>}
      </div>
      {!status?.connected ? (
        <div className="space-y-2">
          <Input type="password" placeholder="github_pat_… (fine-grained, single repo)" value={pat} onChange={(e) => setPat(e.target.value)} data-testid="pat-input" className="font-mono text-xs bg-input" autoComplete="off" />
          <Button onClick={connect} disabled={busy || pat.trim().length < 20} data-testid="connect-button" className="w-full">{busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Validate & save encrypted"}</Button>
          <p className="text-xs text-muted-foreground leading-relaxed">Needs <span className="font-mono">Contents</span> + <span className="font-mono">Pull requests</span> read/write. Encrypted with Fernet server-side, never logged or committed.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1"><span className="eyebrow">repository</span><button onClick={loadRepos} className="text-muted-foreground hover:text-white" data-testid="refresh-repos-button"><RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /></button></div>
            <Select value={repo} onValueChange={setRepo}>
              <SelectTrigger data-testid="repo-select" className="bg-input font-mono text-xs"><SelectValue placeholder="Select repository" /></SelectTrigger>
              <SelectContent className="max-h-72">{repos.map((r) => <SelectItem key={r.full_name} value={r.full_name} className="font-mono text-xs">{r.full_name}{r.private ? " 🔒" : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <span className="eyebrow block mb-1">base branch</span>
            {branches.length ? (
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger data-testid="branch-select" className="bg-input font-mono text-xs"><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>{branches.map((b) => <SelectItem key={b} value={b} className="font-mono text-xs">{b}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" data-testid="branch-input" className="bg-input font-mono text-xs" />
            )}
          </div>
          <Button onClick={saveConfig} disabled={!repo || !branch} variant={saved ? "secondary" : "default"} className="w-full" data-testid="save-config-button">
            {saved ? <><Check className="h-4 w-4 mr-1" /> Target saved</> : "Use this repo & branch"}
          </Button>
        </div>
      )}
    </section>
  );
};
