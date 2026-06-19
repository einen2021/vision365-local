/**
 * ModelViewer.tsx
 * Main 3D model viewer component with Revit-like controls
 * Production-ready, optimized, and modular
 */

"use client";

import { Suspense, useRef, useState, useMemo, useEffect, memo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, Stats } from "@react-three/drei";
import * as THREE from "three";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import { WireframeModel, AssetHoverInfo } from "./WireframeModel";
import { RevitControls, CameraState } from "./RevitControls";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RotateCcw,
  Grid3x3,
  Eye,
  Info,
  Maximize2,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Bookmark,
  BookmarkCheck,
} from "lucide-react";

// Animates ripple meshes.
// Lazily builds the mesh list inside useFrame so it works regardless of when
// the model finishes loading — no fixed delay needed.
// Re-scans every 90 frames (~1.5 s) so new ripples after a building switch
// are picked up automatically.
function RippleAnimator() {
  const rippleMeshes = useRef<THREE.Mesh[]>([]);
  const frameCount = useRef(0);
  const { scene, invalidate } = useThree();

  useFrame(() => {
    frameCount.current += 1;

    // Re-scan on first frame and then every 10 frames so dynamically
    // added/removed ripples are picked up within ~170 ms
    if (frameCount.current === 1 || frameCount.current % 10 === 0) {
      const found: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        if (
          obj.name?.includes("-ripple") &&
          obj.userData.animationTime !== undefined
        ) {
          found.push(obj as THREE.Mesh);
        }
      });
      rippleMeshes.current = found;
    }

    if (rippleMeshes.current.length === 0) {
      // No ripples yet — keep the loop alive so periodic re-scans can fire
      invalidate();
      return;
    }

    rippleMeshes.current.forEach((obj) => {
      obj.userData.animationTime += obj.userData.animationSpeed;
      if (obj.userData.animationTime >= 1) obj.userData.animationTime = 0;

      const progress = obj.userData.animationTime;
      const scale = 1 + (obj.userData.maxScale - 1) * progress;
      obj.scale.set(scale, scale, scale);

      const mat = obj.material as THREE.MeshStandardMaterial;
      if (mat && mat.opacity !== undefined) {
        mat.opacity = 0.4 * (1 - progress);
        mat.needsUpdate = true; // flush opacity change to GPU every frame
      }
    });

    invalidate(); // keep animation loop alive
  });

  return null;
}

// ---------------------------------------------------------------------------
// Camera-state persistence helpers (Firestore)
// Path: {buildingName}BuildingDB / 3dconfigurations
// ---------------------------------------------------------------------------
async function loadSavedCameraState(
  buildingName: string,
): Promise<CameraState | null> {
  try {
    const ref = doc(db, `${buildingName}BuildingDB`, "3dconfigurations");
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data() as CameraState;
    if (typeof data?.theta !== "number") return null;
    return data;
  } catch (err) {
    console.warn(
      "[ModelViewer] Failed to load camera state from Firestore:",
      err,
    );
    return null;
  }
}

async function persistCameraState(
  buildingName: string,
  state: CameraState,
): Promise<void> {
  try {
    const ref = doc(db, `${buildingName}BuildingDB`, "3dconfigurations");
    await setDoc(ref, state);
  } catch (err) {
    console.warn(
      "[ModelViewer] Failed to save camera state to Firestore:",
      err,
    );
  }
}

async function clearCameraState(buildingName: string): Promise<void> {
  try {
    const ref = doc(db, `${buildingName}BuildingDB`, "3dconfigurations");
    await deleteDoc(ref);
  } catch (err) {
    console.warn(
      "[ModelViewer] Failed to clear camera state from Firestore:",
      err,
    );
  }
}
// ---------------------------------------------------------------------------

export interface ModelViewerProps {
  modelUrl: string;
  modelType: "obj" | "fbx";
  modelScale?: number;
  /** The building name used to construct the Firestore path {buildingName}BuildingDB/3dconfigurations */
  buildingName?: string;
  buildingAssets?: Array<{
    id?: string;
    assetName?: string;
    deviceAddress?: string;
    deviceLocation?: string;
    coordinates?: { x?: number; y?: number; z?: number };
  }>;
  activeStatuses?: Record<string, { active: number }>;
  wireframeColor?: string;
  showGrid?: boolean;
  showAxes?: boolean;
  showStats?: boolean;
  backgroundColor?: string;
  enableYAxisRotation?: boolean;
  yAxisRotateSpeed?: number;
  className?: string;
}

export function ModelViewer({
  modelUrl,
  modelType,
  modelScale = 0.01,
  buildingName,
  buildingAssets = [],
  activeStatuses = {},
  wireframeColor = "#00ffff",
  showGrid = true,
  showAxes = false,
  showStats = false,
  backgroundColor = "#0f172a",
  enableYAxisRotation = true,
  yAxisRotateSpeed = 1.0,
  className = "",
}: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelInfo, setModelInfo] = useState<string>("");
  const [hoveredAsset, setHoveredAsset] = useState<AssetHoverInfo | null>(null);
  const mousePos = useRef({ x: 0, y: 0 });
  const [showGridHelper, setShowGridHelper] = useState(showGrid);
  const [cameraKey, setCameraKey] = useState(0); // Force camera reset
  const [isFullscreenModal, setIsFullscreenModal] = useState(false);
  const [showControls, setShowControls] = useState(false);

  // Camera persistence
  const cameraStateRef = useRef<CameraState | null>(null);
  const [savedCameraState, setSavedCameraState] = useState<CameraState | null>(
    null,
  );
  const [viewSaved, setViewSaved] = useState<boolean>(false);
  const [isCameraLoading, setIsCameraLoading] = useState<boolean>(false);

  // Load saved camera state from Firestore whenever the building changes
  useEffect(() => {
    if (!buildingName) {
      setSavedCameraState(null);
      setViewSaved(false);
      return;
    }
    let cancelled = false;
    setIsCameraLoading(true);
    loadSavedCameraState(buildingName).then((state) => {
      if (cancelled) return;
      setSavedCameraState(state);
      setViewSaved(state !== null);
      setIsCameraLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [buildingName]);
  const [viewFocus, setViewFocus] = useState<{
    target: [number, number, number];
    radius: number;
  }>({
    target: [0, 0, 0],
    radius: 0, // Start at 0 so auto-focus waits for model to load
  });

  const handleModelLoad = (object: THREE.Group | THREE.Object3D) => {
    setIsLoading(false);

    // Count meshes + compute bounds from model meshes (exclude asset markers)
    let meshCount = 0;
    const modelBounds = new THREE.Box3();
    object.updateMatrixWorld(true);

    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;

      meshCount++;

      // Only include the wireframe model meshes for initial framing
      if (!(mesh.material instanceof THREE.MeshBasicMaterial)) return;

      if (!mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox();
      }

      const geometryBounds = mesh.geometry.boundingBox;
      if (!geometryBounds) return;

      const worldBounds = geometryBounds.clone().applyMatrix4(mesh.matrixWorld);
      modelBounds.expandByPoint(worldBounds.min);
      modelBounds.expandByPoint(worldBounds.max);
    });

    if (!modelBounds.isEmpty()) {
      const center = modelBounds.getCenter(new THREE.Vector3());
      const size = modelBounds.getSize(new THREE.Vector3());
      const radius = Math.max(size.length() * 0.5, 1);
      setViewFocus({ target: [center.x, center.y, center.z], radius });
    }

    const modelName = modelUrl.split("/").pop() || "Unknown";
    setModelInfo(`${modelName} - ${meshCount} meshes`);
    console.log("Model loaded successfully:", modelName, meshCount, "meshes");
  };

  const handleModelError = (error: Error) => {
    setIsLoading(false);
    setError(`Failed to load model: ${error.message}`);
    console.error("Model loading error:", error);
  };

  const handleMeshClick = (meshName: string, mesh: THREE.Mesh) => {
    console.log("Mesh clicked:", meshName);
    // Future: implement incident tagging here
  };

  const resetView = () => {
    setCameraKey((prev) => prev + 1);
  };

  const saveView = () => {
    if (!cameraStateRef.current || !buildingName) return;
    const state = cameraStateRef.current;
    persistCameraState(buildingName, state).then(() => {
      setSavedCameraState(state);
      setViewSaved(true);
      console.log(
        `[ModelViewer] Camera state saved to ${buildingName}BuildingDB/3dconfigurations`,
      );
    });
  };

  const clearView = () => {
    if (!buildingName) return;
    clearCameraState(buildingName).then(() => {
      setSavedCameraState(null);
      setViewSaved(false);
      console.log(
        `[ModelViewer] Camera state cleared from ${buildingName}BuildingDB/3dconfigurations`,
      );
    });
  };

  const toggleGrid = () => {
    setShowGridHelper((prev) => !prev);
  };

  // Handle ESC key to close fullscreen modal
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsFullscreenModal(false);
    }
  };

  // Setup ESC key listener when modal is open
  useEffect(() => {
    if (isFullscreenModal) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isFullscreenModal]);

  // Memoize camera settings
  const cameraSettings = useMemo(
    () => ({
      position: [50, 30, 50] as [number, number, number],
      fov: 45,
      near: 0.1,
      far: 5000,
    }),
    [cameraKey],
  );

  const handleMeshHover = (info: AssetHoverInfo | null) => {
    setHoveredAsset(info);
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full ${className}`}
      style={{ backgroundColor }}
      onMouseMove={(e) => {
        const rect = (
          e.currentTarget as HTMLDivElement
        ).getBoundingClientRect();
        mousePos.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }}
    >
      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-white text-sm">Loading 3D Model...</p>
          </div>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 z-50">
          <div className="text-center max-w-md p-6 bg-red-900/20 border border-red-700 rounded-lg">
            <div className="text-red-500 text-lg font-semibold mb-2">
              Error Loading Model
            </div>
            <p className="text-gray-300 text-sm">{error}</p>
            <Button
              onClick={() => window.location.reload()}
              className="mt-4 bg-red-700 hover:bg-red-600"
            >
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* Controls Toolbar */}
      <div className="absolute top-4 left-4 z-40 flex flex-col gap-2">
        {/* Toggle Button — always visible */}
        <Button
          onClick={() => setShowControls((prev) => !prev)}
          size="sm"
          variant="outline"
          className="bg-slate-800/80 border-slate-600 hover:bg-slate-700 text-white backdrop-blur-sm self-start"
          title={showControls ? "Hide Controls" : "Show Controls"}
        >
          {showControls ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" />
          )}
        </Button>

        {showControls && (
          <>
            {/* Model Info */}
            {modelInfo && (
              <Badge
                variant="outline"
                className="bg-slate-800/80 text-white border-slate-600 backdrop-blur-sm px-3 py-1"
              >
                <Info className="h-3 w-3 mr-1 inline" />
                {modelInfo}
              </Badge>
            )}

            {/* Control Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={resetView}
                size="sm"
                variant="outline"
                className="bg-slate-800/80 border-slate-600 hover:bg-slate-700 text-white backdrop-blur-sm"
                title="Reset View"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset
              </Button>

              <Button
                onClick={toggleGrid}
                size="sm"
                variant="outline"
                className={`${
                  showGridHelper ? "bg-blue-700/80" : "bg-slate-800/80"
                } border-slate-600 hover:bg-slate-700 text-white backdrop-blur-sm`}
                title="Toggle Grid"
              >
                <Grid3x3 className="h-4 w-4" />
              </Button>
            </div>

            {/* Save View Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={saveView}
                size="sm"
                variant="outline"
                disabled={!buildingName || isCameraLoading}
                className="bg-slate-800/80 border-slate-600 hover:bg-slate-700 text-white backdrop-blur-sm disabled:opacity-50"
                title={
                  !buildingName
                    ? "No building selected — cannot save view"
                    : `Save view to ${buildingName}BuildingDB/3dconfigurations`
                }
              >
                {viewSaved ? (
                  <BookmarkCheck className="h-4 w-4 mr-1 text-green-400" />
                ) : (
                  <Bookmark className="h-4 w-4 mr-1" />
                )}
                Save View
              </Button>

              {viewSaved && (
                <Button
                  onClick={clearView}
                  size="sm"
                  variant="outline"
                  disabled={!buildingName || isCameraLoading}
                  className="bg-slate-800/80 border-slate-600 hover:bg-slate-700 text-white backdrop-blur-sm disabled:opacity-50"
                  title="Clear saved view — model will auto-fit on next load"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              )}
            </div>

            {/* Controls Help */}
            <div className="bg-slate-800/80 border border-slate-600 rounded p-2 text-xs text-gray-300 backdrop-blur-sm max-w-xs">
              <div className="font-semibold mb-1 text-blue-400">Controls:</div>
              <div>🖱️ Left Drag: Rotate</div>
              <div>🖱️ Shift + Left Drag: Pan</div>
              <div>🖱️ Right Drag: Pan</div>
              <div>🖱️ Scroll: Zoom</div>
              <div>🖱️ Click Mesh: Highlight</div>
            </div>
          </>
        )}
      </div>

      {/* Asset Hover Card */}
      {hoveredAsset && (
        <div
          className="pointer-events-none absolute z-50 min-w-[200px] max-w-[280px] rounded-lg border border-slate-600 bg-slate-900/95 p-3 shadow-xl backdrop-blur-sm"
          style={{
            left: Math.min(
              mousePos.current.x + 14,
              (containerRef.current?.clientWidth ?? 600) - 296,
            ),
            top: Math.max(mousePos.current.y - 10, 8),
          }}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
            <span className="text-sm font-semibold text-white truncate">
              {hoveredAsset.assetName || hoveredAsset.assetId}
            </span>
          </div>
          {hoveredAsset.deviceLocation && (
            <div className="mt-1 text-xs text-slate-300">
              <span className="font-medium text-slate-400">Location: </span>
              {hoveredAsset.deviceLocation}
            </div>
          )}
          {hoveredAsset.deviceAddress && (
            <div className="mt-0.5 text-xs text-slate-300">
              <span className="font-medium text-slate-400">Address: </span>
              {hoveredAsset.deviceAddress}
            </div>
          )}
        </div>
      )}

      {/* Fullscreen Modal Button */}
      <Button
        onClick={() => setIsFullscreenModal(true)}
        size="sm"
        variant="outline"
        className="absolute bottom-4 right-4 z-40 bg-slate-800/80 border-slate-600 hover:bg-slate-700 text-white backdrop-blur-sm gap-2"
        title="Open in Fullscreen Modal"
      >
        <Maximize2 className="h-4 w-4" />
        Fullscreen
      </Button>

      {/* 3D Canvas */}
      <Canvas
        key={cameraKey}
        camera={cameraSettings}
        frameloop="demand"
        dpr={[1, 1.5]} // Limit pixel ratio for performance
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={0.5} />
        {/* Asset marker light - bright point light for visibility */}
        <pointLight position={[0, 10, 10]} intensity={1.2} color="#ffffff" />

        {/* Grid Helper */}
        {showGridHelper && (
          <Grid
            args={[50, 50]}
            cellSize={1}
            cellThickness={0.5}
            cellColor="#6b7280"
            sectionSize={5}
            sectionThickness={1}
            sectionColor="#3b82f6"
            fadeDistance={100}
            fadeStrength={1}
            followCamera={false}
            infiniteGrid={false}
          />
        )}

        {/* Axes Helper */}
        {showAxes && <axesHelper args={[10]} />}

        {/* Model */}
        <Suspense fallback={null}>
          <WireframeModel
            modelUrl={modelUrl}
            modelType={modelType}
            modelScale={modelScale}
            buildingAssets={buildingAssets}
            activeStatuses={activeStatuses}
            wireframeColor={wireframeColor}
            onLoad={handleModelLoad}
            onError={handleModelError}
            onMeshClick={handleMeshClick}
            onMeshHover={handleMeshHover}
          />
        </Suspense>

        {/* Custom Revit-like Controls */}
        <RevitControls
          enableDamping={true}
          dampingFactor={0.05}
          rotateSpeed={1.0}
          enableYAxisRotation={enableYAxisRotation}
          yAxisRotateSpeed={yAxisRotateSpeed}
          zoomSpeed={7.0}
          maxDistance={100}
          minPolarAngle={0}
          maxPolarAngle={Math.PI}
          focusTarget={viewFocus.target}
          focusRadius={viewFocus.radius}
          resetToken={cameraKey}
          initialCameraState={savedCameraState}
          cameraStateRef={cameraStateRef}
        />

        {/* Performance Stats (dev mode) */}
        {showStats && <Stats />}

        {/* Ripple Animation */}
        <RippleAnimator />
      </Canvas>

      {/* Fullscreen Modal */}
      {isFullscreenModal && (
        <div className="fixed inset-0 z-[9999] bg-black/95 flex flex-col backdrop-blur-sm">
          {/* Modal Canvas Area */}
          <div
            className="flex-1 relative"
            onMouseMove={(e) => {
              const rect = (
                e.currentTarget as HTMLDivElement
              ).getBoundingClientRect();
              mousePos.current = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
              };
            }}
          >
            {/* Asset Hover Card (fullscreen modal) */}
            {hoveredAsset && (
              <div
                className="pointer-events-none absolute z-50 min-w-[200px] max-w-[280px] rounded-lg border border-slate-600 bg-slate-900/95 p-3 shadow-xl backdrop-blur-sm"
                style={{
                  left: Math.min(mousePos.current.x + 14, 900),
                  top: Math.max(mousePos.current.y - 10, 8),
                }}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
                  <span className="text-sm font-semibold text-white truncate">
                    {hoveredAsset.assetName || hoveredAsset.assetId}
                  </span>
                </div>
                {hoveredAsset.deviceLocation && (
                  <div className="mt-1 text-xs text-slate-300">
                    <span className="font-medium text-slate-400">
                      Location:{" "}
                    </span>
                    {hoveredAsset.deviceLocation}
                  </div>
                )}
                {hoveredAsset.deviceAddress && (
                  <div className="mt-0.5 text-xs text-slate-300">
                    <span className="font-medium text-slate-400">
                      Address:{" "}
                    </span>
                    {hoveredAsset.deviceAddress}
                  </div>
                )}
              </div>
            )}

            {/* Loading Overlay */}
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-50">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                  <p className="text-white text-sm">Loading 3D Model...</p>
                </div>
              </div>
            )}

            {/* Error Overlay */}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 z-50">
                <div className="text-center max-w-md p-6 bg-red-900/20 border border-red-700 rounded-lg">
                  <div className="text-red-500 text-lg font-semibold mb-2">
                    Error Loading Model
                  </div>
                  <p className="text-gray-300 text-sm">{error}</p>
                  <Button
                    onClick={() => window.location.reload()}
                    className="mt-4 bg-red-700 hover:bg-red-600"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            )}

            {/* Toolbar */}
            <div className="absolute top-4 left-4 z-40 flex flex-col gap-2">
              {/* Control Buttons */}
              <div className="flex gap-2">
                <Button
                  onClick={resetView}
                  size="sm"
                  variant="outline"
                  className="bg-slate-800/80 border-slate-600 hover:bg-slate-700 text-white backdrop-blur-sm"
                  title="Reset View"
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Reset
                </Button>

                <Button
                  onClick={toggleGrid}
                  size="sm"
                  variant="outline"
                  className={`${
                    showGridHelper ? "bg-blue-700/80" : "bg-slate-800/80"
                  } border-slate-600 hover:bg-slate-700 text-white backdrop-blur-sm`}
                  title="Toggle Grid"
                >
                  <Grid3x3 className="h-4 w-4" />
                </Button>
              </div>

              {/* Save View Buttons (fullscreen modal) */}
              <div className="flex gap-2">
                <Button
                  onClick={saveView}
                  size="sm"
                  variant="outline"
                  disabled={!buildingName || isCameraLoading}
                  className="bg-slate-800/80 border-slate-600 hover:bg-slate-700 text-white backdrop-blur-sm disabled:opacity-50"
                  title={
                    !buildingName
                      ? "No building selected — cannot save view"
                      : `Save view to ${buildingName}BuildingDB/3dconfigurations`
                  }
                >
                  {viewSaved ? (
                    <BookmarkCheck className="h-4 w-4 mr-1 text-green-400" />
                  ) : (
                    <Bookmark className="h-4 w-4 mr-1" />
                  )}
                  Save View
                </Button>

                {viewSaved && (
                  <Button
                    onClick={clearView}
                    size="sm"
                    variant="outline"
                    disabled={!buildingName || isCameraLoading}
                    className="bg-slate-800/80 border-slate-600 hover:bg-slate-700 text-white backdrop-blur-sm disabled:opacity-50"
                    title="Clear saved view"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>

              {/* Controls Help */}
              <div className="bg-slate-800/80 border border-slate-600 rounded p-2 text-xs text-gray-300 backdrop-blur-sm max-w-xs">
                <div className="font-semibold mb-1 text-blue-400">
                  Controls:
                </div>
                <div>🖱️ Left Drag: Rotate</div>
                <div>🖱️ Shift + Left Drag: Pan</div>
                <div>🖱️ Right Drag: Pan</div>
                <div>🖱️ Scroll: Zoom</div>
                <div>🖱️ Click Mesh: Highlight</div>
              </div>
            </div>

            {/* Exit Button */}
            <Button
              onClick={() => setIsFullscreenModal(false)}
              size="sm"
              variant="destructive"
              className="absolute top-4 right-4 z-40 gap-2"
              title="Exit Fullscreen Modal (ESC)"
            >
              <X className="h-4 w-4" />
              Exit
            </Button>

            {/* Canvas */}
            <Canvas
              key={`${cameraKey}-modal`}
              camera={cameraSettings}
              frameloop="demand"
              dpr={[1, 2]} // Allow higher pixel ratio in fullscreen
              gl={{
                antialias: true,
                alpha: false,
                powerPreference: "high-performance",
              }}
            >
              {/* Lighting */}
              <ambientLight intensity={0.5} />
              <directionalLight position={[10, 10, 5]} intensity={0.5} />
              {/* Asset marker light - bright point light for visibility */}
              <pointLight
                position={[0, 10, 10]}
                intensity={1.2}
                color="#ffffff"
              />

              {/* Grid Helper */}
              {showGridHelper && (
                <Grid
                  args={[50, 50]}
                  cellSize={1}
                  cellThickness={0.5}
                  cellColor="#6b7280"
                  sectionSize={5}
                  sectionThickness={1}
                  sectionColor="#3b82f6"
                  fadeDistance={100}
                  fadeStrength={1}
                  followCamera={false}
                  infiniteGrid={false}
                />
              )}

              {/* Axes Helper */}
              {showAxes && <axesHelper args={[10]} />}

              {/* Model */}
              <Suspense fallback={null}>
                <WireframeModel
                  modelUrl={modelUrl}
                  modelType={modelType}
                  modelScale={modelScale}
                  buildingAssets={buildingAssets}
                  activeStatuses={activeStatuses}
                  wireframeColor={wireframeColor}
                  onLoad={handleModelLoad}
                  onError={handleModelError}
                  onMeshClick={handleMeshClick}
                  onMeshHover={handleMeshHover}
                />
              </Suspense>

              {/* Custom Revit-like Controls */}
              <RevitControls
                enableDamping={true}
                dampingFactor={0.05}
                rotateSpeed={1.0}
                enableYAxisRotation={enableYAxisRotation}
                yAxisRotateSpeed={yAxisRotateSpeed}
                zoomSpeed={7.0}
                maxDistance={100}
                minPolarAngle={0}
                maxPolarAngle={Math.PI}
                focusTarget={viewFocus.target}
                focusRadius={viewFocus.radius}
                resetToken={cameraKey}
                initialCameraState={savedCameraState}
                cameraStateRef={cameraStateRef}
              />

              {/* Performance Stats (dev mode) */}
              {showStats && <Stats />}

              {/* Ripple Animation */}
              <RippleAnimator />
            </Canvas>
          </div>
        </div>
      )}
    </div>
  );
}
