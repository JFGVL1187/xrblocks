import * as THREE from 'three';
import * as xb from 'xrblocks';
import {palette} from 'xrblocks/addons/utils/Palette.js';
import Stats from 'three/addons/libs/stats.module.js';

import {BallShooter} from './BallShooter.js';

const kTimeLiveMs = xb.getUrlParamInt('timeLiveMs', 3000);
const kDefalteMs = xb.getUrlParamInt('defalteMs', 200);
const kLightX = xb.getUrlParamFloat('lightX', 0);
const kLightY = xb.getUrlParamFloat('lightY', 500);
const kLightZ = xb.getUrlParamFloat('lightZ', -10);
const kRadius = xb.getUrlParamFloat('radius', 0.08);
const kBallsPerSecond = xb.getUrlParamFloat('ballsPerSecond', 30);
const kVelocityScale = xb.getUrlParamInt('velocityScale', 1.0);
const kNumSpheres = 100;

export class BallPit extends xb.Script {
  constructor() {
    super();
    this.ballShooter = new BallShooter({
      numBalls: kNumSpheres,
      radius: kRadius,
      palette: palette,
      liveDuration: kTimeLiveMs,
      deflateDuration: kDefalteMs,
    });
    this.add(this.ballShooter);
    this.addLights();

    this.lastBallCreatedTimeForController = new Map();
    this.pointer = new THREE.Vector2();
    this.velocity = new THREE.Vector3();

    // Initialize Stats for FPS dashboard
    this.stats = new Stats();
    this.stats.dom.style.width = '80px';
    this.stats.dom.style.height = '48px';
    this.stats.showPanel(0); // 0: fps, 1: ms, 2: mb
    document.body.appendChild(this.stats.dom);

    this.statsMesh = null;
  }

  init() {
    xb.add(this);
    this.createStatsMesh();
  }

  update() {
    super.update();

    // Update stats
    this.stats.update();
    if (this.statsMesh && this.statsMesh.material.map) {
      this.statsMesh.material.map.needsUpdate = true;
    }

    // Update stats mesh position to follow camera in XR mode
    if (this.statsMesh && xb.core.renderer.xr.isPresenting) {
      const camera = xb.core.renderer.xr.getCamera();
      if (camera && camera.cameras && camera.cameras.length > 0) {
        const xrCamera = camera.cameras[0];
        // Position stats mesh relative to camera
        const offset = new THREE.Vector3(-0.15, 0.15, -0.5);
        offset.applyQuaternion(xrCamera.quaternion);
        this.statsMesh.position.copy(xrCamera.position).add(offset);
        this.statsMesh.quaternion.copy(xrCamera.quaternion);
        this.statsMesh.rotateY(Math.PI / 6);
      }
    }

    for (const controller of xb.core.input.controllers) {
      this.controllerUpdate(controller);
    }
  }

  /**
   * Creates a 3D mesh to display the FPS stats in XR space.
   */
  createStatsMesh() {
    const statsCanvas = this.stats.dom.children[0];
    const geometry = new THREE.PlaneGeometry(0.25, 0.15);
    const texture = new THREE.CanvasTexture(statsCanvas);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    this.statsMesh = new THREE.Mesh(geometry, material);

    this.statsMesh.position.set(-0.15, 0.15, -0.5);

    this.add(this.statsMesh);
  }

  // Adds hemisphere light for ambient lighting and directional light.
  addLights() {
    this.add(new THREE.HemisphereLight(0xbbbbbb, 0x888888, 3));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(kLightX, kLightY, kLightZ);
    light.castShadow = true;
    light.shadow.mapSize.width = 2048; // Default is usually 1024
    light.shadow.mapSize.height = 2048; // Default is usually 1024
    this.add(light);
  }

  // Calculates pointer position in normalized device coordinates.
  updatePointerPosition(event) {
    // (-1 to +1) for both components
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    // scale pointer.x from [-1, 0] to [-1, 1]
    this.pointer.x = 1 + 2 * this.pointer.x;
  }

  onPointerDown(event) {
    this.updatePointerPosition(event);
    const cameras = xb.core.renderer.xr.getCamera().cameras;
    if (cameras.length == 0) return;
    const camera = cameras[0];
    // Spawn a ball slightly in front of the camera.
    const position = new THREE.Vector3(0.0, 0.0, -0.2)
      .applyQuaternion(camera.quaternion)
      .add(camera.position);
    const matrix = new THREE.Matrix4();
    matrix.setPosition(position.x, position.y, position.z);
    // Convert pointer position to angle based on the camera.
    const vector = new THREE.Vector4(this.pointer.x, this.pointer.y, 1.0, 1);
    const inverseProjectionMatrix = camera.projectionMatrix.clone().invert();
    vector.applyMatrix4(inverseProjectionMatrix);
    vector.multiplyScalar(1 / vector.w);
    this.velocity.copy(vector);
    this.velocity.normalize().multiplyScalar(4.0);
    this.velocity.applyQuaternion(camera.quaternion);
    this.ballShooter.spawnBallAt(position, this.velocity);
  }

  controllerUpdate(controller) {
    const now = performance.now();
    if (!this.lastBallCreatedTimeForController.has(controller)) {
      this.lastBallCreatedTimeForController.set(controller, -99);
    }
    if (
      controller.userData.selected &&
      now - this.lastBallCreatedTimeForController.get(controller) >=
        1000 / kBallsPerSecond
    ) {
      // Place this 8 cm in front of the hands.
      const newPosition = new THREE.Vector3(0.0, 0.0, -0.08)
        .applyQuaternion(controller.quaternion)
        .add(controller.position);

      this.velocity.set(0, 0, -5.0 * kVelocityScale);
      this.velocity.applyQuaternion(controller.quaternion);

      this.ballShooter.spawnBallAt(newPosition, this.velocity);

      this.lastBallCreatedTimeForController.set(controller, now);
    }
  }
}
