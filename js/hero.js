import * as THREE from "./vendor/three.module.min.js";

export function initHero(reducedMotion) {
  const host = document.querySelector("#hero-art");
  const canvas = document.querySelector("#hero-canvas");
  const toggle = document.querySelector("#motion-toggle");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
  } catch {
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.55;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
  camera.position.set(0, 0, 8.8);
  scene.add(new THREE.HemisphereLight(0xfff6e7, 0x743221, 2.5));
  const key = new THREE.DirectionalLight(0xfff5e2, 4.5);
  key.position.set(-3, 5, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff9b5e, 3);
  rim.position.set(4, 1, -2);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 1.3);
  fill.position.set(2, -1, 4);
  scene.add(fill);

  // A continuous, ribbed toroidal sculpture. The small radial waves create
  // real geometry and shadows instead of relying on an image texture.
  const geometry = new THREE.TorusGeometry(1.34, 0.52, 44, 480);
  const positions = geometry.attributes.position;
  const point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    const angle = Math.atan2(point.y, point.x);
    const centerX = Math.cos(angle) * 1.34;
    const centerY = Math.sin(angle) * 1.34;
    const ridge = 1 + 0.065 * Math.cos(angle * 96);
    point.x = centerX + (point.x - centerX) * ridge;
    point.y = centerY + (point.y - centerY) * ridge;
    point.z = point.z * ridge + 0.2 * Math.sin(angle * 3);
    positions.setXYZ(i, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xeb4c18,
    roughness: 0.38,
    metalness: 0.18,
  });
  const sculpture = new THREE.Mesh(geometry, material);
  sculpture.rotation.set(0.46, -0.48, -0.52);
  scene.add(sculpture);

  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const context = shadowCanvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, "rgba(78, 49, 23, 0.19)");
  gradient.addColorStop(0.5, "rgba(78, 49, 23, 0.07)");
  gradient.addColorStop(1, "rgba(78, 49, 23, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 1.1),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.position.set(0, -1.95, -1);
  scene.add(shadow);

  let frame = 0;
  let elapsed = 0;
  let previousTime = 0;
  let visible = true;
  let paused = reducedMotion.matches;
  let disposed = false;
  const target = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0 };
  const render = () => renderer.render(scene, camera);
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = camera.aspect < 0.8 ? 10.6 : 8.8;
    camera.updateProjectionMatrix();
    render();
  }
  function animate(time) {
    frame = 0;
    if (disposed || paused || !visible || document.hidden) return;
    elapsed += previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
    previousTime = time;
    pointer.x += (target.x - pointer.x) * 0.035;
    pointer.y += (target.y - pointer.y) * 0.035;
    sculpture.rotation.x =
      0.46 + Math.sin(elapsed * 0.27) * 0.13 + pointer.y * 0.17;
    sculpture.rotation.y =
      -0.48 + Math.sin(elapsed * 0.2) * 0.26 + pointer.x * 0.23;
    sculpture.rotation.z = -0.52 + elapsed * 0.055;
    sculpture.position.y = Math.sin(elapsed * 0.75) * 0.08;
    render();
    frame = requestAnimationFrame(animate);
  }
  function syncAnimation() {
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
    if (!disposed && !paused && visible && !document.hidden)
      frame = requestAnimationFrame(animate);
  }
  function updateToggle() {
    toggle.setAttribute("aria-pressed", String(paused));
    toggle.setAttribute(
      "aria-label",
      paused ? "Play 3D animation" : "Pause 3D animation",
    );
    toggle.firstElementChild.textContent = paused ? "▷" : "Ⅱ";
  }
  const onPointerMove = (event) => {
    if (paused || event.pointerType === "touch") return;
    const bounds = host.getBoundingClientRect();
    target.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    target.y = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
  };
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerleave", () => {
    target.x = 0;
    target.y = 0;
  });
  toggle.addEventListener("click", () => {
    paused = !paused;
    updateToggle();
    syncAnimation();
  });
  reducedMotion.addEventListener("change", () => {
    paused = reducedMotion.matches;
    updateToggle();
    syncAnimation();
  });
  document.addEventListener("visibilitychange", syncAnimation);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const visibilityObserver = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    syncAnimation();
  });
  visibilityObserver.observe(host);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    paused = true;
    syncAnimation();
    host.classList.remove("scene-ready");
    toggle.hidden = true;
  });
  resize();
  host.classList.add("scene-ready");
  toggle.hidden = false;
  updateToggle();
  syncAnimation();
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    geometry.dispose();
    material.dispose();
    shadow.geometry.dispose();
    shadow.material.dispose();
    shadowTexture.dispose();
    renderer.dispose();
  });
}
