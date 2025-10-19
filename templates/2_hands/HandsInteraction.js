import * as THREE from 'three';
import * as xb from 'xrblocks';

export class HandsInteraction extends xb.Script {
  init() {
    // Touch state.
    this.leftHandTouching = false;
    this.rightHandTouching = false;

    // Grab state.
    this.isGrabbing = false;
    this._handToObject = null;

    // Add a cylinder to touch and grab.
    this.originalColor = new THREE.Color(0xFBBC05);
    const geometry =
        new THREE.CylinderGeometry(0.1, 0.1, 0.2, 32).translate(0, 1.45, -0.4);
    const material = new THREE.MeshPhongMaterial({color: this.originalColor});
    this.target = new THREE.Mesh(geometry, material);
    this.add(this.target);

    // Add a light.
    this.add(new THREE.HemisphereLight(0xbbbbbb, 0x888888, 3));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(1, 1, 1).normalize();
    this.add(light);

    // Gesture recognition integrations.
    this.activeGestures = new Map();
    this.gesturePalette = {
      'pinch': 0xff6f00,
      'open-palm': 0x00acc1,
      'fist': 0x4e342e,
      'thumbs-up': 0x8bc34a,
      'point': 0x673ab7,
      'spread': 0xff4081,
    };
    this._onGestureStart = this.handleGestureStart.bind(this);
    this._onGestureEnd = this.handleGestureEnd.bind(this);
    this._onGestureUpdate = this.handleGestureUpdate.bind(this);
    if (xb.core.gestureRecognition) {
      xb.core.gestureRecognition.addEventListener(
          'gesturestart', this._onGestureStart);
      xb.core.gestureRecognition.addEventListener(
          'gestureend', this._onGestureEnd);
      xb.core.gestureRecognition.addEventListener(
          'gestureupdate', this._onGestureUpdate);
    }
  }

  _updateColor() {
    if (this.leftHandTouching && this.rightHandTouching) {
      this.target.material.color.setHex(0xDB4437);  // Red
    } else if (this.leftHandTouching) {
      this.target.material.color.setHex(0x34A853);  // Green
    } else if (this.rightHandTouching) {
      this.target.material.color.setHex(0x4285F4);  // Blue
    } else {
      this.target.material.color.copy(this.originalColor);  // Yellow
    }
    this._updateGestureHighlight();
  }

  _updateGestureHighlight() {
    const material = this.target.material;
    if (!material || !material.isMeshPhongMaterial) return;
    const activeGestures = Array.from(this.activeGestures.values());
    if (activeGestures.length === 0) {
      material.emissive.setHex(0x000000);
      material.emissiveIntensity = 0;
      return;
    }
    const gesture = activeGestures[activeGestures.length - 1];
    const color = this.gesturePalette[gesture] ?? 0xffffff;
    material.emissive.setHex(color);
    material.emissiveIntensity = 0.6;
  }

  onObjectTouchStart(event) {
    const handName = event.handIndex === xb.Handedness.LEFT ? 'left' : 'right';
    console.log(`Touch started with ${handName} hand!`);

    if (event.handIndex === xb.Handedness.LEFT) {
      this.leftHandTouching = true;
    } else if (event.handIndex === xb.Handedness.RIGHT) {
      this.rightHandTouching = true;
    }
    this._updateColor();
  }

  onObjectTouchEnd(event) {
    const handName = event.handIndex === xb.Handedness.LEFT ? 'left' : 'right';
    console.log(`Touch ended with ${handName} hand!`);

    if (event.handIndex === xb.Handedness.LEFT) {
      this.leftHandTouching = false;
    } else if (event.handIndex === xb.Handedness.RIGHT) {
      this.rightHandTouching = false;
    }
    this._updateColor();
  }

  onObjectGrabStart(event) {
    if (this.isGrabbing) return;
    this.isGrabbing = true;

    const handName = event.handIndex === xb.Handedness.LEFT ? 'left' : 'right';
    console.log(`Grab started with ${handName} hand!`);

    // Make sure matrices are fresh.
    this.target.updateMatrixWorld(true);
    event.hand.updateMatrixWorld(true);

    // Save the initial hand to object delta transform.
    const H0 = new THREE.Matrix4().copy(event.hand.matrixWorld);
    const O0 = new THREE.Matrix4().copy(this.target.matrixWorld);
    this._handToObject = new THREE.Matrix4().copy(H0).invert().multiply(O0);
  }

  onObjectGrabbing(event) {
    if (!this.isGrabbing || !this._handToObject) return;

    event.hand.updateMatrixWorld(true);
    const H = new THREE.Matrix4().copy(event.hand.matrixWorld);
    const O = new THREE.Matrix4().multiplyMatrices(H, this._handToObject);
    const parent = this.target.parent;
    if (parent) parent.updateMatrixWorld(true);
    const parentInv = parent ?
        new THREE.Matrix4().copy(parent.matrixWorld).invert() :
        new THREE.Matrix4().identity();

    const Olocal = new THREE.Matrix4().multiplyMatrices(parentInv, O);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    Olocal.decompose(pos, quat, scl);

    this.target.position.copy(pos);
    this.target.quaternion.copy(quat);

    this.target.updateMatrix();
  }

  onObjectGrabEnd(event) {
    if (!this.isGrabbing) return;
    const handName = event.handIndex === xb.Handedness.LEFT ? 'left' : 'right';
    console.log(`Grab ended with ${handName} hand!`);

    this.isGrabbing = false;
    this._handToObject = null;
  }

  handleGestureStart(event) {
    const {name, hand, confidence} = event.detail;
    console.log(
        `[Gesture] ${hand} hand started ${name} (${confidence.toFixed(2)})`);
    this.activeGestures.set(hand, name);
    this._updateGestureHighlight();
  }

  handleGestureUpdate(event) {
    const {name, hand, confidence} = event.detail;
    if (!this.activeGestures.has(hand)) return;
    console.log(
        `[Gesture] ${hand} hand ${name} confidence ${confidence.toFixed(2)}`);
  }

  handleGestureEnd(event) {
    const {name, hand} = event.detail;
    console.log(`[Gesture] ${hand} hand ended ${name}`);
    this.activeGestures.delete(hand);
    this._updateGestureHighlight();
  }

  dispose() {
    if (xb.core.gestureRecognition) {
      xb.core.gestureRecognition.removeEventListener(
          'gesturestart', this._onGestureStart);
      xb.core.gestureRecognition.removeEventListener(
          'gestureend', this._onGestureEnd);
      xb.core.gestureRecognition.removeEventListener(
          'gestureupdate', this._onGestureUpdate);
    }
  }
}
