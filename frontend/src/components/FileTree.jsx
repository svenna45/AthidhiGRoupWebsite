import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, FileCode, FileText, FileJson, File, Folder } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { fmtBytes } from "../lib/api";

const iconFor = (cat) => (cat === "markdown" ? FileText : cat === "config" ? FileJson : cat === "code" ? FileCode : File);

const build = (files) => {
  const root = { name: "", children: {}, files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (const p of parts.slice(0, -1)) {
      if (!node.children[p]) node.children[p] = { name: p, children: {}, files: [] };
      node = node.children[p];
    }
    node.files.push(f);
  }
  return root;
};

function allPaths(node) {
  const own = node.files.map((f) => f.path);
  const nested = Object.values(node.children).flatMap((c) => allPaths(c));
  return own.concat(nested);
}

function Dir({ node, depth, selected, toggle, toggleMany, path }) {
  const [open, setOpen] = useState(depth < 1);
  const paths = useMemo(() => allPaths(node), [node]);
  const count = paths.filter((p) => selected.has(p)).length;
  const state = count === 0 ? false : count === paths.length ? true : "indeterminate";
  const kids = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      <div className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-secondary/60 cursor-pointer select-none" style={{ paddingLeft: depth * 14 + 4 }} data-testid={`tree-dir-${path || "root"}`}>
        <button onClick={() => setOpen(!open)} className="text-muted-foreground" data-testid={`tree-toggle-${path}`}>{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
        <Checkbox checked={state} onCheckedChange={(v) => toggleMany(paths, !!v)} data-testid={`tree-dir-check-${path}`} className="h-3.5 w-3.5" />
        <Folder className="h-3.5 w-3.5 text-blue-400" onClick={() => setOpen(!open)} />
        <span className="text-xs font-mono flex-1" onClick={() => setOpen(!open)}>{node.name}/</span>
        <span className="text-[10px] font-mono text-muted-foreground">{count}/{paths.length}</span>
      </div>
      {open && (
        <div>
          {kids.map((c) => (
            <DirNode key={c.name} node={c} depth={depth + 1} selected={selected} toggle={toggle} toggleMany={toggleMany} path={path ? `${path}/${c.name}` : c.name} />
          ))}
          {node.files.map((f) => {
            const Icon = iconFor(f.category);
            return (
              <label key={f.path} className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-secondary/60 cursor-pointer" style={{ paddingLeft: depth * 14 + 26 }} data-testid={`tree-file-${f.path}`}>
                <Checkbox checked={selected.has(f.path)} onCheckedChange={() => toggle(f.path)} data-testid={`tree-file-check-${f.path}`} className="h-3.5 w-3.5" />
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-mono flex-1 truncate">{f.path.split("/").pop()}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{fmtBytes(f.size)}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

const DirNode = Dir;

export const FileTree = ({ files, selected, toggle, toggleMany }) => {
  const root = useMemo(() => build(files), [files]);
  const kids = Object.values(root.children).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="max-h-[360px] overflow-auto pr-1" data-testid="workspace-file-tree">
      {kids.map((c) => (
        <DirNode key={c.name} node={c} depth={0} selected={selected} toggle={toggle} toggleMany={toggleMany} path={c.name} />
      ))}
      {root.files.map((f) => {
        const Icon = iconFor(f.category);
        return (
          <label key={f.path} className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-secondary/60 cursor-pointer pl-[26px]" data-testid={`tree-file-${f.path}`}>
            <Checkbox checked={selected.has(f.path)} onCheckedChange={() => toggle(f.path)} data-testid={`tree-file-check-${f.path}`} className="h-3.5 w-3.5" />
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-mono flex-1 truncate">{f.path}</span>
            <span className="text-[10px] font-mono text-muted-foreground">{fmtBytes(f.size)}</span>
          </label>
        );
      })}
    </div>
  );
};
