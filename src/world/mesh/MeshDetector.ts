import * as THREE from 'three';

import {Script} from '../../core/Script';
import {DetectedMesh} from './DetectedMesh';
import {MeshDetectionOptions} from './MeshDetectionOptions';
import {Physics} from '../../physics/Physics';

const SEMANTIC_LABELS = ['floor', 'ceiling', 'wall'];
const SEMANTIC_COLORS = [0x00ff00, 0xffff00, 0x0000ff];

// Wrapper around WebXR Mesh Detection API
// https://immersive-web.github.io/real-world-meshing/
export class MeshDetector extends Script {
  static readonly dependencies = {
    options: MeshDetectionOptions,
    renderer: THREE.WebGLRenderer,
  };
  private debugMaterials = new Map<string, THREE.Material>();
  private fallbackDebugMaterial: THREE.Material | null = null;
  xrMeshToThreeMesh = new Map<XRMesh, DetectedMesh>();
  threeMeshToXrMesh = new Map<DetectedMesh, XRMesh>();
  private renderer!: THREE.WebGLRenderer;
  private physics?: Physics;
  private defaultMaterial = new THREE.MeshBasicMaterial({visible: false});

  // Optimization1: Camera culling constants
  private readonly kMaxViewDistance = 3.0;
  private readonly kFOVCosThreshold = 0.25;

  // Optimization2: Limit the number of meshes processed per frame (Not used)
  private readonly MAX_MESHES_PER_FRAME = 100000; // Process only n meshes per frame

  // Optimization3: Mesh update throttling (similar to ARCore reflection cube map in /usr/local/google/home/adamren/Desktop/xrlabs/arlabs/xrblocks/samples/lighting)
  private lastMeshUpdateTime = 0;
  private readonly MESH_UPDATE_INTERVAL_MS = 1000;

  // Optimization4: Cleanup old meshes (ToDo: Not used)
  private meshLastSeenTime = new Map<XRMesh, number>();
  private readonly MAX_MESH_COUNT = 200; // Limit total mesh count
  private readonly MESH_CLEANUP_INTERVAL_MS = 5000; // Cleanup every 5 seconds
  private lastCleanupTime = 0;

  override init({
    options,
    renderer,
  }: {
    options: MeshDetectionOptions;
    renderer: THREE.WebGLRenderer;
  }) {
    this.renderer = renderer;
    if (options.showDebugVisualizations) {
      this.fallbackDebugMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        wireframe: true,
        side: THREE.DoubleSide,
      });

      for (let i = 0; i < SEMANTIC_LABELS.length; i++) {
        this.debugMaterials.set(
          SEMANTIC_LABELS[i],
          new THREE.MeshBasicMaterial({
            color: SEMANTIC_COLORS[i],
            wireframe: true,
            side: THREE.DoubleSide,
          })
        );
      }
    }
  }

  override initPhysics(physics: Physics) {
    this.physics = physics;
    for (const [_, mesh] of this.xrMeshToThreeMesh.entries()) {
      mesh.initRapierPhysics(physics.RAPIER, physics.blendedWorld);
    }
  }

  updateMeshes(_timestamp: number, frame?: XRFrame) {
    const meshes = frame?.detectedMeshes;
    if (!meshes) return;

    // Throttle mesh updates to ~30fps while rendering continues at full rate
    const now = performance.now();
    const timeSinceLastUpdate = now - this.lastMeshUpdateTime;

    if (timeSinceLastUpdate < this.MESH_UPDATE_INTERVAL_MS) {
      // Skip mesh update this frame - rendering continues without blocking
      return;
    }

    this.lastMeshUpdateTime = now;

    const referenceSpace = this.renderer.xr.getReferenceSpace();
    if (!referenceSpace) return;
    const {position: cameraPosition, forward: cameraForward} =
      this.getCameraInfo(frame, referenceSpace);

    // Delete old meshes
    for (const [xrMesh, threeMesh] of this.xrMeshToThreeMesh.entries()) {
      if (!meshes.has(xrMesh)) {
        this.xrMeshToThreeMesh.delete(xrMesh);
        this.threeMeshToXrMesh.delete(threeMesh);
        threeMesh.dispose();
        this.remove(threeMesh);
      }
    }

    // Limit processing to avoid frame drops
    let processedCount = 0;
    // const limitedMeshes = Array.from(meshes).slice(0, this.MAX_MESHES_PER_FRAME);
    // const testMeshes = new Set(limitedMeshes);
    // Process meshes with camera culling BEFORE creating/updating them
    for (const xrMesh of meshes) {
      if (processedCount >= this.MAX_MESHES_PER_FRAME) break;

      // Camera culling: only process visible meshes
      if (
        !this.shouldShowMeshInView(
          xrMesh,
          cameraPosition,
          cameraForward,
          frame,
          referenceSpace
        )
      ) {
        // If mesh exists but is not visible, remove it for performance
        if (this.xrMeshToThreeMesh.has(xrMesh)) {
          const threeMesh = this.xrMeshToThreeMesh.get(xrMesh)!;
          this.xrMeshToThreeMesh.delete(xrMesh);
          this.threeMeshToXrMesh.delete(threeMesh);
          threeMesh.dispose();
          this.remove(threeMesh);
        }
        continue; // Skip this mesh - don't create or update it
      }

      processedCount++;

      // Only process meshes that pass camera culling
      if (!this.xrMeshToThreeMesh.has(xrMesh)) {
        // New mesh - create it
        const threeMesh = this.createMesh(frame, xrMesh);
        this.xrMeshToThreeMesh.set(xrMesh, threeMesh);
        this.threeMeshToXrMesh.set(threeMesh, xrMesh);
        this.add(threeMesh);
        if (this.physics) {
          threeMesh.initRapierPhysics(
            this.physics.RAPIER,
            this.physics.blendedWorld
          );
        }
      } else {
        // Existing mesh - update vertices and pose
        const threeMesh = this.xrMeshToThreeMesh.get(xrMesh)!;
        threeMesh.updateVertices(xrMesh);
        this.updateMeshPose(frame, xrMesh, threeMesh);
      }
    }
  }

  private createMesh(frame: XRFrame, xrMesh: XRMesh) {
    const semanticLabel = xrMesh.semanticLabel;
    const material =
      (semanticLabel && this.debugMaterials.get(semanticLabel)) ||
      this.fallbackDebugMaterial ||
      this.defaultMaterial;
    const mesh = new DetectedMesh(xrMesh, material);
    this.updateMeshPose(frame, xrMesh, mesh);
    return mesh;
  }

  private updateMeshPose(frame: XRFrame, xrMesh: XRMesh, mesh: THREE.Mesh) {
    const pose = frame.getPose(
      xrMesh.meshSpace,
      this.renderer.xr.getReferenceSpace()!
    );
    if (pose) {
      mesh.position.copy(pose.transform.position);
      mesh.quaternion.copy(pose.transform.orientation);
    }
  }

  /**
   * Gets camera position and forward vector from XR frame.
   */
  private getCameraInfo(
    frame: XRFrame,
    referenceSpace: XRReferenceSpace
  ): {
    position: THREE.Vector3;
    forward: THREE.Vector3;
  } {
    const viewerPose = frame.getViewerPose(referenceSpace);
    const cameraPosition = new THREE.Vector3(0, 0, 0);
    let cameraForward = new THREE.Vector3(0, 0, -1);

    if (viewerPose && viewerPose.views && viewerPose.views.length > 0) {
      // Get camera position from first view's transform
      const viewTransform = viewerPose.views[0].transform;
      const viewMatrix = new THREE.Matrix4().fromArray(viewTransform.matrix);
      cameraPosition.setFromMatrixPosition(viewMatrix);

      // Extract forward vector from matrix (typically -Z axis)
      const forward = new THREE.Vector3(0, 0, -1);
      forward.applyMatrix4(viewMatrix);
      forward.sub(cameraPosition).normalize();
      cameraForward = forward;
    }

    return {position: cameraPosition, forward: cameraForward};
  }

  /**
   * Checks if the mesh should be visible based on camera position and FOV.
   */
  private shouldShowMeshInView(
    mesh: XRMesh,
    cameraPosition: THREE.Vector3,
    cameraForward: THREE.Vector3,
    frame: XRFrame,
    referenceSpace: XRReferenceSpace
  ): boolean {
    const meshPose = frame.getPose(mesh.meshSpace, referenceSpace);
    if (!meshPose) {
      return true; // Default to showing if no pose available
    }

    const meshMatrix = new THREE.Matrix4().fromArray(meshPose.transform.matrix);
    const meshPosition = new THREE.Vector3();
    meshPosition.setFromMatrixPosition(meshMatrix);

    // Calculate distance
    const dx = meshPosition.x - cameraPosition.x;
    const dy = meshPosition.y - cameraPosition.y;
    const dz = meshPosition.z - cameraPosition.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance > this.kMaxViewDistance) {
      return false;
    }

    // Calculate direction vector and dot product (FOV check)
    if (distance > 0.001) {
      const invDistance = 1.0 / distance;
      const dirX = dx * invDistance;
      const dirY = dy * invDistance;
      const dirZ = dz * invDistance;

      const dotForward =
        dirX * cameraForward.x +
        dirY * cameraForward.y +
        dirZ * cameraForward.z;

      if (dotForward < this.kFOVCosThreshold) {
        return false;
      }
    }

    return true;
  }
}
