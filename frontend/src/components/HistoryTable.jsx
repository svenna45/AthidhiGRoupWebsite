import { History, GitCommit, GitPullRequest, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { api } from "../lib/api";

const MODE = { direct: "pill-added", pr: "pill-modified", rejected: "pill-danger", failed: "pill-danger", noop: "pill-unchanged" };

export const HistoryTable = ({ history, reload }) => (
  <section className="panel p-4 space-y-3" data-testid="history-panel">
    <div className="flex items-center justify-between">
      <h2 className="text-base font-semibold flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Push history</h2>
      {history.length > 0 && <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-red-400 hover:bg-secondary" onClick={async () => { await api.delete("/history"); reload(); }} data-testid="clear-history-button"><Trash2 className="h-3 w-3 mr-1" />clear</Button>}
    </div>
    {history.length === 0 ? <p className="text-sm text-muted-foreground py-4" data-testid="history-empty">No pushes yet.</p> : (
      <div className="overflow-auto">
        <Table data-testid="push-history-table">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="eyebrow">when</TableHead><TableHead className="eyebrow">repo @ base</TableHead><TableHead className="eyebrow">mode</TableHead><TableHead className="eyebrow">files</TableHead><TableHead className="eyebrow">message</TableHead><TableHead className="eyebrow">links</TableHead></TableRow></TableHeader>
          <TableBody>
            {history.map((h) => (
              <TableRow key={h.id} data-testid={`history-row-${h.id}`} className="hover:bg-secondary/40">
                <TableCell className="font-mono text-xs whitespace-nowrap">{new Date(h.created_at).toLocaleString()}</TableCell>
                <TableCell className="font-mono text-xs">{h.repo} <span className="text-muted-foreground">@ {h.base_branch}</span></TableCell>
                <TableCell><span className={`pill ${MODE[h.mode]}`} data-testid="history-mode">{h.mode === "pr" ? "pr_created" : h.mode === "direct" ? "direct_commit" : h.mode}</span></TableCell>
                <TableCell className="font-mono text-xs" title={h.files.map((f) => f.path).join("\n")}>{h.file_count}</TableCell>
                <TableCell className="text-xs max-w-[260px] truncate" title={h.error || h.message}>{h.error ? <span className="text-red-300">{h.error}</span> : h.message}</TableCell>
                <TableCell className="text-xs font-mono whitespace-nowrap">
                  {h.commit_url && <a href={h.commit_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-400 hover:underline mr-3"><GitCommit className="h-3 w-3" />{h.commit_sha.slice(0, 7)}<ExternalLink className="h-3 w-3" /></a>}
                  {h.pr_url && <a href={h.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-amber-400 hover:underline"><GitPullRequest className="h-3 w-3" />#{h.pr_number}<ExternalLink className="h-3 w-3" /></a>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )}
  </section>
);
