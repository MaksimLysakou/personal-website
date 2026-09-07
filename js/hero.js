import * as THREE from "./vendor/three.module.min.js";
import { PALETTE, SHAPES } from "./voxel-shapes.js";

// The hero sculpture is a pool of small cubes that assemble into voxel figures.
// Clicking a figure blows it apart; the loose cubes then fly to their places in
// the next figure. Dragging spins the figure, hovering tilts it.
const CELL = 0.2; // world size of one voxel cell
const CUBE = CELL * 0.96; // cube size, leaving a hairline gap between cells
const SWAY = 0.32; // idle yaw sway amplitude, rad
const AIR_DRAG = 2.1; // slows loose cubes, 1/s
const GRAVITY = 3.4; // pulls loose cubes down, units/s²
const REBUILD_COOLDOWN = 0.8; // seconds between two explosions
const IDENTITY = new THREE.Quaternion();

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const random = (min, max) => min + Math.random() * (max - min);

// Cubic Hermite curve: leaves `from` along `tangent`, arrives at `to` along `arrival`.
function hermite(out, from, tangent, to, arrival, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  out.x = h00 * from.x + h10 * tangent.x + h01 * to.x + h11 * arrival.x;
  out.y = h00 * from.y + h10 * tangent.y + h01 * to.y + h11 * arrival.y;
  out.z = h00 * from.z + h10 * tangent.z + h01 * to.z + h11 * arrival.z;
  return out;
}

function makeFaceTexture(renderer) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.lineWidth = 10;
  context.strokeStyle = "rgba(0, 0, 0, 0.08)";
  context.strokeRect(0, 0, size, size);
  context.lineWidth = 4;
  context.strokeStyle = "rgba(0, 0, 0, 0.16)";
  context.strokeRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function makeShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(128, 32, 2, 128, 32, 128);
  gradient.addColorStop(0, "rgba(78, 49, 23, 0.22)");
  gradient.addColorStop(0.45, "rgba(78, 49, 23, 0.08)");
  gradient.addColorStop(1, "rgba(78, 49, 23, 0)");
  context.scale(1, 0.25);
  context.translate(0, 96);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

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
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
  camera.position.set(0, 1.3, 8.8);
  camera.lookAt(0, -0.1, 0);
  scene.add(new THREE.HemisphereLight(0xfff6e7, 0x8a5a48, 1.5));
  const key = new THREE.DirectionalLight(0xfff5e2, 2.6);
  key.position.set(-3, 5, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff9b5e, 1.2);
  rim.position.set(4, 1, -2);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(2, -1, 4);
  scene.add(fill);

  // Figures: cube targets in pivot space, sorted bottom-up for the build order.
  const colors = Object.fromEntries(
    Object.entries(PALETTE).map(([key, hex]) => [key, new THREE.Color(hex)]),
  );
  const shapes = SHAPES.map((shape) => {
    const targets = shape.voxels.map((voxel) => ({
      position: new THREE.Vector3(voxel.x, voxel.y, voxel.z).multiplyScalar(CELL),
      color: colors[voxel.color],
      order: 0,
    }));
    targets
      .map((target) => ({ target, key: target.position.y + random(-0.7, 0.7) * CELL }))
      .sort((a, b) => a.key - b.key)
      .forEach(({ target }, rank) => {
        target.order = rank / Math.max(1, targets.length - 1);
      });
    const width = shape.size.x * CELL;
    const height = shape.size.y * CELL;
    const depth = shape.size.z * CELL;
    return {
      name: shape.name,
      targets,
      width,
      height,
      radius: 0.5 * Math.hypot(width, height, depth),
    };
  });
  const poolSize = Math.max(...shapes.map((shape) => shape.targets.length));
  const cubes = Array.from({ length: poolSize }, () => ({
    mode: "hidden", // hidden | drift | fly | idle | leave
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    axis: new THREE.Vector3(0, 1, 0),
    spin: 0,
    scale: 0,
    target: null,
    color: colors.o,
    taken: false,
    homeAt: 0,
    flyStart: 0,
    flyDuration: 1,
    from: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    arrival: new THREE.Vector3(),
    fromQuaternion: new THREE.Quaternion(),
    fromScale: 0,
    leaveAt: 0,
  }));

  const faceTexture = makeFaceTexture(renderer);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    map: faceTexture,
    roughness: 0.62,
    metalness: 0.04,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, poolSize);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const pivot = new THREE.Group();
  pivot.add(mesh);
  scene.add(pivot);

  const shadowTexture = makeShadowTexture();
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMaterial);
  shadow.position.z = -0.6;
  scene.add(shadow);

  const matrix = new THREE.Matrix4();
  const scaleVector = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const scratchQuaternion = new THREE.Quaternion();
  const gravityLocal = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const impactPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hitSphere = new THREE.Sphere();

  function writeCube(index, cube) {
    scaleVector.setScalar(cube.scale);
    matrix.compose(cube.position, cube.quaternion, scaleVector);
    mesh.setMatrixAt(index, matrix);
  }
  cubes.forEach((cube, index) => {
    writeCube(index, cube);
    mesh.setColorAt(index, cube.color);
  });

  let shapeIndex = -1;
  let busy = false;
  let settled = 0;
  let lastRebuild = -Infinity;
  let elapsed = 0;

  function spawn(cube) {
    // New cubes arrive from far outside the frame.
    const angle = random(0, Math.PI * 2);
    const distance = random(5.5, 7.5);
    cube.position.set(
      Math.cos(angle) * distance,
      random(-2.5, 3.5),
      Math.sin(angle) * distance * 0.55 - 0.5,
    );
    cube.velocity
      .copy(cube.position)
      .multiplyScalar(-0.35)
      .add(scratch.randomDirection().multiplyScalar(random(0, 0.8)));
    cube.quaternion.random();
    cube.axis.randomDirection();
    cube.spin = random(2, 6);
    cube.scale = 0;
    cube.mode = "drift";
  }

  function beginFlight(index, cube) {
    cube.mode = "fly";
    cube.flyStart = elapsed;
    cube.from.copy(cube.position);
    cube.fromQuaternion.copy(cube.quaternion);
    cube.fromScale = cube.scale;
    cube.tangent.copy(cube.velocity).multiplyScalar(cube.flyDuration * 0.7);
    if (cube.tangent.lengthSq() > 1.6 * 1.6) cube.tangent.setLength(1.6);
    // Approach the final spot from outside the figure.
    cube.arrival.copy(cube.target);
    if (cube.arrival.lengthSq() < 1e-4) cube.arrival.set(0, 1, 0);
    cube.arrival.setLength(-0.5);
    mesh.setColorAt(index, cube.color);
    mesh.instanceColor.needsUpdate = true;
  }

  function drift(cube, dt) {
    cube.velocity.addScaledVector(gravityLocal, dt);
    cube.velocity.multiplyScalar(Math.exp(-AIR_DRAG * dt));
    cube.position.addScaledVector(cube.velocity, dt);
    if (cube.spin > 0.01) {
      scratchQuaternion.setFromAxisAngle(cube.axis, cube.spin * dt);
      cube.quaternion.premultiply(scratchQuaternion);
      cube.spin *= Math.exp(-1.2 * dt);
    }
  }

  function updateCubes(dt) {
    gravityLocal
      .set(0, -GRAVITY, 0)
      .applyQuaternion(scratchQuaternion.copy(pivot.quaternion).invert());
    let active = 0;
    settled = 0;
    cubes.forEach((cube, index) => {
      if (cube.mode === "hidden") return;
      if (cube.mode === "idle") {
        settled++;
        return;
      }
      active++;
      if (cube.mode === "drift") {
        drift(cube, dt);
        if (elapsed >= cube.homeAt) beginFlight(index, cube);
      }
      if (cube.mode === "fly") {
        const u = Math.min(1, (elapsed - cube.flyStart) / cube.flyDuration);
        if (u >= 1) {
          cube.position.copy(cube.target);
          cube.quaternion.identity();
          cube.velocity.set(0, 0, 0);
          cube.scale = CUBE;
          cube.mode = "idle";
        } else {
          hermite(cube.position, cube.from, cube.tangent, cube.target, cube.arrival, u);
          cube.quaternion.slerpQuaternions(cube.fromQuaternion, IDENTITY, easeInOutCubic(u));
          const grow = cube.fromScale + (CUBE - cube.fromScale) * easeOutCubic(Math.min(1, u * 1.5));
          const pop = u > 0.78 ? Math.sin(((u - 0.78) / 0.22) * Math.PI) * 0.25 * CUBE : 0;
          cube.scale = grow + pop;
        }
      } else if (cube.mode === "leave") {
        drift(cube, dt);
        if (elapsed >= cube.leaveAt) {
          const k = Math.min(1, (elapsed - cube.leaveAt) / 0.5);
          cube.scale = cube.fromScale * (1 - easeInOutCubic(k));
          if (k >= 1) {
            cube.mode = "hidden";
            cube.scale = 0;
          }
        }
      }
      writeCube(index, cube);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (!active) busy = false;
  }

  // Blow the current figure apart from `impact` (pivot space) and route every
  // cube to its place in the next figure.
  function rebuild(index, impact) {
    const shape = shapes[index];
    const loose = [];
    for (const cube of cubes) {
      if (cube.mode === "hidden") continue;
      scratch.copy(cube.position).sub(impact);
      const distance = scratch.length();
      if (distance < 1e-3) scratch.randomDirection();
      else scratch.divideScalar(distance);
      const speed = random(2.4, 4.6) + 1.2 / (0.5 + distance);
      cube.velocity.copy(scratch).multiplyScalar(speed);
      cube.velocity.x += random(-1.1, 1.1);
      cube.velocity.y += random(-0.3, 1.9);
      cube.velocity.z += random(-1.1, 1.1);
      cube.axis.randomDirection();
      cube.spin = random(3, 9);
      cube.fromScale = cube.scale;
      cube.mode = "drift";
      cube.target = null;
      loose.push(cube);
    }
    const firstBuild = loose.length === 0;
    const delay = firstBuild ? 0.15 : 0.5;
    const spread = firstBuild ? 1.4 : 0.9;
    let hiddenCursor = 0;
    for (const target of [...shape.targets].sort((a, b) => a.order - b.order)) {
      // Nearest loose cube takes the spot; new cubes are spawned when we run out.
      let best = null;
      let bestDistance = Infinity;
      for (const cube of loose) {
        if (cube.taken) continue;
        const distance = cube.position.distanceToSquared(target.position);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = cube;
        }
      }
      if (!best) {
        while (cubes[hiddenCursor].mode !== "hidden") hiddenCursor++;
        best = cubes[hiddenCursor];
        spawn(best);
      }
      best.taken = true;
      best.target = target.position;
      best.color = target.color;
      best.homeAt = elapsed + delay + target.order * spread + random(0, 0.25);
      best.flyDuration = random(0.9, 1.3);
    }
    for (const cube of loose) {
      if (cube.taken) continue;
      cube.mode = "leave";
      cube.leaveAt = elapsed + random(0.35, 0.9);
    }
    for (const cube of cubes) cube.taken = false;
    shapeIndex = index;
    host.dataset.shape = shape.name;
    busy = true;
    lastRebuild = elapsed;
  }

  // Static version for reduced motion: every cube sits in place at once.
  function snapTo(index) {
    const shape = shapes[index];
    cubes.forEach((cube, i) => {
      const target = shape.targets[i];
      if (target) {
        cube.position.copy(target.position);
        cube.color = target.color;
        cube.target = target.position;
        cube.scale = CUBE;
        cube.mode = "idle";
        mesh.setColorAt(i, cube.color);
      } else {
        cube.scale = 0;
        cube.mode = "hidden";
      }
      cube.quaternion.identity();
      cube.velocity.set(0, 0, 0);
      writeCube(i, cube);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    shapeIndex = index;
    host.dataset.shape = shape.name;
    settled = shape.targets.length;
    busy = false;
    placeShadow(1);
  }

  function placeShadow(rate) {
    const shape = shapes[shapeIndex];
    const assembled = settled / shape.targets.length;
    shadow.scale.x += (shape.width * 1.3 + 0.6 - shadow.scale.x) * rate;
    shadow.scale.y += (shape.width * 0.32 + 0.2 - shadow.scale.y) * rate;
    shadow.position.y +=
      (pivot.position.y - shape.height / 2 - 0.04 - shadow.position.y) * rate;
    shadowMaterial.opacity += (assembled * assembled - shadowMaterial.opacity) * rate;
  }

  let frame = 0;
  let previousTime = 0;
  let visible = true;
  let paused = reducedMotion.matches;
  let disposed = false;
  let spin = -0.55;
  let spinVelocity = 0;
  let pitch = 0;
  const hover = { x: 0, y: 0 };
  const hoverTarget = { x: 0, y: 0 };
  let drag = null;
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
    const dt = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
    previousTime = time;
    elapsed += dt;
    if (!drag?.moved) spin += spinVelocity * dt;
    spinVelocity *= Math.exp(-2.5 * dt);
    const follow = 1 - Math.exp(-5 * dt);
    hover.x += (hoverTarget.x - hover.x) * follow;
    hover.y += (hoverTarget.y - hover.y) * follow;
    // The figure keeps facing the viewer and gently sways; dragging turns it freely.
    pivot.rotation.set(
      pitch + hover.y * 0.18 + Math.sin(elapsed * 0.27) * 0.04,
      spin + Math.sin(elapsed * 0.42) * SWAY + hover.x * 0.45,
      0,
    );
    pivot.position.y = Math.sin(elapsed * 0.9) * 0.06;
    pivot.updateMatrixWorld();
    if (busy) updateCubes(dt);
    placeShadow(1 - Math.exp(-6 * dt));
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

  function pointerRay(event) {
    const bounds = host.getBoundingClientRect();
    pointerNdc.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointerNdc, camera);
    return raycaster.ray;
  }
  function overFigure(event) {
    hitSphere.center.copy(pivot.position);
    hitSphere.radius = shapes[shapeIndex].radius * 0.9 + 0.15;
    return pointerRay(event).intersectsSphere(hitSphere);
  }
  function explodeAt(event) {
    const next = (shapeIndex + 1) % shapes.length;
    if (paused) {
      snapTo(next);
      render();
      return;
    }
    if (elapsed - lastRebuild < REBUILD_COOLDOWN) return;
    const impact = new THREE.Vector3();
    if (!pointerRay(event).intersectPlane(impactPlane, impact)) impact.set(0, 0, 0);
    pivot.worldToLocal(impact);
    spinVelocity += pointerNdc.x * 1.4;
    rebuild(next, impact);
  }

  const onPointerMove = (event) => {
    if (drag && event.pointerId === drag.pointerId) {
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
        drag.moved = true;
        host.classList.add("is-dragging");
      }
      if (drag.moved) {
        const dx = event.clientX - drag.lastX;
        const dy = event.clientY - drag.lastY;
        spin += dx * 0.012;
        pitch = THREE.MathUtils.clamp(pitch + dy * 0.008, -0.7, 0.7);
        const now = performance.now();
        const seconds = Math.max(0.008, (now - drag.lastTime) / 1000);
        drag.velocity = drag.velocity * 0.4 + ((dx * 0.012) / seconds) * 0.6;
        drag.lastTime = now;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        if (!paused) return;
        pivot.rotation.set(pitch, spin, 0);
        render();
      }
      return;
    }
    if (event.pointerType === "touch") return;
    const over = overFigure(event);
    host.classList.toggle("is-over-figure", over);
    if (paused) return;
    const bounds = host.getBoundingClientRect();
    hoverTarget.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    hoverTarget.y = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
  };
  const onPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest("button") || drag) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocity: 0,
      moved: false,
    };
    try {
      host.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; dragging still works inside the host.
    }
  };
  const endDrag = (event, cancelled) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { moved, velocity } = drag;
    drag = null;
    host.classList.remove("is-dragging");
    if (moved) spinVelocity = THREE.MathUtils.clamp(velocity, -6, 6);
    else if (!cancelled && overFigure(event)) explodeAt(event);
  };
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointerup", (event) => endDrag(event, false));
  host.addEventListener("pointercancel", (event) => endDrag(event, true));
  host.addEventListener("pointerleave", () => {
    hoverTarget.x = 0;
    hoverTarget.y = 0;
    host.classList.remove("is-over-figure");
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

  pivot.rotation.set(pitch, spin, 0);
  pivot.updateMatrixWorld();
  if (paused) snapTo(0);
  else rebuild(0, new THREE.Vector3());
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
    faceTexture.dispose();
    shadow.geometry.dispose();
    shadowMaterial.dispose();
    shadowTexture.dispose();
    renderer.dispose();
  });
}
