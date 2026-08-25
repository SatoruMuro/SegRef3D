import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

export function trianglesToPositions(triangles) {
  const positions = new Float32Array(triangles.length * 9);
  let offset = 0;
  for (const triangle of triangles) {
    for (const vertex of triangle) {
      positions[offset++] = Number(vertex[0]);
      positions[offset++] = Number(vertex[1]);
      positions[offset++] = Number(vertex[2]);
    }
  }
  return positions;
}

export function createStlPreview({ container, meshes, colors }) {
  if (!container) throw new Error("The 3D preview container is missing.");
  if (!Array.isArray(meshes) || meshes.length === 0) throw new Error("No surfaces are available for preview.");

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x17191d, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 1.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(1.5, -1, 2);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x9fcdd1, 0.9);
  fillLight.position.set(-1.2, 0.8, -0.5);
  scene.add(fillLight);

  const surfaceGroup = new THREE.Group();
  scene.add(surfaceGroup);
  const surfaces = new Map();
  for (const item of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(trianglesToPositions(item.triangles), 3));
    geometry.computeVertexNormals();
    const color = new THREE.Color(colors[item.label] || "#d9544b");
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.68,
      metalness: 0.04,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.86,
    });
    const surface = new THREE.Mesh(geometry, material);
    surface.name = `Obj ${item.label}`;
    surfaceGroup.add(surface);
    surfaces.set(item.label, surface);
  }

  const bounds = new THREE.Box3().setFromObject(surfaceGroup);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  surfaceGroup.position.sub(center);
  const maximum = Math.max(size.x, size.y, size.z, 1);
  camera.near = Math.max(maximum / 10000, 0.001);
  camera.far = maximum * 100;
  camera.updateProjectionMatrix();

  const resetCamera = () => {
    const distance = maximum * 2.25;
    camera.position.set(distance * 0.78, -distance, distance * 0.72);
    camera.up.set(0, 0, 1);
    controls.target.set(0, 0, 0);
    controls.update();
  };
  resetCamera();

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let animationFrame = 0;
  let disposed = false;
  const animate = () => {
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(animate);
  };
  animate();

  return {
    resetCamera,
    setObjectVisible(label, visible) {
      const surface = surfaces.get(Number(label));
      if (surface) surface.visible = Boolean(visible);
    },
    setObjectOpacity(label, opacity) {
      const surface = surfaces.get(Number(label));
      if (surface) surface.material.opacity = Math.max(0.05, Math.min(1, Number(opacity)));
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      controls.dispose();
      for (const surface of surfaces.values()) {
        surface.geometry.dispose();
        surface.material.dispose();
      }
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
