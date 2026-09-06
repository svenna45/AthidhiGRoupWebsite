import { useState } from "react";
import { FileText, Plus, Pencil, Trash2, FileEdit } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "./ui/checkbox";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api, errMsg } from "../lib/api";

const EMPTY = { title: "", slug: "", type: "doc", status: "draft", body: "" };

export const CmsTab = ({ cms, selected, toggle, reloadCms, setSel }) => {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const startNew = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const startEdit = (c) => { setEditing(c); setForm({ title: c.title, slug: c.slug, type: c.type, status: c.status, body: c.body }); setOpen(true); };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    try {
      if (editing) await api.put(`/cms/${editing.id}`, form);
      else await api.post("/cms", form);
      toast.success(editing ? "Content updated" : "Content created");
      setOpen(false);
      reloadCms();
    } catch (e) { toast.error(errMsg(e)); } finally { setSaving(false); }
  };

  const remove = async (c) => {
    try {
      await api.delete(`/cms/${c.id}`);
      setSel((s) => { const n = new Set(s.cms); n.delete(c.id); return { ...s, cms: n }; });
      toast.success("Content deleted");
      reloadCms();
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div className="space-y-2" data-testid="cms-list">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">Authored in-app · pushed to <span className="font-mono">content/&lt;slug&gt;.md</span></p>
        <Button size="sm" variant="secondary" onClick={startNew} data-testid="cms-new-button" className="h-7 text-xs"><Plus className="h-3.5 w-3.5 mr-1" /> New</Button>
      </div>

      {cms.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center border border-dashed border-border rounded-md" data-testid="cms-empty">No content yet. Click “New” to author your first entry.</p>}

      {cms.map((c) => (
        <div key={c.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/60" data-testid={`cms-item-${c.id}`}>
          <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} data-testid={`cms-check-${c.id}`} />
          <FileText className="h-3.5 w-3.5 text-emerald-400" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{c.title}</div>
            <div className="text-[10px] font-mono text-muted-foreground truncate">content/{c.slug}.md</div>
          </div>
          <span className={`pill ${c.status === "published" ? "pill-info" : "border-border text-muted-foreground"}`}>{c.status}</span>
          <span className="pill border-border text-muted-foreground">{c.type}</span>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-white" onClick={() => startEdit(c)} data-testid={`cms-edit-${c.id}`}><Pencil className="h-3 w-3" /></Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-red-400" onClick={() => remove(c)} data-testid={`cms-delete-${c.id}`}><Trash2 className="h-3 w-3" /></Button>
        </div>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" data-testid="cms-editor-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileEdit className="h-4 w-4 text-primary" /> {editing ? "Edit content" : "New content"}</DialogTitle>
            <DialogDescription>Authored in-app and pushed to GitHub as <span className="font-mono">content/&lt;slug&gt;.md</span>.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Getting Started" data-testid="cms-title-input" className="bg-input" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Slug (optional)</Label>
                <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="auto from title" data-testid="cms-slug-input" className="bg-input font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={form.type} onValueChange={(v) => set("type", v)}>
                  <SelectTrigger data-testid="cms-type-select" className="bg-input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="doc">Doc</SelectItem>
                    <SelectItem value="page">Page</SelectItem>
                    <SelectItem value="post">Post</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger data-testid="cms-status-select" className="bg-input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Body (Markdown)</Label>
              <Textarea value={form.body} onChange={(e) => set("body", e.target.value)} placeholder="# Heading&#10;&#10;Write markdown here…" rows={12} data-testid="cms-body-input" className="bg-input font-mono text-xs resize-y" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} data-testid="cms-cancel-button">Cancel</Button>
            <Button onClick={save} disabled={saving} data-testid="cms-save-button">{saving ? "Saving…" : editing ? "Save changes" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
