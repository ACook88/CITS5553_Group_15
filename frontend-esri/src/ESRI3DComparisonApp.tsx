import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  FileArchive,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  X,
  BarChart3,
  GitCompare,
  Download,
  Info,
  LayoutGrid,
} from "lucide-react";
import JSZip from "jszip";
import * as THREE from "three";
import { fetchColumns } from "./api/data";
import {
  runSummary,
  runPlotsData,
  runComparison,
  exportPlots,
  type PlotData,
} from "./api/analysis";
import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";

const isAcceptedName = (name: string) => {
  const lower = name.toLowerCase().trim();
  return lower.endsWith(".zip") || lower.endsWith(".csv");
};
const isAccepted = (file: File | null | undefined) =>
  !!file && isAcceptedName(file.name);
const clampPercent = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const REQUIRED_FIELD_KEYS = ["Northing", "Easting", "Assay"] as const;
type RequiredFieldKey = (typeof REQUIRED_FIELD_KEYS)[number];
type ColumnMapping = Partial<Record<RequiredFieldKey, string>>;

type ThreeStash = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  animId: number;
  onResize: () => void;
};

export default function ESRI3DComparisonApp() {
  type Section =
    | "data-loading"
    | "data-analysis"
    | "comparisons"
    | "export"
    | "about";
  const [section, setSection] = useState<Section>("data-loading");

  const [originalZip, setOriginalZip] = useState<File | null>(null);
  const [dlZip, setDlZip] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ original?: string; dl?: string }>({});
  const [toast, setToast] = useState<{ msg: string } | null>(null);

  const [originalColumns, setOriginalColumns] = useState<string[]>([]);
  const [dlColumns, setDlColumns] = useState<string[]>([]);
  const [loadingColumns, setLoadingColumns] = useState(false);

  const [originalMap, setOriginalMap] = useState<ColumnMapping>({});
  const [dlMap, setDlMap] = useState<ColumnMapping>({});

  // Run Analysis in Data Analysis
  const [analysisRun, setAnalysisRun] = useState(false);

  // --- Analysis stats (Original / DL) ---
  type Summary = {
    count: number;
    mean: number | null;
    median: number | null;
    max: number | null;
    std: number | null;
  };
  const [statsOriginal, setStatsOriginal] = useState<Summary | null>(null);
  const [statsDl, setStatsDl] = useState<Summary | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // --- Plots state ---
  const [plotsLoading, setPlotsLoading] = useState(false);
  const [plotsData, setPlotsData] = useState<{
    original?: PlotData;
    dl?: PlotData;
    qq?: PlotData;
  }>({});

  // Add these two states near your other useState lines
  const [gridOut, setGridOut] = useState<null | {
    nx: number;
    ny: number;
    xmin: number;
    ymin: number;
    cell: number;
    orig: number[][];
    dl: number[][];
    cmp: number[][];
    x: number[];
    y: number[]; // centers returned by backend
    coord_units?: "meters" | "degrees"; // units flag returned by backend
    cell_x: number;
    cell_y: number; // cell sizes in axis units (NEW)
    original_points?: number[][];
    dl_points?: number[][];
  }>(null);

  const [cmpLoading, setCmpLoading] = useState(false);

  // Comparison controls
  const [method, setMethod] = useState<null | "max" | "mean" | "median">(null);
  const [gridSize, setGridSize] = useState<number | null>(100000);

  // Run state
  const [runId, setRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [busyRun, setBusyRun] = useState(false);
  const [unzipping, setUnzipping] = useState(false);
  const [originalList, setOriginalList] = useState<
    Array<{ name: string; size: number }>
  >([]);
  const [dlList, setDlList] = useState<Array<{ name: string; size: number }>>(
    []
  );
  const [progress, setProgress] = useState<{ original: number; dl: number }>({
    original: 0,
    dl: 0,
  });

  const inputOriginalRef = useRef<HTMLInputElement | null>(null);
  const inputDlRef = useRef<HTMLInputElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<ThreeStash | null>(null);

  // Mapping completeness (used only to enable Run Analysis)
  const mappingComplete = useMemo(() => {
    const leftOk = REQUIRED_FIELD_KEYS.every((k) => !!originalMap[k]);
    const rightOk = REQUIRED_FIELD_KEYS.every((k) => !!dlMap[k]);
    return leftOk && rightOk;
  }, [originalMap, dlMap]);

  // Controls enabled after both uploads
  const comparisonControlsEnabled = !!originalZip && !!dlZip;

  // Export after 1,2,4 chosen
  const exportEnabled = !!originalZip && !!dlZip && method !== null;

  // Plot selection state for export
  const [selectedPlots, setSelectedPlots] = useState<{
    originalHistogram: boolean;
    dlHistogram: boolean;
    qqPlot: boolean;
    originalHeatmap: boolean;
    dlHeatmap: boolean;
    comparisonHeatmap: boolean;
  }>({
    originalHistogram: false,
    dlHistogram: false,
    qqPlot: false,
    originalHeatmap: false,
    dlHeatmap: false,
    comparisonHeatmap: false,
  });

  const [showPlotSelection, setShowPlotSelection] = useState(false);

  // Export states to match other button patterns
  const [exportLoading, setExportLoading] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Ready to run comparison (full pipeline)
  const readyToRun =
    !!originalZip &&
    !!dlZip &&
    originalColumns.length > 0 &&
    dlColumns.length > 0 &&
    mappingComplete &&
    method !== null &&
    gridSize !== null &&
    gridSize >= 100 &&
    !busyRun;

  const [dataLoaded, setDataLoaded] = useState(false);

  const isZip = (file: File | null | undefined) =>
    !!file && isAcceptedName(file.name);

  const validateAndSet = useCallback(
    (file: File | null, kind: "original" | "dl") => {
      if (!file) {
        if (kind === "original") setOriginalZip(null);
        if (kind === "dl") setDlZip(null);
        setErrors((e) => ({ ...e, [kind]: undefined }));
        return;
      }
      if (!isAccepted(file)) {
        setErrors((e) => ({
          ...e,
          [kind]: "Only .zip or .csv files are accepted.",
        }));
        return;
      }
      setErrors((e) => ({ ...e, [kind]: undefined }));
      if (kind === "original") setOriginalZip(file);
      if (kind === "dl") setDlZip(file);
      setToast({
        msg: `${
          kind === "original" ? "Original ESRI" : "DL ESRI"
        } file uploaded successfully.`,
      });
    },
    []
  );

  const handleInput = (
    e: React.ChangeEvent<HTMLInputElement>,
    kind: "original" | "dl"
  ) => {
    const file = e.target.files?.[0] ?? null;
    validateAndSet(file, kind);
  };

  const onDrop = (
    ev: React.DragEvent<HTMLDivElement>,
    kind: "original" | "dl"
  ) => {
    ev.preventDefault();
    const file = ev.dataTransfer.files?.[0];
    validateAndSet(file ?? null, kind);
  };
  const onDragOver = (ev: React.DragEvent<HTMLDivElement>) =>
    ev.preventDefault();

  // three.js helpers
  const safelyDisposeThree = useCallback((container: HTMLDivElement | null) => {
    const stash = threeRef.current;
    if (!stash) return;
    try {
      cancelAnimationFrame(stash.animId);
    } catch {}
    try {
      window.removeEventListener("resize", stash.onResize);
    } catch {}
    try {
      const canvas = stash.renderer?.domElement;
      const parent = canvas?.parentNode as (Node & ParentNode) | null;
      if (canvas && parent && parent.contains(canvas))
        parent.removeChild(canvas);
    } catch {}
    try {
      stash.renderer?.dispose();
    } catch {}
    threeRef.current = null;
  }, []);

  const renderPlaceholder3D = useCallback(() => {
    const container = plotRef.current;
    if (!container) return;
    safelyDisposeThree(container);

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf9fafb);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(3, 2.2, 4);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(5, 10, 7);
    scene.add(dir);

    const planeGeo = new THREE.PlaneGeometry(12, 12);
    const planeMat = new THREE.MeshStandardMaterial({
      color: 0xeeeeee,
      roughness: 1,
      metalness: 0,
    });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -1.25;
    plane.receiveShadow = true;
    scene.add(plane);

    const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    const purpleMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed });
    const amberMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b });
    const cube1 = new THREE.Mesh(cubeGeo, purpleMat);

    const clock = new THREE.Clock();
    const animate = () => {
      const t = clock.getElapsedTime();
      cube1.rotation.x = t * 0.6;
      cube1.rotation.y = t * 0.9;
      cube2.rotation.x = -t * 0.5;
      cube2.rotation.y = -t * 0.8;
      renderer.render(scene, camera);
      const id = requestAnimationFrame(animate);
      if (threeRef.current) threeRef.current.animId = id;
    };

    const onResize = () => {
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", onResize);
    threeRef.current = {
      renderer,
      scene,
      camera,
      animId: requestAnimationFrame(animate),
      onResize,
    };
  }, [safelyDisposeThree]);

  useEffect(
    () => () => {
      safelyDisposeThree(plotRef.current);
    },
    [safelyDisposeThree]
  );

  async function inspectZipColumns(file: File): Promise<string[]> {
    try {
      if (file.name.toLowerCase().endsWith(".csv")) {
        // For CSV, fake columns (should parse header in real app)
        return [
          "ID",
          "Northing",
          "Easting",
          "RL",
          "Assay",
          "Te_ppm",
          "Au_ppb",
          "Depth",
        ];
      }
      const buf = await file.arrayBuffer();
      await JSZip.loadAsync(buf);
      return [
        "ID",
        "Northing",
        "Easting",
        "RL",
        "Assay",
        "Te_ppm",
        "Au_ppb",
        "Depth",
      ];
    } catch {
      return ["ID", "Northing", "Easting", "Assay"];
    }
  }

  async function onLoadData() {
    if (!originalZip || !dlZip || loadingColumns || dataLoaded) return;
    setLoadingColumns(true);
    setOriginalList([{ name: originalZip.name, size: originalZip.size }]);
    setDlList([{ name: dlZip.name, size: dlZip.size }]);
    setProgress({ original: 100, dl: 100 });

    try {
      // Ask backend for real columns
      const { original_columns, dl_columns } = await fetchColumns(
        originalZip,
        dlZip
      );

      setOriginalColumns(original_columns);
      setDlColumns(dl_columns);

      // reset mappings so user re-selects
      setOriginalMap({});
      setDlMap({});
      setAnalysisRun(false);
      setStatsOriginal(null);
      setStatsDl(null);
      setDataLoaded(true);
    } catch (e: any) {
      // Show error and also clear loading state and progress
      alert(e?.message || "Failed to read columns");
      setDataLoaded(false);
      setOriginalColumns([]);
      setDlColumns([]);
      setOriginalList([]);
      setDlList([]);
      setProgress({ original: 0, dl: 0 });
    } finally {
      setLoadingColumns(false);
    }
  }

  // Run Analysis → clean assay (drop <= 0) & compute stats via backend
  async function handleRunAnalysis() {
    if (!originalZip || !dlZip) {
      alert("Upload both files and click Load Data first.");
      return;
    }
    const oAssay = originalMap["Assay"];
    const dAssay = dlMap["Assay"];
    if (!oAssay || !dAssay) {
      alert("Select the Assay column on both sides.");
      return;
    }

    setAnalysisLoading(true);
    setStatsOriginal(null);
    setStatsDl(null);

    try {
      const { original, dl } = await runSummary(
        originalZip,
        dlZip,
        oAssay,
        dAssay
      );
      setStatsOriginal(original);
      setStatsDl(dl);
      setAnalysisRun(true);
    } catch (err: any) {
      console.error("Run Analysis failed:", err);
      const msg =
        typeof err?.message === "string" ? err.message : "Run Analysis failed";
      alert(msg);
    } finally {
      setAnalysisLoading(false);
    }
  }

  // --- Plots handler ---
  async function handleShowPlots() {
    if (!originalZip || !dlZip) return;
    const oAssay = originalMap["Assay"];
    const dAssay = dlMap["Assay"];
    if (!oAssay || !dAssay) {
      alert("Select the Assay column on both sides.");
      return;
    }
    try {
      setPlotsLoading(true);
      setPlotsData({});

      // Get plot data
      const plotData = await runPlotsData(originalZip, dlZip, oAssay, dAssay);

      setPlotsData({
        original: plotData.original_data,
        dl: plotData.dl_data,
        qq: plotData.qq_data,
      });
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Failed to render plots");
    } finally {
      setPlotsLoading(false);
    }
  }

  // Run Comparison → same action pattern as Load Data / Run Analysis
  async function handleRunComparison() {
    if (
      !readyToRun ||
      !analysisRun ||
      !originalZip ||
      !dlZip ||
      !method ||
      !gridSize
    ) {
      alert(
        "Complete the steps first: Load Data → Mappings → Run Analysis → pick Method & Grid."
      );
      return;
    }

    setCmpLoading(true);
    setRunError(null);
    setGridOut(null); // like starting fresh
    try {
      const map = {
        oN: originalMap["Northing"]!,
        oE: originalMap["Easting"]!,
        oA: originalMap["Assay"]!,
        dN: dlMap["Northing"]!,
        dE: dlMap["Easting"]!,
        dA: dlMap["Assay"]!,
      };
      const out = await runComparison(
        originalZip,
        dlZip,
        map,
        method,
        gridSize
      );
      setGridOut(out);
      setRunId("ok"); // mark success (enables Export etc.)
      setToast({ msg: "Comparison complete. Heatmaps ready." });
    } catch (e: any) {
      console.error(e);
      setRunError(
        typeof e?.message === "string" ? e.message : "Comparison failed"
      );
      alert(e?.message || "Comparison failed");
    } finally {
      setCmpLoading(false);
    }
  }

  // Plot selection helpers
  const plotOptions = [
    { key: "originalHistogram", label: "Original Histogram" },
    { key: "dlHistogram", label: "DL Histogram" },
    { key: "qqPlot", label: "QQ Plot" },
    { key: "originalHeatmap", label: "Original Heatmap" },
    { key: "dlHeatmap", label: "DL Heatmap" },
    { key: "comparisonHeatmap", label: "Comparison Heatmap" },
  ];

  const handlePlotSelection = (plotKey: string, checked: boolean) => {
    setSelectedPlots((prev) => ({
      ...prev,
      [plotKey]: checked,
    }));
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedPlots({
      originalHistogram: checked,
      dlHistogram: checked,
      qqPlot: checked,
      originalHeatmap: checked,
      dlHeatmap: checked,
      comparisonHeatmap: checked,
    });
  };

  const isAllSelected = Object.values(selectedPlots).every(Boolean);
  const hasAnySelection = Object.values(selectedPlots).some(Boolean);

  async function onExport(type: "plots") {
    if (type === "plots") {
      if (!runId) {
        alert("Nothing to export yet. Please run a comparison first.");
        return;
      }
      setShowPlotSelection(true);
    }
  }

  const handleExportPlots = async () => {
    if (!originalZip || !dlZip || !originalMap.Assay || !dlMap.Assay) {
      alert("Missing required data for export");
      return;
    }

    setExportLoading(true);
    setExportSuccess(false);

    try {
      const blob = await exportPlots(
        originalZip,
        dlZip,
        originalMap.Assay,
        dlMap.Assay,
        selectedPlots,
        // Pass heatmap parameters if heatmaps are selected
        originalMap.Northing,
        originalMap.Easting,
        dlMap.Northing,
        dlMap.Easting,
        method || undefined,
        gridSize || undefined
      );

      // Verify blob is valid
      if (!blob || blob.size === 0) {
        throw new Error("Received empty or invalid file from server");
      }

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "plots.zip";
      a.style.display = "none";
      document.body.appendChild(a);

      // Trigger download
      a.click();

      // Clean up after download starts
      setTimeout(() => {
        if (document.body.contains(a)) {
          document.body.removeChild(a);
        }
        window.URL.revokeObjectURL(url);
      }, 100);

      setExportSuccess(true);
      setToast({ msg: "Plots exported successfully!" });

      // Close modal after a short delay to ensure download starts
      setTimeout(() => {
        setShowPlotSelection(false);
      }, 1000);
    } catch (error: any) {
      console.error("Export failed:", error);
      alert(`Export failed: ${error.message}`);
    } finally {
      setExportLoading(false);
    }
  };

  // --- Reset helpers ---
  function resetDataLoading() {
    setOriginalZip(null);
    setDlZip(null);
    setErrors({});
    setOriginalColumns([]);
    setDlColumns([]);
    setLoadingColumns(false);
    setOriginalList([]);
    setDlList([]);
    setProgress({ original: 0, dl: 0 });
    setDataLoaded(false);
    // Reset file input elements so the same file can be re-uploaded
    if (inputOriginalRef.current) inputOriginalRef.current.value = "";
    if (inputDlRef.current) inputDlRef.current.value = "";
    resetAnalysis();
  }
  function resetAnalysis() {
    setOriginalMap({});
    setDlMap({});
    setAnalysisRun(false);
    setStatsOriginal(null);
    setStatsDl(null);
    setPlotsData({}); // <-- clear plots data state as well
    setPlotsLoading(false); // <-- reset loading state for plots
    setSelectedPlots({
      originalHistogram: false,
      dlHistogram: false,
      qqPlot: false,
      originalHeatmap: false,
      dlHeatmap: false,
      comparisonHeatmap: false,
    });
    setShowPlotSelection(false);
    setExportLoading(false);
    setExportSuccess(false);
    resetComparison();
  }
  function resetComparison() {
    setMethod(null);
    setGridSize(null);
    setRunId(null);
    setRunError(null);
    setBusyRun(false);
    setUnzipping(false);
    setGridOut(null); // NEW: clear plots when resetting comparison
    // Dispose three.js visualization and clear plotRef
    if (threeRef.current) safelyDisposeThree(plotRef.current);
    if (plotRef.current && plotRef.current.firstChild) {
      while (plotRef.current.firstChild) {
        plotRef.current.removeChild(plotRef.current.firstChild);
      }
    }
  }

  // Only enable Comparison after Run Analysis has been clicked
  const canGoToComparison = analysisRun;

  // Lightbox state and helpers
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxTitle, setLightboxTitle] = useState<string>("");

  function openLightbox(src: string, title: string) {
    setLightboxSrc(src);
    setLightboxTitle(title);
    setLightboxOpen(true);
  }

  function closeLightbox() {
    setLightboxOpen(false);
    setLightboxSrc(null);
    setLightboxTitle("");
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeLightbox();
    }
    if (lightboxOpen) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightboxOpen]);

  return (
    <div className="min-h-screen bg-white text-[#111827] flex">
      {/* Sidebar */}
      <aside className="hidden md:flex md:flex-col fixed top-0 left-0 h-screen w-64 border-r border-neutral-200 bg-[#F9FAFB] z-30">
        <div className="px-4 pt-8 pb-4 flex items-start gap-3">
          <div className="rounded-2xl bg-[#7C3AED] text-white p-2 shadow-sm">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              ESRI Comparison
            </h1>
            <p className="text-xs text-neutral-600">
              Original vs DL assay checks
            </p>
          </div>
        </div>
        <nav className="mt-2 px-2 space-y-1">
          <SidebarItem
            icon={<Upload className="h-4 w-4" />}
            label="Data Loading"
            active={section === "data-loading"}
            onClick={() => setSection("data-loading")}
          />
          <SidebarItem
            icon={<BarChart3 className="h-4 w-4" />}
            label="Data Analysis"
            active={section === "data-analysis"}
            onClick={() => setSection("data-analysis")}
          />
          <SidebarItem
            icon={<GitCompare className="h-4 w-4" />}
            label="Comparison"
            active={section === "comparisons"}
            onClick={() => setSection("comparisons")}
          />
          <SidebarItem
            icon={<Download className="h-4 w-4" />}
            label="Export"
            active={section === "export"}
            onClick={() => setSection("export")}
          />
        </nav>
        <div className="mt-auto p-3">
          <SidebarItem
            icon={<Info className="h-4 w-4" />}
            label="About"
            active={section === "about"}
            onClick={() => setSection("about")}
          />
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 md:ml-64">
        <header>
          <div className="mx-auto max-w-6xl px-4 pt-8 pb-4 md:pt-10 md:pb-6">
            <div className="flex items-start gap-3 md:hidden">
              <div className="rounded-2xl bg-[#7C3AED] text-white p-2 shadow-sm">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">
                  ESRI Comparison
                </h1>
                <p className="mt-1 text-neutral-700 text-sm max-w-2xl">
                  Upload the <strong>Original</strong> and <strong>DL</strong>{" "}
                  .zip files, load data, set mappings in Data Analysis, then run
                  a comparison.
                </p>
              </div>
            </div>

            {/* Progress steps hidden on About */}
            {section !== "about" && (
              <nav aria-label="progress" className="mt-4">
                <ol className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                  <StepItem
                    number={1}
                    title="Original ESRI"
                    done={!!originalZip}
                  />
                  <StepItem number={2} title="DL ESRI" done={!!dlZip} />
                  <StepItem number={3} title="Mapping" done={analysisRun} />
                  <StepItem number={4} title="Method" done={method !== null} />
                  {/* Remove grid size step here */}
                  {/* <StepItem number={5} title="Grid Size" done={gridSize !== null && gridSize >= 100} /> */}
                  <StepItem number={5} title="Plot" done={!!runId} />
                </ol>
              </nav>
            )}
          </div>
        </header>

        <SuccessToast toast={toast} onClose={() => setToast(null)} />

        <main className="mx-auto max-w-6xl px-4 pb-16">
          {/* Data Selection */}
          {section === "data-loading" && (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                <UploadPanel
                  step={1}
                  title="File Upload for Original ESRI Data"
                  subtitle="Only .zip or .csv files are accepted. Drag & drop or click to browse."
                  file={originalZip}
                  error={errors.original}
                  onClear={() => validateAndSet(null, "original")}
                  onDrop={(e: React.DragEvent<HTMLDivElement>) =>
                    onDrop(e, "original")
                  }
                  onDragOver={(e: React.DragEvent<HTMLDivElement>) =>
                    onDragOver(e)
                  }
                  onBrowse={() => inputOriginalRef.current?.click()}
                >
                  <input
                    ref={inputOriginalRef}
                    type="file"
                    accept=".zip,.csv"
                    className="hidden"
                    onChange={(e) => handleInput(e, "original")}
                  />
                </UploadPanel>

                <UploadPanel
                  step={2}
                  title="File Upload for DL ESRI Data"
                  subtitle="Only .zip or .csv files are accepted. Drag & drop or click to browse."
                  file={dlZip}
                  error={errors.dl}
                  onClear={() => validateAndSet(null, "dl")}
                  onDrop={(e: React.DragEvent<HTMLDivElement>) =>
                    onDrop(e, "dl")
                  }
                  onDragOver={(e: React.DragEvent<HTMLDivElement>) =>
                    onDragOver(e)
                  }
                  onBrowse={() => inputDlRef.current?.click()}
                >
                  <input
                    ref={inputDlRef}
                    type="file"
                    accept=".zip,.csv"
                    className="hidden"
                    onChange={(e) => handleInput(e, "dl")}
                  />
                </UploadPanel>
              </div>

              <div className="mt-5 flex items-center gap-2">
                <button
                  onClick={onLoadData}
                  disabled={
                    !originalZip || !dlZip || loadingColumns || dataLoaded
                  }
                  className={
                    "rounded-xl px-5 py-2.5 text-sm font-medium transition flex items-center gap-2 " +
                    (!!originalZip && !!dlZip && !loadingColumns && !dataLoaded
                      ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9]"
                      : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                  }
                >
                  {loadingColumns ? "Loading…" : "Load Data"}
                  {dataLoaded && (
                    <span className="inline-flex items-center text-[#10B981] ml-2">
                      <CheckCircle2 className="h-5 w-5" />
                    </span>
                  )}
                </button>
                {dataLoaded && (
                  <button
                    type="button"
                    className="ml-2 rounded-xl px-4 py-2 text-sm font-medium bg-neutral-200 text-neutral-700 hover:bg-neutral-300 transition"
                    onClick={resetDataLoading}
                  >
                    Clear
                  </button>
                )}
              </div>

              {(loadingColumns || dataLoaded) && (
                <section className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
                  <ZipList
                    title={originalZip?.name || "Original.zip"}
                    progress={progress.original}
                    items={originalList}
                    accent="#7C3AED"
                  />
                  <ZipList
                    title={dlZip?.name || "DL.zip"}
                    progress={progress.dl}
                    items={dlList}
                    accent="#F59E0B"
                  />
                </section>
              )}

              {dataLoaded && !!originalZip && !!dlZip && (
                <div className="mt-6 flex justify-end">
                  <button
                    className="rounded-xl px-5 py-2.5 text-sm font-medium bg-[#7C3AED] text-white hover:bg-[#6D28D9] transition"
                    onClick={() => setSection("data-analysis")}
                  >
                    Go to Data Analysis
                  </button>
                </div>
              )}
            </>
          )}

          {/* Data Analysis (Mappings + Run Analysis) */}
          {section === "data-analysis" && (
            <>
              <section className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <LayoutGrid className="h-4 w-4 text-[#7C3AED]" />
                  <h2 className="text-lg font-semibold">Mappings</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <MappingForm
                    title="Original"
                    columns={originalColumns}
                    mapping={originalMap}
                    onChange={setOriginalMap}
                  />
                  <MappingForm
                    title="DL"
                    columns={dlColumns}
                    mapping={dlMap}
                    onChange={setDlMap}
                  />
                </div>

                <div className="mt-5 flex items-center gap-2">
                  <button
                    onClick={handleRunAnalysis}
                    disabled={
                      !mappingComplete || analysisRun || analysisLoading
                    }
                    className={
                      "rounded-xl px-5 py-2.5 text-sm font-medium transition flex items-center gap-2 " +
                      (mappingComplete && !analysisRun && !analysisLoading
                        ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9]"
                        : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                    }
                  >
                    {analysisLoading ? "Analysing…" : "Run Analysis"}
                    {analysisRun && !analysisLoading && (
                      <span className="inline-flex items-center text-[#10B981] ml-2">
                        <CheckCircle2 className="h-5 w-5" />
                      </span>
                    )}
                  </button>
                  <button
                    onClick={handleShowPlots}
                    disabled={
                      !analysisRun ||
                      plotsLoading ||
                      !!(plotsData.original && plotsData.dl && plotsData.qq)
                    }
                    className={
                      "rounded-xl px-5 py-2.5 text-sm font-medium transition flex items-center gap-2 " +
                      (!analysisRun || plotsLoading
                        ? "bg-neutral-200 text-neutral-500 cursor-not-allowed"
                        : !plotsData.original || !plotsData.dl || !plotsData.qq
                        ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9]"
                        : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                    }
                  >
                    {plotsLoading ? (
                      "Rendering…"
                    ) : plotsData.original && plotsData.dl && plotsData.qq ? (
                      <>
                        Show Plots
                        <span className="inline-flex items-center text-[#10B981] ml-2">
                          <CheckCircle2 className="h-5 w-5" />
                        </span>
                      </>
                    ) : (
                      "Show Plots"
                    )}
                  </button>
                  {analysisRun && !analysisLoading && (
                    <button
                      type="button"
                      className="ml-2 rounded-xl px-4 py-2 text-sm font-medium bg-neutral-200 text-neutral-700 hover:bg-neutral-300 transition"
                      onClick={resetAnalysis}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Only show stats after analysis is done */}
                {analysisRun && !analysisLoading && (
                  <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-4">
                    <InfoCard
                      label="Assay - mean"
                      value={`${fmt(statsOriginal?.mean)} / ${fmt(
                        statsDl?.mean
                      )}`}
                      hint="Original / DL"
                    />
                    <InfoCard
                      label="Assay - median"
                      value={`${fmt(statsOriginal?.median)} / ${fmt(
                        statsDl?.median
                      )}`}
                      hint="Original / DL"
                    />
                    <InfoCard
                      label="Assay - max"
                      value={`${fmt(statsOriginal?.max)} / ${fmt(
                        statsDl?.max
                      )}`}
                      hint="Original / DL"
                    />
                    <InfoCard
                      label="Assay - std"
                      value={`${fmt(statsOriginal?.std)} / ${fmt(
                        statsDl?.std
                      )}`}
                      hint="Original / DL"
                    />
                  </div>
                )}

                {/* Plots gallery */}
                {analysisRun &&
                  !analysisLoading &&
                  (plotsData.original || plotsData.dl || plotsData.qq) && (
                    <section className="mt-5 flex flex-col gap-4">
                      <div className="rounded-2xl border border-neutral-200 bg-white p-3">
                        <div className="text-sm font-medium mb-2">
                          Original histogram
                        </div>
                        {plotsData.original ? (
                          <Plot
                            {...createHistogramPlot(plotsData.original)}
                            style={{ width: "100%", height: 600 }}
                          />
                        ) : (
                          <div className="h-[600px] grid place-items-center text-sm text-neutral-500 bg-[#F9FAFB] rounded-xl border border-neutral-100">
                            No plot yet
                          </div>
                        )}
                      </div>
                      <div className="rounded-2xl border border-neutral-200 bg-white p-3">
                        <div className="text-sm font-medium mb-2">
                          DL histogram
                        </div>
                        {plotsData.dl ? (
                          <Plot
                            {...createHistogramPlot(plotsData.dl)}
                            style={{ width: "100%", height: 600 }}
                          />
                        ) : (
                          <div className="h-[600px] grid place-items-center text-sm text-neutral-500 bg-[#F9FAFB] rounded-xl border border-neutral-100">
                            No plot yet
                          </div>
                        )}
                      </div>
                      <div className="rounded-2xl border border-neutral-200 bg-white p-3">
                        <div className="text-sm font-medium mb-2">
                          QQ plot (log–log)
                        </div>
                        {plotsData.qq ? (
                          <Plot
                            {...createQQPlot(plotsData.qq)}
                            style={{ width: "100%", height: 600 }}
                          />
                        ) : (
                          <div className="h-[600px] grid place-items-center text-sm text-neutral-500 bg-[#F9FAFB] rounded-xl border border-neutral-100">
                            No plot yet
                          </div>
                        )}
                      </div>
                    </section>
                  )}
              </section>

              <section className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                <InfoCard
                  label="Original columns"
                  value={originalColumns.length ? originalColumns.length : "—"}
                  hint="After Load Data"
                />
                <InfoCard
                  label="DL columns"
                  value={dlColumns.length ? dlColumns.length : "—"}
                  hint="After Load Data"
                />
                <InfoCard
                  label="Mappings complete"
                  value={mappingComplete ? "Yes" : "No"}
                  hint="Select all 3 per side"
                />
              </section>

              {analysisRun && (
                <div className="mt-6 flex justify-end">
                  <button
                    className="rounded-xl px-5 py-2.5 text-sm font-medium bg-[#7C3AED] text-white hover:bg-[#6D28D9] transition"
                    onClick={() => setSection("comparisons")}
                  >
                    Go to Comparison
                  </button>
                </div>
              )}
            </>
          )}

          {/* Comparisons */}
          {section === "comparisons" && (
            <>
              <div
                className={analysisRun ? "" : "opacity-50 pointer-events-none"}
              >
                <ControlsBar
                  method={method}
                  onMethodChange={analysisRun ? (setMethod as any) : () => {}}
                  gridSize={gridSize}
                  onGridSizeChange={analysisRun ? setGridSize : () => {}}
                />
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="mt-8 flex flex-wrap items-center gap-3"
                >
                  <button
                    type="button"
                    onClick={handleRunComparison}
                    disabled={
                      !readyToRun || !analysisRun || cmpLoading || !!runId
                    }
                    className={
                      "rounded-xl px-5 py-2.5 text-sm font-medium transition flex items-center gap-2 " +
                      (readyToRun && analysisRun && !cmpLoading && !runId
                        ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9]"
                        : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                    }
                  >
                    {cmpLoading ? "Running…" : "Run Comparison"}
                    {runId && !cmpLoading && (
                      <span className="inline-flex items-center text-[#10B981] ml-2">
                        <CheckCircle2 className="h-5 w-5" />
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    className="ml-2 rounded-xl px-4 py-2 text-sm font-medium bg-neutral-200 text-neutral-700 hover:bg-neutral-300 transition"
                    onClick={resetComparison}
                    disabled={
                      cmpLoading ||
                      (!runId && method === null && gridSize === null)
                    }
                  >
                    Clear
                  </button>

                  {runError && (
                    <span className="text-red-600 text-sm ml-2">
                      {runError}
                    </span>
                  )}
                </motion.div>
              </div>
              <section className="mt-8">
                <h2 className="text-lg font-semibold mb-3">
                  Plots (Original/ DL/ Comparison)
                </h2>
                {/* Render interactive heatmaps if gridOut is present */}
                {gridOut && (
                  <div className="flex flex-col gap-6">
                    {/* ORIGINAL (log10) */}
                    <div className="rounded-2xl border border-gray-200 p-3">
                      <div className="text-sm font-medium mb-2">
                        Original heatmap
                      </div>
                      <Plot
                        data={[
                          {
                            x: gridOut.x,
                            y: gridOut.y,
                            z: gridOut.orig.map((row: (number | null)[]) =>
                              row.map((v) =>
                                v && v > 0 ? Math.log10(v) : null
                              )
                            ),
                            type: "heatmap",
                            hoverongaps: false,
                            colorscale: "Viridis",
                            zmin: POW_TICKS[0],
                            zmax: POW_TICKS[POW_TICKS.length - 1],
                            colorbar: {
                              title: `Max ${
                                originalMap.Assay || "Assay"
                              } (log scale)`,
                              tickmode: "array",
                              tickvals: POW_TICKS as unknown as number[],
                              ticktext: powTickText(POW_TICKS),
                              len: 0.8,
                              thickness: 24,
                              outlinewidth: 1,
                              x: 1.02,
                              y: 0.5,
                              yanchor: "middle",
                            },
                          },
                          gridOut.original_points && {
                            x: gridOut.original_points.map(
                              (p: number[]) => p[0]
                            ),
                            y: gridOut.original_points.map(
                              (p: number[]) => p[1]
                            ),
                            type: "scattergl",
                            mode: "markers",
                            marker: { size: 4, color: "black", opacity: 0.7 },
                            hoverinfo: "skip",
                            name: "Samples",
                          },
                        ].filter(Boolean)}
                        layout={{
                          ...axesLikeNotebook(gridOut),
                          autosize: true,
                        }}
                        config={{ responsive: true, displaylogo: false }}
                        style={{ width: "100%", height: PLOT_HEIGHT }}
                      />
                    </div>

                    {/* DL (log10) */}
                    <div className="rounded-2xl border border-gray-200 p-3">
                      <div className="text-sm font-medium mb-2">DL heatmap</div>
                      <Plot
                        data={[
                          {
                            x: gridOut.x,
                            y: gridOut.y,
                            z: gridOut.dl.map((row: (number | null)[]) =>
                              row.map((v) =>
                                v && v > 0 ? Math.log10(v) : null
                              )
                            ),
                            type: "heatmap",
                            hoverongaps: false,
                            colorscale: "Viridis",
                            zmin: POW_TICKS[0],
                            zmax: POW_TICKS[POW_TICKS.length - 1],
                            colorbar: {
                              title: `Max ${
                                dlMap.Assay || "Assay"
                              } (log scale)`,
                              tickmode: "array",
                              tickvals: POW_TICKS as unknown as number[],
                              ticktext: powTickText(POW_TICKS),
                              len: 0.8,
                              thickness: 24,
                              outlinewidth: 1,
                              x: 1.02,
                              y: 0.5,
                              yanchor: "middle",
                            },
                          },
                          gridOut.dl_points && {
                            x: gridOut.dl_points.map((p: number[]) => p[0]),
                            y: gridOut.dl_points.map((p: number[]) => p[1]),
                            type: "scattergl",
                            mode: "markers",
                            marker: { size: 4, color: "black", opacity: 0.7 },
                            hoverinfo: "skip",
                            name: "Samples",
                          },
                        ].filter(Boolean)}
                        layout={{
                          ...axesLikeNotebook(gridOut),
                          autosize: true,
                        }}
                        config={{ responsive: true, displaylogo: false }}
                        style={{ width: "100%", height: PLOT_HEIGHT }}
                      />
                    </div>

                    {/* COMPARISON (DL − Original) */}
                    <div className="rounded-2xl border border-gray-200 p-3">
                      <div className="text-sm font-medium mb-2">
                        Comparison heatmap
                      </div>
                      {(() => {
                        const pts = (gridOut.original_points ?? []).concat(
                          gridOut.dl_points ?? []
                        );
                        return (
                          <Plot
                            data={[
                              {
                                x: gridOut.x,
                                y: gridOut.y,
                                z: gridOut.cmp, // contains nulls for gaps
                                type: "heatmap",
                                hoverongaps: false,
                                // Use custom colorscale for comparison plot
                                colorscale: [
                                  [0, "#a50026"],
                                  [0.1, "#d73027"],
                                  [0.2, "#f46d43"],
                                  [0.3, "#fdae61"],
                                  [0.4, "#fee090"],
                                  [0.5, "#ffffbf"],
                                  [0.6, "#e0f3f8"],
                                  [0.7, "#abd9e9"],
                                  [0.8, "#74add1"],
                                  [0.9, "#4575b4"],
                                  [1, "#313695"],
                                ],
                                zmin: -100,
                                zmax: 100,
                                zmid: 0,
                                colorbar: {
                                  title: "Δ Te_ppm",
                                  len: 0.8,
                                  thickness: 24,
                                  outlinewidth: 1,
                                  x: 1.02,
                                  y: 0.5,
                                  yanchor: "middle",
                                },
                              },
                              pts.length
                                ? {
                                    x: pts.map((p: number[]) => p[0]),
                                    y: pts.map((p: number[]) => p[1]),
                                    type: "scattergl",
                                    mode: "markers",
                                    marker: {
                                      size: 4,
                                      color: "black",
                                      opacity: 0.7,
                                    },
                                    hoverinfo: "skip",
                                    name: "Samples",
                                  }
                                : null,
                            ].filter(Boolean)}
                            layout={{
                              ...axesLikeNotebook(gridOut),
                              autosize: true,
                            }}
                            config={{ responsive: true, displaylogo: false }}
                            style={{ width: "100%", height: PLOT_HEIGHT }}
                          />
                        );
                      })()}
                    </div>
                  </div>
                )}
              </section>
              {/* Go to Export button — show only after comparison done and plots are visible */}
              {runId && gridOut && (
                <div className="mt-6 flex justify-end">
                  <button
                    className="rounded-xl px-5 py-2.5 text-sm font-medium bg-[#7C3AED] text-white hover:bg-[#6D28D9] transition"
                    onClick={() => setSection("export")}
                  >
                    Go to Export
                  </button>
                </div>
              )}
            </>
          )}

          {/* Export */}
          {section === "export" && (
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-5">
              <h2 className="text-lg font-semibold mb-3">Export Results</h2>
              <div className="flex flex-wrap gap-3">
                <button
                  className={
                    "rounded-xl px-4 py-2 text-sm transition " +
                    (exportEnabled
                      ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9]"
                      : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                  }
                  disabled={!exportEnabled}
                  onClick={() => onExport("plots")}
                >
                  Export Plots
                </button>
              </div>
              <p className="text-xs text-neutral-500 mt-3">
                Export Plots: Download selected plots as PNG files.
              </p>

              {/* Plot Selection Modal */}
              {showPlotSelection && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">
                        Select Plots to Export
                      </h3>
                      <button
                        onClick={() => setShowPlotSelection(false)}
                        className="text-neutral-500 hover:text-neutral-700"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    <div className="space-y-3">
                      {/* Select All checkbox */}
                      <div className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200">
                        <input
                          type="checkbox"
                          id="select-all"
                          checked={isAllSelected}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          className="h-4 w-4 text-[#7C3AED] focus:ring-[#7C3AED] border-neutral-300 rounded"
                        />
                        <label
                          htmlFor="select-all"
                          className="text-sm font-medium text-neutral-700"
                        >
                          Select All
                        </label>
                      </div>

                      {/* Individual plot checkboxes */}
                      {plotOptions.map((option) => (
                        <div
                          key={option.key}
                          className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200"
                        >
                          <input
                            type="checkbox"
                            id={option.key}
                            checked={
                              selectedPlots[
                                option.key as keyof typeof selectedPlots
                              ]
                            }
                            onChange={(e) =>
                              handlePlotSelection(option.key, e.target.checked)
                            }
                            className="h-4 w-4 text-[#7C3AED] focus:ring-[#7C3AED] border-neutral-300 rounded"
                          />
                          <label
                            htmlFor={option.key}
                            className="text-sm text-neutral-700"
                          >
                            {option.label}
                          </label>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-3 mt-6">
                      <button
                        onClick={() => setShowPlotSelection(false)}
                        className="flex-1 rounded-xl px-4 py-2 text-sm font-medium bg-neutral-200 text-neutral-700 hover:bg-neutral-300 transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleExportPlots}
                        disabled={!hasAnySelection || exportLoading}
                        className={
                          "flex-1 rounded-xl px-4 py-2 text-sm font-medium transition flex items-center justify-center gap-2 " +
                          (hasAnySelection && !exportLoading
                            ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9]"
                            : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                        }
                      >
                        {exportLoading ? "Exporting…" : "Export Selected"}
                        {exportSuccess && !exportLoading && (
                          <span className="inline-flex items-center text-[#10B981]">
                            <CheckCircle2 className="h-4 w-4" />
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* About */}
          {section === "about" && (
            <section className="rounded-2xl border border-neutral-200 bg-white p-5">
              <h2 className="text-lg font-semibold mb-2">About</h2>
              <p className="text-sm text-neutral-700 mb-3">
                This application was developed as part of a university capstone
                project aimed at advancing geochemical exploration workflows in
                Western Australia. Its primary purpose is to provide mineral
                explorers with a platform to compare original laboratory assay
                results with deep learning imputed values within a clear spatial
                context. By enabling side-by-side comparison, statistical
                analysis, and visualisation of differences across datasets, the
                tool helps identify zones where imputed values suggest
                potentially significant mineralisation that may have been
                overlooked in the original sampling.
              </p>
              <h3 className="text-md font-semibold mt-4 mb-2">
                Tool Capabilities
              </h3>
              <ul className="list-disc pl-6 text-sm text-neutral-700 space-y-1">
                <li>
                  Upload original and deep learning (DL) datasets in CSV or SHP
                  formats.
                </li>
                <li>
                  Perform data analysis to generate statistical summaries and
                  distribution plots.
                </li>
                <li>
                  Select a comparison method and view side-by-side comparison
                  plots.
                </li>
                <li>
                  Export results, including plots as PNG files and processed
                  grid values as CSV files.
                </li>
              </ul>
              <h3 className="text-md font-semibold mt-4 mb-2">
                Technologies Used
              </h3>
              <ul className="list-disc pl-6 text-sm text-neutral-700 space-y-1">
                <li>Frontend: React + Vite with TailwindCSS for styling</li>
                <li>
                  Backend: FastAPI (Python 3.10+) with Pydantic models and
                  Uvicorn server
                </li>
                <li>
                  Data Handling & Analysis: Pandas for dataframes, Matplotlib
                  for plots, built-in FastAPI services for stats and file I/O
                </li>
                <li>
                  Integration: REST API endpoints connecting the frontend and
                  backend (CORS enabled for localhost dev)
                </li>
              </ul>
            </section>
          )}
        </main>

        <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-xs text-neutral-500" />
      </div>

      {/* Lightbox modal */}
      <AnimatePresence>
        {lightboxOpen && lightboxSrc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
            onClick={closeLightbox}
            aria-modal="true"
            role="dialog"
          >
            <div
              className="absolute inset-0 flex items-center justify-center p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: "spring", stiffness: 240, damping: 24 }}
                className="relative w-full max-w-6xl"
              >
                <div className="mb-2 flex items-center justify-between text-white">
                  <h3 className="text-sm md:text-base font-medium">
                    {lightboxTitle}
                  </h3>
                  <button
                    onClick={closeLightbox}
                    className="inline-flex items-center rounded-xl bg-white/10 hover:bg-white/20 px-2 py-1"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>
                </div>
                <div className="rounded-2xl bg-white p-2 md:p-3">
                  <img
                    src={lightboxSrc}
                    alt={lightboxTitle}
                    className="max-h-[80vh] w-full object-contain rounded-xl"
                  />
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* Sidebar item */
function SidebarItem({
  icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={
        "w-full flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition " +
        (active
          ? "bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]"
          : disabled
          ? "text-neutral-300 bg-neutral-50 cursor-not-allowed"
          : "text-neutral-700 hover:bg-neutral-100 border border-transparent")
      }
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
    >
      <span
        className={
          active
            ? "text-[#7C3AED]"
            : disabled
            ? "text-neutral-300"
            : "text-neutral-500"
        }
      >
        {icon}
      </span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

/* Step item */
function StepItem({
  number,
  title,
  done,
}: {
  number: number;
  title: string;
  done: boolean;
}) {
  return (
    <li className="flex items-center gap-3">
      <div
        className={
          "relative h-9 w-9 shrink-0 grid place-items-center rounded-2xl border " +
          (done
            ? "border-[#10B981] bg-[#10B981]/10 text-[#10B981]"
            : "border-neutral-300 bg-white text-neutral-700")
        }
      >
        {done ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <span className="text-sm font-semibold">{number}</span>
        )}
      </div>
      <div className="text-sm font-medium">{title}</div>
    </li>
  );
}

/* Upload panel */
function UploadPanel({
  step,
  title,
  subtitle,
  file,
  error,
  onClear,
  onDrop,
  onDragOver,
  onBrowse,
  children,
}: any) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="rounded-3xl border border-neutral-200 bg-[#F9FAFB] shadow-md overflow-hidden"
    >
      <div className="p-5 border-b border-neutral-200 flex items-start gap-3">
        <div className="rounded-xl bg-[#7C3AED] text-white px-2 py-1 text-xs font-semibold">
          Step {step}
        </div>
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>
        </div>
      </div>
      <div
        className="m-5 rounded-2xl border-2 border-dashed border-neutral-300 hover:border-[#7C3AED] transition bg-white"
        onDrop={onDrop}
        onDragOver={onDragOver}
        role="button"
        tabIndex={0}
        onClick={onBrowse}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onBrowse()}
        aria-label="Upload .zip or .csv file"
      >
        <div className="px-6 py-10 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-[#7C3AED]/10 grid place-items-center text-[#7C3AED]">
            <Upload className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold">
            Drag & drop a .zip or .csv here, or{" "}
            <span className="underline text-[#7C3AED]">browse</span>
          </p>
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-neutral-600">
            <Badge>
              <FileArchive className="h-3.5 w-3.5" /> .zip or .csv
            </Badge>
          </div>
        </div>
        {children}
      </div>
      <div className="px-5 pb-5">
        {file && (
          <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-3 py-2">
            <div className="min-w-0 flex items-center gap-2">
              <FileArchive className="h-4 w-4 text-[#7C3AED]" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-neutral-500">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClear}
              className="ml-3 inline-flex items-center gap-1 rounded-xl bg-red-100 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-200"
            >
              {" "}
              <Trash2 className="h-3.5 w-3.5" /> Remove{" "}
            </button>
          </div>
        )}
        {!!error && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-700">
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm">{error}</p>
          </div>
        )}
      </div>
    </motion.section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-[#F9FAFB] px-2 py-0.5 text-[11px] font-medium text-[#111827] border border-neutral-200">
      {children}
    </span>
  );
}

/* Toast */
function SuccessToast({
  toast,
  onClose,
}: {
  toast: { msg: string } | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => onClose(), 2400);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
          aria-live="polite"
          className="fixed top-4 right-4 z-50"
        >
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-800 px-4 py-3 shadow-lg shadow-emerald-100">
            <CheckCircle2 className="h-5 w-5" />
            <div className="text-sm font-medium">{toast?.msg}</div>
            <button
              onClick={onClose}
              className="ml-2 text-emerald-700/80 hover:text-emerald-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* Zip list card (used inline under Load Data) */
function ZipList({
  title,
  progress,
  items,
  accent,
}: {
  title: string;
  progress: number;
  items: Array<{ name: string; size: number }>;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200">
      <div className="p-3 flex items-center justify-between">
        <div className="font-medium truncate" title={title}>
          {title}
        </div>
        <div className="text-xs text-neutral-500">{items.length} files</div>
      </div>
      <div className="px-3 pb-3">
        <div className="h-2 w-full rounded bg-neutral-100 overflow-hidden">
          <div
            className="h-full"
            style={{ width: `${progress}%`, background: accent }}
          />
        </div>
        <ul className="mt-3 max-h-60 overflow-auto divide-y divide-neutral-100">
          {items.length === 0 ? (
            progress === 100 ? (
              <li className="py-3 text-xs text-neutral-500">Ready</li>
            ) : (
              <li className="py-3 text-xs text-neutral-500">Listing…</li>
            )
          ) : (
            items.map((f, idx) => (
              <li key={idx} className="py-2 text-sm flex items-center gap-2">
                <FileArchive className="h-4 w-4 text-neutral-500" />
                <span className="truncate" title={f.name}>
                  {f.name}
                </span>
                <span className="ml-auto text-xs text-neutral-400">
                  {(f.size / 1024).toFixed(1)} KB
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/* Controls Bar (parser-friendly) */
function ControlsBar(props: {
  method: null | "max" | "mean" | "median";
  onMethodChange: (m: "max" | "mean" | "median") => void;
  gridSize: number | null;
  onGridSizeChange: (n: number | null) => void;
}) {
  const { method, onMethodChange, gridSize, onGridSizeChange } = props;

  const METHOD_OPTIONS = [
    { value: "mean", label: "Mean" },
    { value: "median", label: "Median" },
    { value: "max", label: "Max" },
  ] as const;

  const tabRefs = React.useRef<any[]>([]);
  const selectedIdx = method
    ? METHOD_OPTIONS.findIndex((o) => o.value === method)
    : -1;

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (selectedIdx < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next =
        (selectedIdx + dir + METHOD_OPTIONS.length) % METHOD_OPTIONS.length;
      const m = METHOD_OPTIONS[next].value;
      onMethodChange(m);
      tabRefs.current[next]?.focus();
    }
  }

  const minGrid = 1000,
    maxGrid = 900000,
    stepGrid = 50;

  // Track invalid input state for grid cell size
  const [gridInput, setGridInput] = React.useState<string>(
    gridSize !== null ? String(gridSize) : ""
  );
  const isInvalidGridLow = gridInput !== "" && Number(gridInput) < minGrid;
  const isInvalidGridHigh = gridInput !== "" && Number(gridInput) > maxGrid;
  const isInvalidGrid = isInvalidGridLow || isInvalidGridHigh;

  React.useEffect(() => {
    // Sync input box with gridSize changes from slider
    if (gridSize !== null && String(gridSize) !== gridInput) {
      setGridInput(String(gridSize));
    }
    if (gridSize === null && gridInput !== "") {
      setGridInput("");
    }
  }, [gridSize]);

  function handleGridInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setGridInput(val);
    if (val === "") {
      onGridSizeChange(null);
      return;
    }
    const num = Number(val);
    if (isNaN(num)) return;
    onGridSizeChange(num);
  }

  return (
    <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 md:p-5">
      <div className="flex flex-col md:flex-row justify-between gap-4 md:gap-6 w-full">
        <div className="flex flex-col gap-2 min-w-[220px]">
          <span className="text-sm font-medium text-neutral-700 mb-1">
            Comparison Method
          </span>
          <div
            className="flex flex-row gap-2"
            role="tablist"
            aria-label="Comparison Method"
          >
            {METHOD_OPTIONS.map((opt, idx) => {
              const active = method === opt.value;
              return (
                <button
                  key={opt.value}
                  ref={(el) => (tabRefs.current[idx] = el)}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active || method === null ? 0 : -1}
                  onClick={() => onMethodChange(opt.value)}
                  onKeyDown={handleTabKeyDown}
                  className={
                    "px-3 py-1.5 h-9 rounded-xl text-sm font-medium transition " +
                    (active
                      ? "bg-[#7C3AED] text-white"
                      : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100")
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6 w-full md:justify-end">
          <div className="flex flex-col gap-1 min-w-[220px]">
            <label className="text-sm font-medium text-neutral-700 mb-1">
              Grid Cell Size
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={minGrid}
                max={maxGrid}
                step={stepGrid}
                value={
                  gridSize !== null &&
                  gridSize >= minGrid &&
                  gridSize <= maxGrid
                    ? gridSize
                    : minGrid
                }
                onChange={(e) => {
                  setGridInput(e.target.value);
                  onGridSizeChange(Number(e.target.value));
                }}
                className="w-40"
              />
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={maxGrid}
                  step={stepGrid}
                  value={gridInput}
                  onChange={handleGridInputChange}
                  placeholder={`${minGrid}-${maxGrid}`}
                  className={
                    "h-9 w-24 rounded-lg border px-2 text-sm " +
                    (isInvalidGrid
                      ? "border-red-500 text-red-600 bg-red-50"
                      : "border-neutral-300")
                  }
                />
              </div>
              {(isInvalidGridLow || isInvalidGridHigh) && (
                <div
                  className="mt-1 text-xs font-medium"
                  style={{
                    color: "#dc2626",
                    background: "transparent",
                    fontSize: "13px",
                    whiteSpace: "nowrap",
                    marginLeft: "2px",
                  }}
                >
                  {isInvalidGridLow
                    ? `Enter value above ${minGrid}`
                    : `Enter value below ${maxGrid}`}
                </div>
              )}
              <span
                className="text-sm font-medium"
                style={{ color: isInvalidGrid ? "#dc2626" : "#374151" }}
              >
                {gridInput !== "" ? `${gridInput} m` : "-- m"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Mapping Form */
function MappingForm({
  title,
  columns,
  mapping,
  onChange,
}: {
  title: string;
  columns: string[];
  mapping: ColumnMapping;
  onChange: (next: ColumnMapping) => void;
}) {
  const setField = (key: RequiredFieldKey, value: string) =>
    onChange({ ...mapping, [key]: value || undefined });

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 font-medium">{title}</div>
      {columns.length === 0 ? (
        <div className="text-sm text-neutral-500">
          Load Data in Data Loading tab to populate columns.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {["Northing", "Easting", "Assay"].map((label) => (
            <div key={label} className="flex items-center gap-3">
              <div className="w-28 text-sm text-neutral-700">{label}</div>
              <select
                value={mapping[label as RequiredFieldKey] ?? ""}
                onChange={(e) =>
                  setField(label as RequiredFieldKey, e.target.value)
                }
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Please select a column</option>
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Tiny info card */
function InfoCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-[#F9FAFB] p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[#111827]">{value}</div>
      {hint && <div className="text-xs text-neutral-500 mt-1">{hint}</div>}
    </div>
  );
}

const fmt = (v?: number | null) => {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  const rounded = Math.round(v * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2);
};

// Helper function to create histogram plot data
const createHistogramPlot = (data: PlotData) => {
  // Calculate bar widths for log scale using bin_edges if available
  const binWidths = data.bin_edges
    ? data.bin_edges.slice(0, -1).map((e, i) => data.bin_edges![i + 1] - e)
    : data.x.map((_, i) => (i > 0 ? data.x[i] - data.x[i - 1] : 0));

  // If log_x, set tickvals/ticktext for powers of ten
  let xaxis: any = {
    title: data.xlabel || "Value",
    type: data.log_x ? "log" : "linear",
  };
  if (data.log_x && data.bin_edges) {
    // Find integer log10s within bin_edges range
    const min = Math.ceil(Math.log10(data.bin_edges[0]));
    const max = Math.floor(
      Math.log10(data.bin_edges[data.bin_edges.length - 1])
    );
    const tickvals = [];
    for (let i = min; i <= max; ++i) tickvals.push(Math.pow(10, i));
    xaxis.tickvals = tickvals;
    xaxis.ticktext = tickvals.map((v) => `10${superscript(Math.log10(v))}`);
  }

  return {
    data: [
      {
        x: data.bin_edges ? data.bin_edges.slice(0, -1) : data.x,
        y: data.y,
        type: "bar",
        marker: {
          color: "#7C3AED",
          line: { color: "black", width: 0.5 },
        },
        name: "Count",
        width: binWidths,
        offset: 0,
      },
    ],
    layout: {
      title: data.title,
      xaxis,
      yaxis: { title: data.ylabel || "Count" },
      margin: { l: 60, r: 20, t: 60, b: 60 },
      height: 600,
      bargap: 0, // minimize gap between bars
    },
    config: { responsive: true, displaylogo: false },
  };
};

// Helper function to create QQ plot data
const createQQPlot = (data: PlotData) => {
  return {
    data: [
      {
        x: data.x,
        y: data.y,
        type: "scatter",
        mode: "markers",
        marker: { color: "#7C3AED", size: 8 },
        name: "Data points",
      },
      {
        x: data.line_x,
        y: data.line_y,
        type: "scatter",
        mode: "lines",
        line: { color: "black", dash: "dash", width: 1 },
        name: "Reference line",
      },
    ],
    layout: {
      title: data.title,
      xaxis: {
        title: data.xlabel || "Original Quantiles",
        type: data.log_x ? "log" : "linear",
      },
      yaxis: {
        title: data.ylabel || "DL Quantiles",
        type: data.log_y ? "log" : "linear",
      },
      margin: { l: 60, r: 20, t: 60, b: 60 },
      height: 600,
    },
    config: { responsive: true, displaylogo: false },
  };
};

const PLOT_HEIGHT = 600; // match attached images

// Use power-of-ten tick labels like 10⁻² … 10³
const POW_TICKS = [-2, -1, 0, 1, 2, 3] as const;

function superscript(n: number): string {
  const map: Record<string, string> = {
    "-": "⁻",
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
  };
  return Array.from(String(n))
    .map((ch) => map[ch] ?? ch)
    .join("");
}

function powTickText(vals: readonly number[]) {
  return vals.map((v) => `10${superscript(v)}`);
}

function axesLikeNotebook(gridOut: {
  xmin: number;
  ymin: number;
  nx: number;
  ny: number;
  cell_x: number;
  cell_y: number;
  coord_units?: "meters" | "degrees";
}) {
  const meters = gridOut.coord_units !== "degrees";
  const x0 = gridOut.xmin;
  const x1 = gridOut.xmin + gridOut.nx * gridOut.cell_x;
  const y0 = gridOut.ymin;
  const y1 = gridOut.ymin + gridOut.ny * gridOut.cell_y;

  // meters → plain numbers with thousands separators; degrees → decimals
  const tickFmt = meters ? ",.0f" : ".2f";

  const base = {
    ticks: "outside",
    ticklen: 6,
    tickwidth: 1,
    tickformat: tickFmt,
    separatethousands: true,
    showgrid: true,
    gridcolor: "rgba(0,0,0,0.15)",
    gridwidth: 1,
    zeroline: false,
    showline: true,
    linecolor: "rgba(0,0,0,0.35)",
    linewidth: 1,
    mirror: true,
  } as const;

  // Increase top margin to leave space between title and grid
  return {
    xaxis: {
      title: meters ? "Easting (m)" : "Longitude (°)",
      range: [x0, x1],
      ...base,
    },
    yaxis: {
      title: meters ? "Northing (m)" : "Latitude (°)",
      range: [y0, y1],
      scaleanchor: "x",
      scaleratio: 1,
      ...base,
    },
    margin: { l: 76, r: 76, b: 62, t: 90 }, // t: 90 leaves more space above grid for title
  };
}

// Utility to download a Plotly plot as image (PNG)
function downloadPlotImage(
  plotDiv: HTMLDivElement | null,
  filename = "plot.png"
) {
  if (!plotDiv) return;
  Plotly.toImage(plotDiv, {
    format: "png",
    height: 600,
    width: plotDiv.offsetWidth || 900,
  }).then((dataUrl: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 100);
  });
}
