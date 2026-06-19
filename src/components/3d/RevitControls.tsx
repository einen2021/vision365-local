/**
 * RevitControls.tsx
 * Custom camera controls that mimic Autodesk Revit's 3D navigation behavior
 * - Left Click + Drag: Rotate around target
 * - Shift + Left Click: Pan in 3D space
 * - Right Click + Drag: Pan in 3D space
 * - Scroll: Zoom toward cursor
 */

import { useThree, useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

/** Serialisable snapshot of the camera orbit state */
export interface CameraState {
  theta: number;
  phi: number;
  radius: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

interface RevitControlsProps {
  enableDamping?: boolean;
  dampingFactor?: number;
  rotateSpeed?: number;
  enableYAxisRotation?: boolean;
  yAxisRotateSpeed?: number;
  zoomSpeed?: number;
  panSpeed?: number;
  minDistance?: number;
  maxDistance?: number;
  minPolarAngle?: number;
  maxPolarAngle?: number;
  focusTarget?: [number, number, number];
  focusRadius?: number;
  resetToken?: number;
  /** Restore a previously saved camera state on first load (overrides auto-fit) */
  initialCameraState?: CameraState | null;
  /** A ref that RevitControls keeps updated with the latest camera state (for saving) */
  cameraStateRef?: React.MutableRefObject<CameraState | null>;
}

export function RevitControls({
  enableDamping = true,
  dampingFactor = 0.05,
  rotateSpeed = 1.0,
  enableYAxisRotation = true,
  yAxisRotateSpeed = 1.0,
  zoomSpeed = 1.0,
  panSpeed = 1.0,
  minDistance = 1,
  maxDistance = 100,
  minPolarAngle = 0,
  maxPolarAngle = Math.PI,
  focusTarget,
  focusRadius,
  resetToken,
  initialCameraState,
  cameraStateRef,
}: RevitControlsProps) {
  const { camera, gl, scene, size, invalidate } = useThree();
  const invalidateRef = useRef(invalidate);
  useEffect(() => {
    invalidateRef.current = invalidate;
  });
  const stateRef = useRef({
    isDragging: false,
    isPanning: false,
    isRotating: false,
  });

  // State for mouse position and rotation
  const mouseStart = useRef(new THREE.Vector2());
  const mouseCurrent = useRef(new THREE.Vector2());
  const target = useRef(new THREE.Vector3(0, 0, 0));
  const targetGoal = useRef(new THREE.Vector3(0, 0, 0));
  const spherical = useRef(new THREE.Spherical());
  const sphericalGoal = useRef(new THREE.Spherical());
  const raycaster = useRef(new THREE.Raycaster());
  const lastResetToken = useRef<number>(-1);
  const hasFocused = useRef(false);

  // Calculate initial spherical coordinates
  useEffect(() => {
    const offset = new THREE.Vector3();
    offset.copy(camera.position).sub(target.current);
    spherical.current.setFromVector3(offset);
    sphericalGoal.current.copy(spherical.current);
  }, [camera]);

  // Auto-focus camera on loaded model bounds (only on mount and reset button clicks)
  useEffect(() => {
    if (!focusTarget || !focusRadius || focusRadius <= 0) return;

    // Skip if we've already focused and reset token hasn't changed
    if (
      hasFocused.current &&
      resetToken !== undefined &&
      lastResetToken.current === resetToken
    ) {
      return;
    }

    const targetVector = new THREE.Vector3(
      focusTarget[0],
      focusTarget[1],
      focusTarget[2],
    );

    // ── Restore saved camera state on first load (skip auto-fit) ──────────
    // Only use the saved state on the initial load (hasFocused = false).
    // When the Reset button is pressed (resetToken changes) we fall through
    // to the normal auto-fit logic so the view resets as expected.
    if (!hasFocused.current && initialCameraState) {
      const { theta, phi, radius, targetX, targetY, targetZ } =
        initialCameraState;
      const savedTarget = new THREE.Vector3(targetX, targetY, targetZ);

      spherical.current.set(radius, phi, theta);
      sphericalGoal.current.copy(spherical.current);
      target.current.copy(savedTarget);
      targetGoal.current.copy(savedTarget);

      const offset = new THREE.Vector3().setFromSpherical(spherical.current);
      camera.position.copy(savedTarget).add(offset);
      camera.lookAt(savedTarget);

      hasFocused.current = true;
      if (resetToken !== undefined) lastResetToken.current = resetToken;
      invalidateRef.current();
      return;
    }
    // ─────────────────────────────────────────────────────────────────────

    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const aspect =
      size.width > 0 && size.height > 0 ? size.width / size.height : 1;
    const vFov = THREE.MathUtils.degToRad(perspectiveCamera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    const distanceForHeight = focusRadius / Math.sin(Math.max(vFov / 2, 0.001));
    const distanceForWidth = focusRadius / Math.sin(Math.max(hFov / 2, 0.001));
    const fitDistance = Math.max(distanceForHeight, distanceForWidth) * 1.25;
    const clampedDistance = Math.max(
      minDistance,
      Math.min(maxDistance, fitDistance),
    );

    const direction = new THREE.Vector3(1, 0.7, 1).normalize();
    const nextPosition = targetVector
      .clone()
      .addScaledVector(direction, clampedDistance);

    camera.position.copy(nextPosition);
    camera.lookAt(targetVector);

    target.current.copy(targetVector);
    targetGoal.current.copy(targetVector);

    const offset = nextPosition.clone().sub(targetVector);
    spherical.current.setFromVector3(offset);
    sphericalGoal.current.copy(spherical.current);

    // Mark as focused and store current reset token
    hasFocused.current = true;
    if (resetToken !== undefined) {
      lastResetToken.current = resetToken;
    }

    invalidateRef.current(); // Render the freshly focused frame
  }, [resetToken, focusRadius]);

  const handlePointerDown = useCallback(
    (event: PointerEvent) => {
      event.preventDefault();

      mouseStart.current.set(
        (event.clientX / gl.domElement.clientWidth) * 2 - 1,
        -(event.clientY / gl.domElement.clientHeight) * 2 + 1,
      );
      mouseCurrent.current.copy(mouseStart.current);

      // Determine control mode based on button and modifier keys
      const isRightClick = event.button === 2;
      const isLeftClick = event.button === 0;
      const isShiftPressed = event.shiftKey;

      if (isRightClick || (isLeftClick && isShiftPressed)) {
        // Right click or Shift + Left click = Pan
        stateRef.current.isPanning = true;
        stateRef.current.isDragging = true;
      } else if (isLeftClick) {
        // Left click = Rotate
        stateRef.current.isRotating = true;
        stateRef.current.isDragging = true;

        // Raycast to find hit point on model for smart pivot
        raycaster.current.setFromCamera(mouseStart.current, camera);
        const intersects = raycaster.current.intersectObjects(
          scene.children,
          true,
        );

        if (intersects.length > 0) {
          targetGoal.current.copy(intersects[0].point);
        }
      }

      gl.domElement.style.cursor = stateRef.current.isPanning
        ? "move"
        : "grabbing";
    },
    [camera, gl, scene],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (!stateRef.current.isDragging) return;

      event.preventDefault();

      const mouseX = (event.clientX / gl.domElement.clientWidth) * 2 - 1;
      const mouseY = -(event.clientY / gl.domElement.clientHeight) * 2 + 1;

      const deltaX = mouseX - mouseCurrent.current.x;
      const deltaY = mouseY - mouseCurrent.current.y;

      mouseCurrent.current.set(mouseX, mouseY);

      if (stateRef.current.isRotating) {
        // Orbit rotation around target
        if (enableYAxisRotation) {
          sphericalGoal.current.theta -=
            deltaX * rotateSpeed * yAxisRotateSpeed * 3;
        }
        sphericalGoal.current.phi -= deltaY * rotateSpeed * 3;

        // Clamp phi to prevent camera flipping
        sphericalGoal.current.phi = Math.max(
          minPolarAngle,
          Math.min(maxPolarAngle, sphericalGoal.current.phi),
        );
      } else if (stateRef.current.isPanning) {
        // Improved pan movement with proper screen-to-world space conversion
        const offset = new THREE.Vector3();
        offset.copy(camera.position).sub(target.current);
        const distance = offset.length();

        // Calculate pan distance based on camera FOV and distance
        const fov = (camera as THREE.PerspectiveCamera).fov;
        const targetDistance =
          distance * Math.tan(((fov / 2) * Math.PI) / 180) * 2;

        const panX = deltaX * targetDistance * panSpeed;
        const panY = deltaY * targetDistance * panSpeed;

        // Get camera's right and up vectors
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();

        right.setFromMatrixColumn(camera.matrix, 0); // X axis
        up.setFromMatrixColumn(camera.matrix, 1); // Y axis

        // Apply pan movement
        const panVector = new THREE.Vector3();
        panVector.addScaledVector(right, -panX);
        panVector.addScaledVector(up, panY);

        targetGoal.current.add(panVector);
      }

      // Schedule a repaint for demand-mode rendering
      invalidateRef.current();
    },
    [
      camera,
      gl,
      rotateSpeed,
      enableYAxisRotation,
      yAxisRotateSpeed,
      panSpeed,
      minPolarAngle,
      maxPolarAngle,
    ],
  );

  const handlePointerUp = useCallback(() => {
    stateRef.current.isDragging = false;
    stateRef.current.isRotating = false;
    stateRef.current.isPanning = false;
    gl.domElement.style.cursor = "grab";
    invalidateRef.current(); // Render the final settled frame
  }, [gl]);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();

      // Get cursor position for zoom target
      const mouseX = (event.clientX / gl.domElement.clientWidth) * 2 - 1;
      const mouseY = -(event.clientY / gl.domElement.clientHeight) * 2 + 1;

      raycaster.current.setFromCamera(
        new THREE.Vector2(mouseX, mouseY),
        camera,
      );
      const intersects = raycaster.current.intersectObjects(
        scene.children,
        true,
      );

      const zoomDelta = event.deltaY * 0.001 * zoomSpeed;

      if (intersects.length > 0) {
        // Zoom toward cursor hit point (Revit-like behavior)
        const hitPoint = intersects[0].point;
        const direction = new THREE.Vector3();
        direction.subVectors(hitPoint, camera.position).normalize();

        const zoomAmount = sphericalGoal.current.radius * zoomDelta;
        sphericalGoal.current.radius += zoomAmount;

        // Move target slightly toward hit point for smooth zoom
        targetGoal.current.lerp(hitPoint, Math.abs(zoomDelta) * 0.1);
      } else {
        // Zoom toward current target
        sphericalGoal.current.radius +=
          sphericalGoal.current.radius * zoomDelta;
      }

      // Clamp zoom distance
      sphericalGoal.current.radius = Math.max(
        minDistance,
        Math.min(maxDistance, sphericalGoal.current.radius),
      );

      // Schedule a repaint for demand-mode rendering
      invalidateRef.current();
    },
    [camera, gl, scene, zoomSpeed, minDistance, maxDistance],
  );

  const handleContextMenu = useCallback((event: Event) => {
    event.preventDefault();
  }, []);

  useEffect(() => {
    const domElement = gl.domElement;

    // Set initial cursor style
    domElement.style.cursor = "grab";

    domElement.addEventListener("pointerdown", handlePointerDown);
    domElement.addEventListener("pointermove", handlePointerMove);
    domElement.addEventListener("pointerup", handlePointerUp);
    domElement.addEventListener("pointerleave", handlePointerUp);
    domElement.addEventListener("wheel", handleWheel, { passive: false });
    domElement.addEventListener("contextmenu", handleContextMenu);

    return () => {
      domElement.removeEventListener("pointerdown", handlePointerDown);
      domElement.removeEventListener("pointermove", handlePointerMove);
      domElement.removeEventListener("pointerup", handlePointerUp);
      domElement.removeEventListener("pointerleave", handlePointerUp);
      domElement.removeEventListener("wheel", handleWheel);
      domElement.removeEventListener("contextmenu", handleContextMenu);
      domElement.style.cursor = "default";
    };
  }, [
    gl,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    handleContextMenu,
  ]);

  // Update camera position — only repaints when camera is actually moving
  useFrame(() => {
    const EPS = 0.00001;

    const thetaDiff = Math.abs(
      sphericalGoal.current.theta - spherical.current.theta,
    );
    const phiDiff = Math.abs(sphericalGoal.current.phi - spherical.current.phi);
    const radiusDiff = Math.abs(
      sphericalGoal.current.radius - spherical.current.radius,
    );
    const targetDiff = target.current.distanceTo(targetGoal.current);
    const isMoving =
      thetaDiff > EPS || phiDiff > EPS || radiusDiff > EPS || targetDiff > EPS;

    if (!isMoving && !stateRef.current.isDragging) return; // Nothing to do — skip repaint

    if (enableDamping) {
      target.current.lerp(targetGoal.current, dampingFactor);
      spherical.current.theta +=
        (sphericalGoal.current.theta - spherical.current.theta) * dampingFactor;
      spherical.current.phi +=
        (sphericalGoal.current.phi - spherical.current.phi) * dampingFactor;
      spherical.current.radius +=
        (sphericalGoal.current.radius - spherical.current.radius) *
        dampingFactor;
    } else {
      target.current.copy(targetGoal.current);
      spherical.current.copy(sphericalGoal.current);
    }

    const offset = new THREE.Vector3();
    offset.setFromSpherical(spherical.current);
    camera.position.copy(target.current).add(offset);
    camera.lookAt(target.current);

    // Keep external ref in sync so ModelViewer can read it for saving
    if (cameraStateRef) {
      cameraStateRef.current = {
        theta: spherical.current.theta,
        phi: spherical.current.phi,
        radius: spherical.current.radius,
        targetX: target.current.x,
        targetY: target.current.y,
        targetZ: target.current.z,
      };
    }

    invalidate(); // Tell Three.js to render this frame
  });

  return null;
}
