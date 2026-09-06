import { useCallback, useEffect, useState } from "react";
import "@/App.css";
import { Toaster } from "@/components/ui/sonner";
import { Header } from "@/components/Header";
import { ConnectPanel } from "@/components/ConnectPanel";
import { SourcePicker } from "@/components/SourcePicker";
import { PreviewPanel } from "@/components/PreviewPanel";
import { HistoryTable } from "@/components/HistoryTable";
import { api } from "@/lib/api";

function App() {
  const [status, setStatus] = useState(null);
  const [workspace, setWorkspace] = useState([]);
  const [collections, setCollections] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [cms, setCms] = useState([]);
  const [history, setHistory] = useState([]);
  const [sel, setSel] = useState({ workspace: new Set(), collections: new Set(), uploads: new Set(), cms: new Set() });

  const refresh = useCallback(async () => setStatus((await api.get("/github/status")).data), []);
  const loadHistory = useCallback(async () => setHistory((await api.get("/history")).data), []);
  const loadUploads = useCallback(async () => setUploads((await api.get("/sources/uploads")).data), []);
  const loadCms = useCallback(async () => setCms((await api.get("/cms")).data), []);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    refresh().catch(() => {});
    loadHistory().catch(() => {});
    loadUploads().catch(() => {});
    loadCms().catch(() => {});
    api.get("/sources/workspace").then((r) => setWorkspace(r.data)).catch(() => {});
    api.get("/sources/collections").then((r) => setCollections(r.data)).catch(() => {});
  }, [refresh, loadHistory, loadUploads, loadCms]);

  const onPushed = () => { loadHistory(); refresh(); api.get("/sources/collections").then((r) => setCollections(r.data)); };

  return (
    <div className="App min-h-screen">
      <Header status={status} />
      <main className="mx-auto max-w-[1500px] p-4 md:p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-6">
            <ConnectPanel status={status} refresh={refresh} />
            <SourcePicker workspace={workspace} collections={collections} uploads={uploads} cms={cms} sel={sel} setSel={setSel} reloadUploads={loadUploads} reloadCms={loadCms} />
          </div>
          <div className="lg:col-span-8">
            <PreviewPanel status={status} sel={sel} onPushed={onPushed} refresh={refresh} />
          </div>
        </div>
        <HistoryTable history={history} reload={loadHistory} />
      </main>
      <Toaster theme="dark" richColors position="bottom-right" />
    </div>
  );
}

export default App;
