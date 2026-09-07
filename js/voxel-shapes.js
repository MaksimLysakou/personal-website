/**
 * Voxel models for the hero scene.
 *
 * Coordinates: x → right, y → up, z → toward the viewer; one unit is one cube.
 * Every model is described procedurally, then cubes that are fully enclosed by
 * neighbours are dropped so each cube in the pool ends up on a visible surface.
 */
export const PALETTE = {
  o: 0xed5b32, // brand orange
  O: 0xc4421d, // deep orange
  p: 0xf6a385, // pale orange
  a: 0xf2b544, // amber
  c: 0xe9e4d5, // cream
  k: 0x2a2926, // ink
  g: 0x8d8b83, // grey
};

class Voxels {
  constructor() {
    this.cells = new Map();
  }
  key(x, y, z) {
    return x + "," + y + "," + z;
  }
  has(x, y, z) {
    return this.cells.has(this.key(x, y, z));
  }
  set(x, y, z, color) {
    this.cells.set(this.key(x, y, z), { x, y, z, color });
  }
  unset(x, y, z) {
    this.cells.delete(this.key(x, y, z));
  }
  paint(x, y, z, color) {
    const cell = this.cells.get(this.key(x, y, z));
    if (cell) cell.color = color;
  }
  /** Recolour the cube nearest to the viewer in a column (details on curved surfaces). */
  paintFront(x, y, color) {
    for (let z = 32; z >= -32; z--) {
      if (this.has(x, y, z)) {
        this.paint(x, y, z, color);
        return;
      }
    }
  }
  each(x0, y0, z0, x1, y1, z1, fn) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) fn(x, y, z);
  }
  box(x0, y0, z0, x1, y1, z1, color) {
    this.each(x0, y0, z0, x1, y1, z1, (x, y, z) => this.set(x, y, z, color));
  }
  clear(x0, y0, z0, x1, y1, z1) {
    this.each(x0, y0, z0, x1, y1, z1, (x, y, z) => this.unset(x, y, z));
  }
  paintBox(x0, y0, z0, x1, y1, z1, color) {
    this.each(x0, y0, z0, x1, y1, z1, (x, y, z) => this.paint(x, y, z, color));
  }
  ellipsoid(cx, cy, cz, rx, ry, rz, color) {
    for (let x = Math.ceil(cx - rx); x <= Math.floor(cx + rx); x++)
      for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y++)
        for (let z = Math.ceil(cz - rz); z <= Math.floor(cz + rz); z++) {
          const d =
            ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
          if (d <= 1) this.set(x, y, z, color);
        }
  }
  eachDisc(cx, cz, radius, y0, y1, fn) {
    const r2 = radius * radius;
    for (let x = Math.ceil(cx - radius); x <= Math.floor(cx + radius); x++)
      for (let z = Math.ceil(cz - radius); z <= Math.floor(cz + radius); z++) {
        if ((x - cx) ** 2 + (z - cz) ** 2 > r2) continue;
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) fn(x, y, z);
      }
  }
  /** Vertical cylinder with its axis along y. */
  cylinder(cx, cz, radius, y0, y1, color) {
    this.eachDisc(cx, cz, radius, y0, y1, (x, y, z) => this.set(x, y, z, color));
  }
  clearCylinder(cx, cz, radius, y0, y1) {
    this.eachDisc(cx, cz, radius, y0, y1, (x, y, z) => this.unset(x, y, z));
  }
  paintCylinder(cx, cz, radius, y0, y1, color) {
    this.eachDisc(cx, cz, radius, y0, y1, (x, y, z) => this.paint(x, y, z, color));
  }
  /** Disc in the x/y plane extruded along z (wheels). */
  wheel(cx, cy, z0, z1, radius, color) {
    const r2 = radius * radius;
    for (let x = Math.ceil(cx - radius); x <= Math.floor(cx + radius); x++)
      for (let y = Math.ceil(cy - radius); y <= Math.floor(cy + radius); y++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
          this.set(x, y, z, color);
      }
  }
  /** Extrude a pixel sprite (array of strings, top row first) along z. */
  sprite(rows, z0, z1, colors, scale = 1) {
    const height = rows.length;
    rows.forEach((row, r) => {
      [...row].forEach((char, c) => {
        const color = colors[char];
        if (!color) return;
        for (let dx = 0; dx < scale; dx++)
          for (let dy = 0; dy < scale; dy++)
            for (let z = z0; z <= z1; z++)
              this.set(c * scale + dx, (height - 1 - r) * scale + dy, z, color);
      });
    });
  }
}

const INVADER = [
  "..o.....o..",
  "...o...o...",
  "..ooooooo..",
  ".ookoookoo.",
  "ooooooooooo",
  "o.ooooooo.o",
  "o.o.....o.o",
  "...oo.oo...",
];

const MODELS = [
  {
    name: "duck",
    build(v) {
      v.ellipsoid(5, 3, 0, 6.6, 3.4, 4.3, "a"); // body
      // tail feathers, rising towards the back
      for (const [x, y] of [[-2, 4], [-2, 5], [-3, 5], [-3, 6], [-4, 6], [-4, 7]])
        v.set(x, y, 0, "a");
      for (const [x, y] of [[-2, 4], [-2, 5], [-3, 5]]) {
        v.set(x, y, -1, "a");
        v.set(x, y, 1, "a");
      }
      v.ellipsoid(8.5, 8.5, 0, 3.6, 3.4, 3.6, "a"); // head
      v.box(12, 9, -1, 14, 9, 1, "o"); // upper bill
      v.box(12, 8, -1, 13, 8, 1, "O"); // lower bill
      v.paint(10, 10, 2, "k"); // eyes
      v.paint(10, 10, -2, "k");
      v.paintBox(2, 2, 4, 6, 4, 4, "o"); // wings
      v.paintBox(2, 2, -4, 6, 4, -4, "o");
    },
  },
  {
    name: "car",
    build(v) {
      v.box(0, 2, -3, 15, 4, 3, "o"); // body
      v.box(1, 1, -2, 14, 1, 2, "O"); // underbody
      v.box(4, 5, -2, 11, 6, 2, "o"); // cabin
      v.box(5, 7, -2, 10, 7, 2, "O"); // roof
      v.paintBox(5, 5, 2, 6, 6, 2, "c"); // side windows
      v.paintBox(8, 5, 2, 10, 6, 2, "c");
      v.paintBox(5, 5, -2, 6, 6, -2, "c");
      v.paintBox(8, 5, -2, 10, 6, -2, "c");
      v.paintBox(11, 5, -1, 11, 6, 1, "c"); // windscreen
      v.paintBox(4, 5, -1, 4, 6, 1, "c"); // rear window
      for (const cx of [3, 12]) {
        v.wheel(cx, 1.5, -4, -3, 2.3, "k");
        v.wheel(cx, 1.5, 3, 4, 2.3, "k");
        for (const z of [-4, 4]) {
          v.paint(cx, 1, z, "g"); // hub caps
          v.paint(cx, 2, z, "g");
        }
      }
      v.paintBox(15, 2, -3, 15, 2, 3, "k"); // bumpers
      v.paintBox(0, 2, -3, 0, 2, 3, "k");
      v.paintBox(15, 3, -3, 15, 3, -2, "a"); // headlights
      v.paintBox(15, 3, 2, 15, 3, 3, "a");
      v.paintBox(0, 3, -3, 0, 3, -2, "O"); // tail lights
      v.paintBox(0, 3, 2, 0, 3, 3, "O");
      v.paintBox(15, 3, -1, 15, 3, 1, "k"); // grille
    },
  },
  {
    name: "house",
    build(v) {
      v.box(0, 0, 0, 11, 6, 9, "c"); // walls
      for (let i = 0; i <= 5; i++) {
        // gabled roof: each layer is a slab with an orange rim and cream gable inside
        const y = 7 + i;
        const z0 = i - 1;
        const z1 = 10 - i;
        for (let x = -1; x <= 12; x++)
          for (let z = z0; z <= z1; z++) {
            const rim = z === z0 || z === z1;
            if ((x === -1 || x === 12) && !rim) continue;
            v.set(x, y, z, rim ? "o" : "c");
          }
      }
      v.box(5, 0, 9, 6, 3, 9, "O"); // door
      v.paint(6, 1, 9, "a"); // door knob
      v.box(5, 0, 10, 6, 0, 10, "g"); // door step
      v.paintBox(2, 3, 9, 3, 4, 9, "k"); // front windows
      v.paintBox(8, 3, 9, 9, 4, 9, "k");
      v.paintBox(3, 3, 0, 4, 4, 0, "k"); // back windows
      v.paintBox(7, 3, 0, 8, 4, 0, "k");
      for (const x of [0, 11]) {
        v.paintBox(x, 3, 2, x, 4, 3, "k"); // side windows
        v.paintBox(x, 3, 6, x, 4, 7, "k");
      }
      v.box(9, 9, 2, 10, 12, 3, "g"); // chimney
      v.box(9, 13, 2, 10, 13, 3, "k");
    },
  },
  {
    name: "rocket",
    build(v) {
      v.cylinder(0, 0, 3.6, 3, 13, "c"); // hull
      for (let y = 14; y <= 18; y++)
        v.cylinder(0, 0, 3.6 - (y - 13) * 0.68, y, y, "o"); // nose cone
      v.paintCylinder(0, 0, 3.6, 7, 8, "O"); // stripe
      v.paintCylinder(0, 0, 3.6, 13, 13, "o");
      for (let y = 1; y <= 6; y++) {
        const extent = Math.floor(3.4 + (6.4 - y) * 0.85);
        for (let d = 3; d <= extent; d++) {
          v.set(d, y, 0, "o"); // four fins
          v.set(-d, y, 0, "o");
          v.set(0, y, d, "o");
          v.set(0, y, -d, "o");
        }
      }
      v.cylinder(0, 0, 2.4, 1, 2, "g"); // nozzle
      v.cylinder(0, 0, 1.6, -1, 0, "a"); // flame
      v.set(0, -2, 0, "o");
      v.paintBox(-1, 9, 3, 1, 11, 3, "g"); // porthole frame
      v.paint(0, 10, 3, "k");
    },
  },
  {
    name: "robot",
    build(v) {
      v.box(-3, 0, -1, -1, 3, 1, "g"); // legs
      v.box(1, 0, -1, 3, 3, 1, "g");
      v.box(-3, 0, -1, -1, 0, 2, "k"); // feet
      v.box(1, 0, -1, 3, 0, 2, "k");
      v.box(-4, 4, -2, 4, 10, 2, "o"); // torso
      v.paintBox(-2, 6, 2, 2, 9, 2, "c"); // chest panel
      v.paint(-1, 7, 2, "k");
      v.paint(1, 7, 2, "k");
      v.paint(0, 9, 2, "a");
      v.box(-6, 5, -1, -5, 10, 0, "g"); // arms
      v.box(5, 5, -1, 6, 10, 0, "g");
      v.box(-6, 3, -1, -5, 4, 0, "k"); // hands
      v.box(5, 3, -1, 6, 4, 0, "k");
      v.box(-1, 11, -1, 1, 11, 0, "g"); // neck
      v.box(-3, 12, -2, 3, 17, 2, "k"); // head
      v.paintBox(-2, 13, 2, 2, 16, 2, "c"); // face plate
      v.paintBox(-2, 15, 2, -1, 15, 2, "o"); // eyes
      v.paintBox(1, 15, 2, 2, 15, 2, "o");
      v.paintBox(-1, 13, 2, 1, 13, 2, "g"); // mouth
      v.box(-4, 14, 0, -4, 15, 0, "o"); // ears
      v.box(4, 14, 0, 4, 15, 0, "o");
      v.set(0, 18, 0, "g"); // antenna
      v.set(0, 19, 0, "a");
    },
  },
  {
    name: "mug",
    build(v) {
      v.cylinder(0, 0, 5.4, 0, 10, "c"); // body
      v.cylinder(0, 0, 4.2, 2, 8, "k"); // coffee (the top layer stays visible)
      v.clearCylinder(0, 0, 4.2, 9, 10);
      v.paintCylinder(0, 0, 5.4, 4, 5, "o"); // stripe
      for (let z = -1; z <= 1; z++) {
        v.box(8, 3, z, 8, 8, z, "c"); // handle
        v.box(6, 3, z, 7, 3, z, "c");
        v.box(6, 8, z, 7, 8, z, "c");
      }
      for (const [x, y, z] of [[-2, 12, 1], [-2, 13, 1], [-1, 14, 1], [1, 12, -1], [2, 13, -1], [2, 14, -1]])
        v.set(x, y, z, "g"); // steam
    },
  },
  {
    name: "heart",
    build(v) {
      const s = 6.5;
      const cells = [];
      const perLayer = {};
      for (let x = -9; x <= 9; x++)
        for (let y = -8; y <= 9; y++)
          for (let z = -6; z <= 6; z++) {
            const X = x / s;
            const Y = y / s;
            const Z = z / s;
            const f =
              (X * X + 2.25 * Z * Z + Y * Y - 1) ** 3 -
              X * X * Y ** 3 -
              0.1125 * Z * Z * Y ** 3;
            if (f > 0) continue;
            cells.push([x, y, z]);
            perLayer[y] = (perLayer[y] || 0) + 1;
          }
      // Skip the lone cubes the sampling leaves on top of the two lobes.
      for (const [x, y, z] of cells)
        if (!(y > 0 && perLayer[y] <= 2)) v.set(x, y, z, "o");
      for (const [x, y] of [[-4, 4], [-3, 5], [-4, 5], [-3, 4]]) v.paintFront(x, y, "p");
    },
  },
  {
    name: "invader",
    build(v) {
      v.sprite(INVADER, -1, 1, { o: "o", k: "k" }, 2);
    },
  },
];

function buildShape(model) {
  const v = new Voxels();
  model.build(v);
  const cells = [...v.cells.values()];
  const visible = cells.filter(
    ({ x, y, z }) =>
      !(
        v.has(x + 1, y, z) &&
        v.has(x - 1, y, z) &&
        v.has(x, y + 1, z) &&
        v.has(x, y - 1, z) &&
        v.has(x, y, z + 1) &&
        v.has(x, y, z - 1)
      ),
  );
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const cell of cells)
    for (const axis of "xyz") {
      min[axis] = Math.min(min[axis], cell[axis]);
      max[axis] = Math.max(max[axis], cell[axis]);
    }
  const center = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
  return {
    name: model.name,
    size: { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 },
    voxels: visible.map((cell) => ({
      x: cell.x - center.x,
      y: cell.y - center.y,
      z: cell.z - center.z,
      color: cell.color,
    })),
  };
}

export const SHAPES = MODELS.map(buildShape);
