/**
 * WireframeModel.tsx
 * Component for loading and rendering 3D models in wireframe mode
 * Supports .obj and .fbx formats
 */

import { useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  getFireMarkerHexColor,
  shouldFireRipple,
} from "@/lib/assetFireStatus";

// ---------------------------------------------------------------------------
// Fire & Life Safety keyword detection helpers
// ---------------------------------------------------------------------------
const FLS_KEYWORDS = [
  "fire",
  "smoke",
  "sprinkler",
  "alarm",
  "extinguish",
  "detector",
  "suppression",
  "hydrant",
  "hose",
  "reel",
  "safety",
  "emergency",
  "evacuation",
  "exit",
  "co2",
  "gasdetect",
  "heat sensor",
  "firepanel",
  "firebox",
  "firevalve",
  "foam",
  "fireman",
  "firehose",
  "breakglass",
  "mcp",
  "facp",
  "vsd",
  "deluge",
  "pre-action",
];

/** Returns true when a mesh name contains any fire-&-life-safety keyword */
function isFLSMesh(name: string): boolean {
  const lower = name.toLowerCase();
  return FLS_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Split a name into lowercase word tokens, ignoring separators and numbers
 * that appear alone (pure-numeric tokens like "01" are kept so IDs still
 * match exactly).
 * e.g. "PRANAV_HVAC_FD_01"  → ["pranav", "hvac", "fd", "01"]
 *      "Fire Smoke Detector" → ["fire", "smoke", "detector"]
 */
function tokenizeName(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * Returns a similarity score 0-1 between two names based on token overlap.
 * Score = (number of shared tokens) / (number of tokens in the shorter name).
 * Penalised further if neither name's token set is a subset of the other.
 */
function matchScore(nameA: string, nameB: string): number {
  const tokA = tokenizeName(nameA);
  const tokB = tokenizeName(nameB);
  if (tokA.length === 0 || tokB.length === 0) return 0;

  const setA = new Set(tokA);
  const setB = new Set(tokB);
  let shared = 0;
  setA.forEach((t) => {
    if (setB.has(t)) shared++;
  });

  // Base score: shared / shorter-name token count
  const shorter = Math.min(setA.size, setB.size);
  return shared / shorter;
}

/** Minimum token-overlap score required to accept a mesh→asset match */
const MATCH_THRESHOLD = 0.5;

/**
 * Finds the best-matching FBX mesh position for an asset name.
 * Returns null if no candidate scores above MATCH_THRESHOLD.
 */
function findBestFLSPosition(
  assetName: string,
  flsPositionMap: Map<string, { pos: THREE.Vector3; rawName: string }>,
): { pos: THREE.Vector3; meshRawName: string; score: number } | null {
  let best: { pos: THREE.Vector3; meshRawName: string; score: number } | null =
    null;

  for (const [, entry] of flsPositionMap) {
    const score = matchScore(assetName, entry.rawName);
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { pos: entry.pos.clone(), meshRawName: entry.rawName, score };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Custom marker model helpers
// ---------------------------------------------------------------------------

/** Promisified FBX loader — resolves with the loaded Group or rejects on error */
async function loadFBXModelAsync(url: string): Promise<THREE.Group> {
  const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
  const loader = new FBXLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

/**
 * Normalise a cloned custom marker model:
 *  - auto-scale so its largest dimension equals `targetSize` units
 *  - apply a status-based MeshStandardMaterial to every child mesh
 * Returns an array of all colourable child meshes (for live status updates).
 */
function prepareCustomMarker(
  group: THREE.Group,
  color: string,
  targetSize = 2.0,
): THREE.Mesh[] {
  // Auto-scale to targetSize
  const bbox = new THREE.Box3().setFromObject(group);
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) group.scale.setScalar(targetSize / maxDim);

  // Re-centre so the bottom of the model sits at y=0 relative to the group
  bbox.setFromObject(group);
  const localMin = group.worldToLocal(bbox.min.clone());
  group.position.y -= localMin.y;

  // Replace every mesh material with a status-coloured one
  const colorableMeshes: THREE.Mesh[] = [];
  group.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((m) => m.dispose());
    } else {
      mesh.material?.dispose();
    }
    mesh.material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.8,
      metalness: 0.3,
      roughness: 0.4,
    });
    colorableMeshes.push(mesh);
  });
  return colorableMeshes;
}

// ---------------------------------------------------------------------------

/**
 * Standalone factory that builds a single pulsing ripple sphere.
 * Used both during initial model load and for live add/remove on status change.
 */
function makeRippleMesh(
  assetLabel: string,
  position: THREE.Vector3,
  color: string,
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1, 16, 16);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.4,
    wireframe: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${assetLabel}-ripple`;
  mesh.position.copy(position);
  mesh.userData.animationTime = 0;
  mesh.userData.originalScale = 1;
  mesh.userData.maxScale = 4;
  mesh.userData.animationSpeed = 0.03;
  return mesh;
}

// ---------------------------------------------------------------------------

export interface AssetHoverInfo {
  assetId: string;
  assetName: string;
  deviceAddress?: string;
  deviceLocation?: string;
}

interface WireframeModelProps {
  modelUrl: string;
  modelType: "obj" | "fbx";
  wireframeColor?: string;
  modelScale?: number;
  buildingAssets?: Array<{
    id?: string;
    assetName?: string;
    deviceAddress?: string;
    deviceLocation?: string;
    coordinates?: { x?: number; y?: number; z?: number };
  }>;
  activeStatuses?: Record<string, { active: number }>;
  onLoad?: (object: THREE.Group | THREE.Object3D) => void;
  onError?: (error: Error) => void;
  onMeshClick?: (meshName: string, mesh: THREE.Mesh) => void;
  /** Called after FBX load with a list of all detected FLS mesh names (for debugging) */
  onFLSExtracted?: (flsMeshNames: string[]) => void;
  /** Called when pointer enters/leaves an asset marker — null means pointer left */
  onMeshHover?: (info: AssetHoverInfo | null) => void;
}

export function WireframeModel({
  modelUrl,
  modelType,
  wireframeColor = "#00ffff",
  modelScale = 0.01,
  buildingAssets = [],
  activeStatuses = {},
  onLoad,
  onError,
  onMeshClick,
  onFLSExtracted,
  onMeshHover,
}: WireframeModelProps) {
  const [model, setModel] = useState<THREE.Group | THREE.Object3D | null>(null);
  const [highlightedMesh, setHighlightedMesh] = useState<THREE.Mesh | null>(
    null,
  );
  const { invalidate } = useThree();

  // Keep activeStatuses in a ref so status changes never trigger re-renders or effect re-runs
  const activeStatusesRef = useRef(activeStatuses);
  useEffect(() => {
    activeStatusesRef.current = activeStatuses;
  });

  // O(1) map: assetId → marker mesh — built once when model loads
  const markerMeshMapRef = useRef<Map<string, THREE.Mesh>>(new Map());
  // O(1) map: assetId → ripple mesh — updated live as activeStatuses change
  const rippleMeshMapRef = useRef<Map<string, THREE.Mesh>>(new Map());
  // Reference to the group containing asset markers so dynamic ripples can be attached
  const assetsGroupRef = useRef<THREE.Group | null>(null);

  // Keep stable refs for callbacks so they don't re-trigger the load effect
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  const onFLSExtractedRef = useRef(onFLSExtracted);
  const onMeshHoverRef = useRef(onMeshHover);
  useEffect(() => {
    onLoadRef.current = onLoad;
  });
  useEffect(() => {
    onErrorRef.current = onError;
  });
  useEffect(() => {
    onFLSExtractedRef.current = onFLSExtracted;
  });
  useEffect(() => {
    onMeshHoverRef.current = onMeshHover;
  });

  // Load model based on type
  useEffect(() => {
    const loadModel = async () => {
      try {
        let loader: any;

        if (modelType === "obj") {
          const { OBJLoader } =
            await import("three/examples/jsm/loaders/OBJLoader.js");
          loader = new OBJLoader();
        } else {
          const { FBXLoader } =
            await import("three/examples/jsm/loaders/FBXLoader.js");
          loader = new FBXLoader();
        }

        loader.load(
          modelUrl,
          async (object: THREE.Group | THREE.Object3D) => {
            const sourceBounds = new THREE.Box3().setFromObject(object);

            // Convert all meshes to wireframe
            object.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;

                // Dispose old material to prevent memory leaks
                if (mesh.material) {
                  if (Array.isArray(mesh.material)) {
                    mesh.material.forEach((mat) => mat.dispose());
                  } else {
                    mesh.material.dispose();
                  }
                }

                // Apply wireframe material
                mesh.material = new THREE.MeshBasicMaterial({
                  color: wireframeColor,
                  wireframe: true,
                  transparent: false,
                });

                // Disable raycasting on wireframe geometry so pointer events
                // pass through to asset markers sitting inside the building
                mesh.raycast = () => {};

                // Store original color for highlight restore
                mesh.userData.originalColor = wireframeColor;
              }
            });

            // Apply configured model scale (default: 1:100 = 0.01)
            object.scale.setScalar(modelScale);

            // Rotate model space so all child
            object.rotation.x = -Math.PI / 2;

            // Place model at origin
            const box = new THREE.Box3().setFromObject(object);
            const center = box.getCenter(new THREE.Vector3());
            object.position.x -= center.x;
            object.position.z -= center.z;
            object.position.y -= box.min.y;

            // ---------------------------------------------------------------
            // FLS Position Extraction (FBX only)
            // After all transforms are applied, ensure matrices are fresh so
            // that localToWorld / worldToLocal give correct results.
            // ---------------------------------------------------------------
            /** rawMeshName → { pos (object-local), rawName } for scored matching */
            const flsPositionMap = new Map<
              string,
              { pos: THREE.Vector3; rawName: string }
            >();

            if (modelType === "fbx") {
              object.updateMatrixWorld(true);

              const flsMeshNames: string[] = [];

              object.traverse((child) => {
                if (!(child as THREE.Mesh).isMesh) return;
                const mesh = child as THREE.Mesh;
                if (!mesh.name) return;

                // Compute bounding box in mesh-local geometry space
                if (!mesh.geometry.boundingBox) {
                  mesh.geometry.computeBoundingBox();
                }
                if (!mesh.geometry.boundingBox) return;

                // Get geometry centre: mesh-local → world → object-local
                const localCenter = mesh.geometry.boundingBox.getCenter(
                  new THREE.Vector3(),
                );
                mesh.localToWorld(localCenter);
                object.worldToLocal(localCenter);

                // Store under raw name (keeps original casing/tokens for scoring)
                if (!flsPositionMap.has(mesh.name)) {
                  flsPositionMap.set(mesh.name, {
                    pos: localCenter.clone(),
                    rawName: mesh.name,
                  });
                }

                if (isFLSMesh(mesh.name)) flsMeshNames.push(mesh.name);
              });

              if (flsMeshNames.length > 0) {
                console.log(
                  `[WireframeModel] Extracted ${flsMeshNames.length} FLS mesh(es) from FBX:`,
                  flsMeshNames,
                );
                onFLSExtractedRef.current?.(flsMeshNames);
              }
            }
            // ---------------------------------------------------------------

            const getColorByStatus = getFireMarkerHexColor;

            // ------------------------------------------------------------------
            // Pre-load custom marker model for detector assets (if any present)
            // ------------------------------------------------------------------
            let detectorTemplate: THREE.Group | null = null;
            const hasDetectorAssets = buildingAssets.some((a) =>
              (a.assetName || a.id || "").toLowerCase().includes("detector"),
            );
            if (hasDetectorAssets) {
              try {
                detectorTemplate = await loadFBXModelAsync(
                  "/asset/models/smoke-detector.fbx",
                );
                console.log(
                  "[WireframeModel] Loaded smoke-detector.fbx template",
                );
              } catch (err) {
                console.warn(
                  "[WireframeModel] Failed to load smoke-detector.fbx — falling back to box markers",
                  err,
                );
              }
            }
            // ------------------------------------------------------------------

            // Build asset markers and populate O(1) lookup map
            markerMeshMapRef.current.clear();
            rippleMeshMapRef.current.clear();
            assetsGroupRef.current = null;

            if (buildingAssets.length > 0) {
              const assetsGroup = new THREE.Group();
              assetsGroup.name = "building-assets-markers";
              assetsGroupRef.current = assetsGroup;

              const markerSize = 2.0;
              const markerGeometry = new THREE.BoxGeometry(
                markerSize,
                markerSize,
                markerSize,
              );

              buildingAssets.forEach((asset) => {
                // ----------------------------------------------------------
                // Resolve marker position:
                //   1. Try FLS position extracted from FBX geometry by name
                //   2. Fall back to Firebase-stored coordinates
                // ----------------------------------------------------------
                let resolvedPosition: THREE.Vector3 | null = null;

                if (flsPositionMap.size > 0) {
                  const assetLabel = asset.assetName || asset.id || "";

                  // Exact mesh-name match (e.g. same ID string)
                  if (flsPositionMap.has(assetLabel)) {
                    resolvedPosition = flsPositionMap
                      .get(assetLabel)!
                      .pos.clone();
                    console.log(
                      `[WireframeModel] Exact match: "${assetLabel}" → FBX position`,
                      resolvedPosition,
                    );
                  } else {
                    // Token-overlap scored best match
                    const match = findBestFLSPosition(
                      assetLabel,
                      flsPositionMap,
                    );
                    if (match) {
                      resolvedPosition = match.pos;
                      console.log(
                        `[WireframeModel] Scored match (${(match.score * 100).toFixed(0)}%): "${assetLabel}" ↔ "${match.meshRawName}" → FBX position`,
                        resolvedPosition,
                      );
                    }
                  }
                }

                // Fall back to stored Firebase coordinates when no FLS match found
                if (!resolvedPosition) {
                  const coordinateX = Number(asset.coordinates?.x);
                  const coordinateY = Number(asset.coordinates?.y);
                  const coordinateZ = Number(asset.coordinates?.z);

                  if (
                    !Number.isFinite(coordinateX) ||
                    !Number.isFinite(coordinateY) ||
                    !Number.isFinite(coordinateZ)
                  ) {
                    return; // skip asset — no position available
                  }

                  resolvedPosition = new THREE.Vector3(
                    coordinateX,
                    coordinateY,
                    coordinateZ,
                  );
                }

                // Legacy compat — still used below
                const coordinateX = resolvedPosition.x;
                const coordinateY = resolvedPosition.y;
                const coordinateZ = resolvedPosition.z;

                if (
                  !Number.isFinite(coordinateX) ||
                  !Number.isFinite(coordinateY) ||
                  !Number.isFinite(coordinateZ)
                ) {
                  return;
                }

                // Read initial status from ref (not prop) to avoid dep
                const activeValue =
                  activeStatusesRef.current[asset.id || ""]?.active ?? 0;
                const markerColor = getColorByStatus(activeValue);

                const assetLabel = asset.assetName || asset.id || "";
                const isDetector = assetLabel
                  .toLowerCase()
                  .includes("detector");

                // ---- Ripple helper (shared by both marker types) -----------
                const maybeAddRipple = (position: THREE.Vector3) => {
                  if (!shouldFireRipple(activeValue)) return;
                  const ripple = makeRippleMesh(
                    assetLabel,
                    position,
                    markerColor,
                  );
                  assetsGroup.add(ripple);
                  if (asset.id) rippleMeshMapRef.current.set(asset.id, ripple);
                };
                // ------------------------------------------------------------

                if (isDetector && detectorTemplate) {
                  // ---- Smoke-detector FBX marker --------------------------
                  const detClone = detectorTemplate.clone(true) as THREE.Group;
                  detClone.name = assetLabel;
                  detClone.userData.assetId = asset.id;
                  detClone.userData.assetName = asset.assetName;
                  detClone.userData.activeValue = activeValue;

                  // Apply status colour + auto-scale; get list of all meshes
                  const colorableMeshes = prepareCustomMarker(
                    detClone,
                    markerColor,
                    markerSize,
                  );

                  detClone.userData.deviceAddress = asset.deviceAddress;
                  detClone.userData.deviceLocation = asset.deviceLocation;
                  detClone.position.set(coordinateX, coordinateY, coordinateZ);
                  detClone.rotation.x = (3 * Math.PI) / 2; // point nozzle downwards

                  // Register first child mesh as O(1) proxy; store siblings for bulk updates
                  if (asset.id && colorableMeshes.length > 0) {
                    const proxy = colorableMeshes[0];
                    proxy.userData.colorableMeshes = colorableMeshes;
                    proxy.userData.markerPosition = new THREE.Vector3(
                      coordinateX,
                      coordinateY,
                      coordinateZ,
                    );
                    markerMeshMapRef.current.set(asset.id, proxy);
                  }

                  maybeAddRipple(
                    new THREE.Vector3(coordinateX, coordinateY, coordinateZ),
                  );
                  assetsGroup.add(detClone);
                } else {
                  // ---- Default box marker ---------------------------------
                  const markerMaterial = new THREE.MeshStandardMaterial({
                    color: markerColor,
                    emissive: markerColor,
                    emissiveIntensity: 1.0,
                    metalness: 0.3,
                    roughness: 0.4,
                  });
                  const markerMesh = new THREE.Mesh(
                    markerGeometry,
                    markerMaterial,
                  );
                  markerMesh.position.set(
                    coordinateX,
                    coordinateY,
                    coordinateZ,
                  );
                  markerMesh.name = assetLabel;
                  markerMesh.userData.assetId = asset.id;
                  markerMesh.userData.assetName = asset.assetName;
                  markerMesh.userData.deviceAddress = asset.deviceAddress;
                  markerMesh.userData.deviceLocation = asset.deviceLocation;
                  markerMesh.userData.activeValue = activeValue;

                  markerMesh.userData.markerPosition = new THREE.Vector3(
                    coordinateX,
                    coordinateY,
                    coordinateZ,
                  );
                  if (asset.id) {
                    markerMeshMapRef.current.set(asset.id, markerMesh);
                  }

                  maybeAddRipple(markerMesh.position);
                  assetsGroup.add(markerMesh);
                }
              });

              if (assetsGroup.children.length > 0) {
                object.add(assetsGroup);
              } else {
                markerGeometry.dispose();
              }
            }

            setModel(object);
            onLoadRef.current?.(object);
          },
          (progress: ProgressEvent) => {
            const percentComplete = (progress.loaded / progress.total) * 100;
            console.log(`Loading model: ${percentComplete.toFixed(2)}%`);
          },
          (error: Error) => {
            console.error("Error loading model:", error);
            onErrorRef.current?.(error);
          },
        );
      } catch (error) {
        console.error("Failed to load loader:", error);
        onError?.(error as Error);
      }
    };

    loadModel();

    return () => {
      // Cleanup on unmount
      if (model) {
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.geometry?.dispose();
            if (mesh.material) {
              if (Array.isArray(mesh.material)) {
                mesh.material.forEach((mat) => mat.dispose());
              } else {
                mesh.material.dispose();
              }
            }
          }
        });
      }
    };
  }, [
    modelUrl,
    modelType,
    modelScale,
    wireframeColor,
    buildingAssets,
    // NOTE: activeStatuses intentionally excluded — status changes update markers
    // directly via the effect below without re-loading the entire model
  ]);

  // Handle click events on meshes
  const handleClick = (event: any) => {
    event.stopPropagation();

    if (event.object && (event.object as THREE.Mesh).isMesh) {
      const mesh = event.object as THREE.Mesh;
      const meshName = mesh.name || "Unnamed Mesh";

      // Highlight temporarily
      setHighlightedMesh(mesh);

      // Restore original color after 2 seconds
      setTimeout(() => {
        setHighlightedMesh(null);
      }, 2000);

      // Callback with mesh info
      onMeshClick?.(meshName, mesh);
      console.log("Clicked mesh:", meshName);
    }
  };

  // Update highlighted mesh color
  useEffect(() => {
    if (highlightedMesh) {
      const material = highlightedMesh.material as THREE.MeshBasicMaterial;
      material.color.set("#ffff00"); // Yellow highlight
    } else if (model) {
      // Restore all mesh colors
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const material = mesh.material as THREE.MeshBasicMaterial;
          material.color.set(mesh.userData.originalColor || wireframeColor);
        }
      });
    }
  }, [highlightedMesh, model, wireframeColor]);

  // Update marker colors AND ripples when activeStatuses change — O(1) via maps
  useEffect(() => {
    if (!model || markerMeshMapRef.current.size === 0) return;

    const getColorByStatus = getFireMarkerHexColor;

    let didChange = false;

    markerMeshMapRef.current.forEach((mesh, assetId) => {
      const activeValue = activeStatuses[assetId]?.active ?? 0;
      const newColor = getColorByStatus(activeValue);

      // ---- Update marker colour ----------------------------------------
      // For custom markers (e.g. detector FBX) all colourable sibling meshes
      // are stored on the proxy; for box markers it's just the mesh itself.
      const targets: THREE.Mesh[] = mesh.userData.colorableMeshes ?? [mesh];

      targets.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (!mat || Array.isArray(mat)) return;
        const currentHex = "#" + mat.color.getHexString();
        if (currentHex !== newColor) {
          mat.color.setStyle(newColor);
          mat.emissive.setStyle(newColor);
          mat.needsUpdate = true;
          didChange = true;
        }
      });

      // ---- Ripple add / remove -----------------------------------------
      const shouldRipple = shouldFireRipple(activeValue);
      const existingRipple = rippleMeshMapRef.current.get(assetId);

      if (shouldRipple && !existingRipple && assetsGroupRef.current) {
        // Determine world position from stored userData
        const pos: THREE.Vector3 =
          mesh.userData.markerPosition ??
          new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
        const assetLabel = mesh.userData.assetName || assetId;
        const ripple = makeRippleMesh(assetLabel, pos, newColor);
        assetsGroupRef.current.add(ripple);
        rippleMeshMapRef.current.set(assetId, ripple);
        didChange = true;
      } else if (!shouldRipple && existingRipple) {
        existingRipple.parent?.remove(existingRipple);
        (existingRipple.geometry as THREE.BufferGeometry).dispose();
        (existingRipple.material as THREE.Material).dispose();
        rippleMeshMapRef.current.delete(assetId);
        didChange = true;
      } else if (shouldRipple && existingRipple) {
        // Keep ripple in sync with updated status colour
        const rMat = existingRipple.material as THREE.MeshStandardMaterial;
        if (rMat && !Array.isArray(rMat)) {
          rMat.color.setStyle(newColor);
          rMat.emissive.setStyle(newColor);
          rMat.needsUpdate = true;
        }
      }
    });

    // Only ask Three.js to repaint if something actually changed
    if (didChange) invalidate();
  }, [model, activeStatuses, invalidate]);

  if (!model) return null;

  const handlePointerOver = (event: any) => {
    event.stopPropagation();
    if (!onMeshHoverRef.current) return;
    // Walk up the object hierarchy to find asset userData
    let obj: THREE.Object3D | null = event.object;
    while (obj) {
      const { assetId, assetName, deviceAddress, deviceLocation } =
        obj.userData;
      if (assetId) {
        onMeshHoverRef.current({
          assetId,
          assetName: assetName || assetId,
          deviceAddress,
          deviceLocation,
        });
        return;
      }
      obj = obj.parent;
    }
  };

  const handlePointerOut = (event: any) => {
    event.stopPropagation();
    onMeshHoverRef.current?.(null);
  };

  return (
    <primitive
      object={model}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    />
  );
}
