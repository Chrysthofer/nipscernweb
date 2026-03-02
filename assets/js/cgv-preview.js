/**
 * NIPSCERN CGV-Preview — Interactive 3D ATLAS Calorimeter
 * Three.js — ES Module
 *
 * Renders a stylised ATLAS calorimeter with:
 *   · TileCal hadronic barrel (3 layers, ±z, 10 η × 64 φ)
 *   · LAr EM barrel (4 depth layers, ±z, variable η × 64 φ)
 *   · HEC endcaps (4 disk layers, ±z, 8 η × 32 φ)
 *
 * Event generation: 800–1200 active cells, hadronic jet in TileCal,
 * EM shower in LAr, diffuse HEC activity, noise.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================
// Detector geometry parameters (in metres)
// ============================================================

const TILECAL = {
  layers: [
    { rMin: 2.28, rMax: 3.00 },
    { rMin: 3.00, rMax: 3.41 },
    { rMin: 3.41, rMax: 3.82 },
  ],
  zHalf: 2.82,
  etaBins: 10,
  phiBins: 64,
  etaMax: 1.0,
};

const LAR = {
  layers: [
    { rMin: 1.50, rMax: 1.67, etaBins: 56 },
    { rMin: 1.67, rMax: 1.87, etaBins: 28 },
    { rMin: 1.87, rMax: 2.11, etaBins: 28 },
    { rMin: 2.11, rMax: 2.28, etaBins: 28 },
  ],
  zHalf: 3.20,
  phiBins: 64,
  etaMax: 1.475,
};

const HEC = {
  zPositions: [3.50, 4.00, 4.58, 5.14], // each disk centre |z|
  thickness: 0.25,
  rMin: 0.38,
  rMax: 2.03,
  etaBins: 8,
  phiBins: 32,
  etaMin: 1.5,
  etaMax: 3.2,
};

// ============================================================
// Colour mapping: energy → colour
// Gradient: blue → cyan → green → yellow → red
// ============================================================
function energyToColour(e) {
  // e normalised 0–1
  const t = Math.max(0, Math.min(1, e));
  const stops = [
    [0.00, 0x0a, 0x3a, 0x8f],   // deep blue
    [0.20, 0x00, 0xaa, 0xff],   // cyan
    [0.45, 0x00, 0xe0, 0x60],   // green
    [0.70, 0xff, 0xee, 0x00],   // yellow
    [1.00, 0xff, 0x22, 0x00],   // red
  ];

  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;

  const [t0, r0, g0, b0] = stops[i];
  const [t1, r1, g1, b1] = stops[i + 1];
  const f = (t - t0) / (t1 - t0);

  const r = Math.round(r0 + f * (r1 - r0));
  const g = Math.round(g0 + f * (g1 - g0));
  const b = Math.round(b0 + f * (b1 - b0));

  return new THREE.Color(r / 255, g / 255, b / 255);
}

// ============================================================
// Create a wedge-shaped cell geometry
// (approximated as a box at correct world position)
// ============================================================

// For a barrel cell at (rMin, rMax, etaMin, etaMax, phiMin, phiMax):
// → build a BoxGeometry, scale to cell size, rotate to phi position,
//   translate to cell centre along radial direction.
function createBarrelCellMesh(rMin, rMax, etaMid, deltaPhi, phiMid, side, colour) {
  const rMid = (rMin + rMax) * 0.5;
  const dr = (rMax - rMin) * 0.92;       // radial thickness (slightly inset)
  const dz = rMid * 0.09 * 0.92;        // η-size approximation
  const dphi = rMid * deltaPhi * 0.88;  // arc length in phi

  const geo = new THREE.BoxGeometry(dr, dz, dphi);
  const mat = new THREE.MeshPhongMaterial({
    color: colour,
    emissive: colour,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 0.88,
  });

  const mesh = new THREE.Mesh(geo, mat);

  // Position along eta (z direction in barrel)
  const z = side * rMid * Math.sinh(etaMid);

  // Rotate so x-axis points radially outward at phiMid
  mesh.rotation.y = -phiMid;

  // Position: x = rMid in local pre-rotation space
  mesh.position.set(
    rMid * Math.cos(phiMid),
    z,
    -rMid * Math.sin(phiMid)
  );

  return mesh;
}

function createHECCellMesh(zPos, side, rMin, rMax, etaMid, phiMin, phiMax, colour) {
  const rMid = (rMin + rMax) * 0.5;
  const dr = (rMax - rMin) * 0.88;
  const phiMid = (phiMin + phiMax) * 0.5;
  const dphi = rMid * (phiMax - phiMin) * 0.88;
  const dz = 0.18;

  const geo = new THREE.BoxGeometry(dr, dz, dphi);
  const mat = new THREE.MeshPhongMaterial({
    color: colour,
    emissive: colour,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 0.88,
  });

  const mesh = new THREE.Mesh(geo, mat);

  mesh.position.set(
    rMid * Math.cos(phiMid),
    side * zPos,
    -rMid * Math.sin(phiMid)
  );
  mesh.rotation.y = -phiMid;

  return mesh;
}

// ============================================================
// Build wireframe shells (outline geometry of sub-detectors)
// ============================================================
function buildShells(scene) {
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x1a2a4a,
    wireframe: true,
    transparent: true,
    opacity: 0.25,
  });

  // TileCal barrel
  const tileGeo = new THREE.CylinderGeometry(3.82, 3.82, TILECAL.zHalf * 2, 64, 1, true);
  const tileInner = new THREE.CylinderGeometry(2.28, 2.28, TILECAL.zHalf * 2, 64, 1, true);
  [tileGeo, tileInner].forEach(g => {
    const m = new THREE.Mesh(g, wireMat.clone());
    m.rotation.x = Math.PI / 2;
    m.userData.isShell = true;
    m.userData.layer = 'tilecal';
    scene.add(m);
  });

  // LAr barrel
  const larGeo = new THREE.CylinderGeometry(2.28, 2.28, LAR.zHalf * 2, 64, 1, true);
  const larInner = new THREE.CylinderGeometry(1.50, 1.50, LAR.zHalf * 2, 64, 1, true);
  [larGeo, larInner].forEach(g => {
    const m = new THREE.Mesh(g, wireMat.clone());
    m.rotation.x = Math.PI / 2;
    m.userData.isShell = true;
    m.userData.layer = 'lar';
    scene.add(m);
  });

  // End caps (rings)
  HEC.zPositions.forEach(z => {
    [-1, 1].forEach(s => {
      const geo = new THREE.RingGeometry(HEC.rMin, HEC.rMax, 32);
      const m = new THREE.Mesh(geo, wireMat.clone());
      m.position.y = s * z;
      m.userData.isShell = true;
      m.userData.layer = 'hec';
      scene.add(m);
    });
  });

  // Beam axis line
  const beamGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -7, 0),
    new THREE.Vector3(0, 7, 0),
  ]);
  const beamLine = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.4 }));
  beamLine.userData.isBeamAxis = true;
  beamLine.visible = false;
  scene.add(beamLine);
}

// ============================================================
// Gaussian-like spread utility
// ============================================================
function gaussian(x, mu, sigma) {
  return Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
}

// ============================================================
// Event generation
// ============================================================
function generateEvent(scene) {
  // Remove old cells
  const toRemove = [];
  scene.children.forEach(c => { if (c.userData.isCell) toRemove.push(c); });
  toRemove.forEach(c => {
    scene.remove(c);
    c.geometry?.dispose();
    c.material?.dispose();
  });

  const cells = [];

  // ---- Hadronic jet in TileCal ----
  const jetEta  = (Math.random() * 0.7 - 0.35);           // central barrel
  const jetPhi  = Math.random() * Math.PI * 2;
  const jetSide = Math.random() < 0.5 ? 1 : -1;
  const jetEnergy = 0.7 + Math.random() * 0.3;

  const phiStep = (2 * Math.PI) / TILECAL.phiBins;
  const etaStep = TILECAL.etaMax / TILECAL.etaBins;

  TILECAL.layers.forEach(layer => {
    for (let ieta = 0; ieta < TILECAL.etaBins; ieta++) {
      const etaMid = -TILECAL.etaMax + (ieta + 0.5) * etaStep;
      for (let iphi = 0; iphi < TILECAL.phiBins; iphi++) {
        const phiMid = -Math.PI + (iphi + 0.5) * phiStep;

        // Jet contribution
        const dEta = etaMid - jetEta * jetSide;
        const dPhi = Math.atan2(Math.sin(phiMid - jetPhi), Math.cos(phiMid - jetPhi));
        const jet = jetEnergy * gaussian(dEta, 0, 0.18) * gaussian(dPhi, 0, 0.22);

        // Noise floor
        const noise = Math.random() < 0.03 ? Math.random() * 0.05 : 0;

        const energy = jet + noise;
        if (energy < 0.04) continue;

        const colour = energyToColour(energy);
        const mesh = createBarrelCellMesh(
          layer.rMin, layer.rMax,
          etaMid, phiStep, phiMid,
          jetSide, colour
        );
        mesh.userData.isCell = true;
        mesh.userData.layer = 'tilecal';
        mesh.userData.energy = energy;
        cells.push(mesh);
      }
    }
  });

  // ---- EM shower in LAr ----
  const emEta  = (Math.random() * 1.2 - 0.6);
  const emPhi  = jetPhi + Math.PI * (0.8 + Math.random() * 0.4); // opposite side
  const emSide = Math.random() < 0.5 ? 1 : -1;
  const emEnergy = 0.8 + Math.random() * 0.2;

  const larPhiStep = (2 * Math.PI) / LAR.phiBins;

  LAR.layers.forEach((layer, li) => {
    const etaStep = LAR.etaMax * 2 / layer.etaBins;
    for (let ieta = 0; ieta < layer.etaBins; ieta++) {
      const etaMid = -LAR.etaMax + (ieta + 0.5) * etaStep;
      for (let iphi = 0; iphi < LAR.phiBins; iphi++) {
        const phiMid = -Math.PI + (iphi + 0.5) * larPhiStep;

        const dEta = etaMid - emEta * emSide;
        const dPhi = Math.atan2(Math.sin(phiMid - emPhi), Math.cos(phiMid - emPhi));

        // EM showers are narrower and peak in middle layers
        const layerWeight = [0.3, 1.0, 0.8, 0.3][li];
        const shower = emEnergy * layerWeight * gaussian(dEta, 0, 0.08) * gaussian(dPhi, 0, 0.10);
        const noise = Math.random() < 0.02 ? Math.random() * 0.04 : 0;

        const energy = shower + noise;
        if (energy < 0.06) continue;

        const colour = energyToColour(energy * 1.1);
        const mesh = createBarrelCellMesh(
          layer.rMin, layer.rMax,
          etaMid, larPhiStep, phiMid,
          emSide, colour
        );
        mesh.userData.isCell = true;
        mesh.userData.layer = 'lar';
        mesh.userData.energy = energy;
        cells.push(mesh);
      }
    }
  });

  // ---- HEC diffuse activity ----
  const hecPhiStep = (2 * Math.PI) / HEC.phiBins;
  const hecEtaStep = (HEC.etaMax - HEC.etaMin) / HEC.etaBins;

  HEC.zPositions.forEach((zPos, li) => {
    for (let ieta = 0; ieta < HEC.etaBins; ieta++) {
      const etaMid = HEC.etaMin + (ieta + 0.5) * hecEtaStep;
      const rMid = (HEC.rMin + HEC.rMax) * 0.5 * (0.5 + ieta / HEC.etaBins * 0.5);
      const rMin = HEC.rMin + ieta * (HEC.rMax - HEC.rMin) / HEC.etaBins;
      const rMax = HEC.rMin + (ieta + 1) * (HEC.rMax - HEC.rMin) / HEC.etaBins;

      for (let iphi = 0; iphi < HEC.phiBins; iphi++) {
        const phiMin = -Math.PI + iphi * hecPhiStep;
        const phiMax = phiMin + hecPhiStep;

        // Diffuse HEC activity — random with some structure
        const e = Math.random();
        if (e > 0.12) continue; // sparse

        const energy = 0.05 + Math.random() * 0.3;
        const colour = energyToColour(energy * 0.7);

        [-1, 1].forEach(side => {
          const mesh = createHECCellMesh(zPos, side, rMin, rMax, etaMid, phiMin, phiMax, colour);
          mesh.userData.isCell = true;
          mesh.userData.layer = 'hec';
          mesh.userData.energy = energy;
          cells.push(mesh);
        });
      }
    }
  });

  // Add all cells to scene
  cells.forEach(c => scene.add(c));

  return cells.length;
}

// ============================================================
// Main init — exported
// ============================================================
export function initCGVPreview(containerId = 'cgv-canvas-wrapper') {
  const wrapper = document.getElementById(containerId);
  if (!wrapper) return;

  const canvas = wrapper.querySelector('#cgv-canvas');
  const loading = wrapper.querySelector('.cgv-loading');

  // ---- Renderer ----
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrapper.clientWidth, wrapper.clientHeight);
  renderer.setClearColor(0x05070f, 1);

  // ---- Scene ----
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05070f, 0.04);

  // ---- Camera ----
  const camera = new THREE.PerspectiveCamera(55, wrapper.clientWidth / wrapper.clientHeight, 0.1, 100);
  camera.position.set(8, 3, 8);
  camera.lookAt(0, 0, 0);

  // ---- Lights ----
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);
  const dirLight2 = new THREE.DirectionalLight(0x4466ff, 0.3);
  dirLight2.position.set(-5, -5, -5);
  scene.add(dirLight2);

  // ---- Controls ----
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.8;
  controls.panSpeed = 0.6;
  controls.minDistance = 3;
  controls.maxDistance = 20;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.4;

  // ---- Build shells ----
  buildShells(scene);

  // ---- State ----
  let wireframeMode = false;
  let beamAxisVisible = false;
  let cellCount = 0;
  const layerVisible = { tilecal: true, lar: true, hec: true };

  // ---- Buttons ----
  const btnEvent   = wrapper.querySelector('#cgv-btn-event');
  const btnWire    = wrapper.querySelector('#cgv-btn-wire');
  const btnBeam    = wrapper.querySelector('#cgv-btn-beam');
  const btnTilecal = wrapper.querySelector('#cgv-btn-tilecal');
  const btnLar     = wrapper.querySelector('#cgv-btn-lar');
  const btnHec     = wrapper.querySelector('#cgv-btn-hec');
  const countEl    = wrapper.querySelector('#cgv-cell-count');

  function updateCellCount(n) {
    cellCount = n;
    if (countEl) countEl.textContent = n.toLocaleString();
  }

  function setWireframe(on) {
    wireframeMode = on;
    scene.children.forEach(c => {
      if (c.userData.isCell && c.material) {
        c.material.wireframe = on;
        c.material.opacity = on ? 0.7 : 0.88;
      }
      if (c.userData.isShell && c.material) {
        c.material.opacity = on ? 0.5 : 0.25;
      }
    });
    btnWire?.classList.toggle('active', on);
  }

  function setBeamAxis(on) {
    beamAxisVisible = on;
    scene.children.forEach(c => {
      if (c.userData.isBeamAxis) c.visible = on;
    });
    btnBeam?.classList.toggle('active', on);
  }

  function setLayerVisible(layer, on) {
    layerVisible[layer] = on;
    scene.children.forEach(c => {
      if ((c.userData.isCell || c.userData.isShell) && c.userData.layer === layer) {
        c.visible = on;
      }
    });
    const btn = wrapper.querySelector(`#cgv-btn-${layer}`);
    btn?.classList.toggle('active', on);
    btn?.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  btnEvent?.addEventListener('click', () => {
    const n = generateEvent(scene);
    updateCellCount(n);
    if (wireframeMode) setWireframe(true);
    // Re-apply hidden layers to newly generated cells
    Object.entries(layerVisible).forEach(([layer, on]) => {
      if (!on) setLayerVisible(layer, false);
    });
  });

  btnWire?.addEventListener('click', () => setWireframe(!wireframeMode));
  btnBeam?.addEventListener('click', () => setBeamAxis(!beamAxisVisible));
  btnTilecal?.addEventListener('click', () => setLayerVisible('tilecal', !layerVisible.tilecal));
  btnLar?.addEventListener('click', () => setLayerVisible('lar', !layerVisible.lar));
  btnHec?.addEventListener('click', () => setLayerVisible('hec', !layerVisible.hec));

  // ---- Initial event ----
  const initialCount = generateEvent(scene);
  updateCellCount(initialCount);

  // ---- Hide loading ----
  if (loading) {
    loading.classList.add('hidden');
  }

  // ---- Resize ----
  const onResize = () => {
    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  // ---- Render loop ----
  let frameId;
  function animate() {
    frameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // ---- Cleanup ----
  return () => {
    cancelAnimationFrame(frameId);
    window.removeEventListener('resize', onResize);
    renderer.dispose();
    controls.dispose();
  };
}
