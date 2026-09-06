import { useRef, useState } from "react";
import { FolderTree, Database, UploadCloud, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Checkbox } from "./ui/checkbox";
import { Button } from "./ui/button";
import { FileTree } from "./FileTree";
import { CmsTab } from "./CmsTab";
import { api, errMsg, fmtBytes } from "../lib/api";

const QUICK = [["markdown", "Markdown docs"], ["code", "Code"], ["config", "Config"], ["generated", "App-generated"]];

export const SourcePicker = ({ workspace, collections, uploads, cms, sel, setSel, reloadUploads, reloadCms }) => {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef();
  const toggleSet = (key, val, force) => setSel((s) => { const n = new Set(s[key]); const on = force ?? !n.has(val); on ? n.add(val) : n.delete(val); return { ...s, [key]: n }; });
  const toggleMany = (paths, on) => setSel((s) => { const n = new Set(s.workspace); paths.forEach((p) => (on ? n.add(p) : n.delete(p))); return { ...s, workspace: n }; });
  const quick = (cat) => { const paths = workspace.filter((f) => f.category === cat).map((f) => f.path); const allOn = paths.every((p) => sel.workspace.has(p)); toggleMany(paths, !allOn); };

  const onFiles = async (files) => {
    if (!files?.length) return;
    const fd = new FormData();
    [...files].forEach((f) => fd.append("files", f));
    try { const { data } = await api.post("/sources/uploads", fd); toast.success(`Uploaded ${data.saved.length} file(s)`); data.saved.forEach((n) => toggleSet("uploads", n, true)); reloadUploads(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const removeUpload = async (name) => { await api.delete(`/sources/uploads/${encodeURIComponent(name)}`); toggleSet("uploads", name, false); reloadUploads(); };
  const total = sel.workspace.size + sel.collections.size + sel.uploads.size + sel.cms.size;

  return (
    <section className="panel p-4 space-y-3" data-testid="source-picker">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2"><FolderTree className="h-4 w-4 text-primary" /> 2 · Choose sources</h2>
        <div className="flex items-center gap-2">
          <span className="pill pill-info" data-testid="selection-count">{total} selected</span>
          {total > 0 && <button onClick={() => setSel({ workspace: new Set(), collections: new Set(), uploads: new Set(), cms: new Set() })} className="text-muted-foreground hover:text-white" data-testid="clear-selection-button"><X className="h-3.5 w-3.5" /></button>}
        </div>
      </div>
      <Tabs defaultValue="workspace">
        <TabsList className="grid grid-cols-4 bg-muted">
          <TabsTrigger value="workspace" data-testid="tab-workspace" className="text-xs">Workspace <span className="ml-1 font-mono text-[10px] opacity-70">{sel.workspace.size}</span></TabsTrigger>
          <TabsTrigger value="content" data-testid="tab-content" className="text-xs">Content <span className="ml-1 font-mono text-[10px] opacity-70">{sel.cms.size}</span></TabsTrigger>
          <TabsTrigger value="db" data-testid="tab-db" className="text-xs">DB <span className="ml-1 font-mono text-[10px] opacity-70">{sel.collections.size}</span></TabsTrigger>
          <TabsTrigger value="uploads" data-testid="tab-uploads" className="text-xs">Uploads <span className="ml-1 font-mono text-[10px] opacity-70">{sel.uploads.size}</span></TabsTrigger>
        </TabsList>
        <TabsContent value="workspace" className="space-y-2">
          <div className="flex flex-wrap gap-1.5">{QUICK.map(([c, l]) => <button key={c} onClick={() => quick(c)} className="pill border-border text-muted-foreground hover:text-white hover:bg-secondary transition-colors" data-testid={`quick-select-${c}`}>{l} · {workspace.filter((f) => f.category === c).length}</button>)}</div>
          <FileTree files={workspace} selected={sel.workspace} toggle={(p) => toggleSet("workspace", p)} toggleMany={toggleMany} />
          <p className="text-[11px] text-muted-foreground">.env, node_modules, .git and .gitignore’d paths are excluded automatically.</p>
        </TabsContent>
        <TabsContent value="content" className="space-y-2">
          <CmsTab cms={cms} selected={sel.cms} toggle={(id) => toggleSet("cms", id)} reloadCms={reloadCms} setSel={setSel} />
        </TabsContent>
        <TabsContent value="db" className="space-y-1" data-testid="collections-list">
          {collections.length === 0 && <p className="text-xs text-muted-foreground py-4">No collections found.</p>}
          {collections.map((c) => (
            <label key={c.name} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/60 cursor-pointer" data-testid={`collection-${c.name}`}>
              <Checkbox checked={sel.collections.has(c.name)} onCheckedChange={() => toggleSet("collections", c.name)} data-testid={`collection-check-${c.name}`} />
              <Database className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs font-mono flex-1">{c.name}</span>
              <span className="text-[10px] font-mono text-muted-foreground">{c.count} docs</span>
            </label>
          ))}
          <p className="text-[11px] text-muted-foreground pt-2">Exported as JSON to <span className="font-mono">backups/&lt;collection&gt;/&lt;collection&gt;_&lt;timestamp&gt;.json</span> — never clobbers previous snapshots.</p>
        </TabsContent>
        <TabsContent value="uploads" className="space-y-2">
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }} onClick={() => inputRef.current.click()}
            className={`grid place-items-center rounded-md border border-dashed p-5 cursor-pointer transition-colors ${drag ? "border-primary bg-primary/10" : "border-border hover:border-primary/60"}`} data-testid="upload-dropzone">
            <UploadCloud className="h-5 w-5 text-primary mb-1" />
            <p className="text-xs text-muted-foreground">Drop files or click to browse → pushed to <span className="font-mono">uploads/</span></p>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} data-testid="upload-input" />
          </div>
          <div data-testid="uploads-list">
            {uploads.map((u) => (
              <div key={u.name} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/60" data-testid={`upload-${u.name}`}>
                <Checkbox checked={sel.uploads.has(u.name)} onCheckedChange={() => toggleSet("uploads", u.name)} data-testid={`upload-check-${u.name}`} />
                <span className="text-xs font-mono flex-1 truncate">{u.name}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{fmtBytes(u.size)}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-red-400" onClick={() => removeUpload(u.name)} data-testid={`upload-delete-${u.name}`}><Trash2 className="h-3 w-3" /></Button>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
};
