// Görsel ayrıştırma: büyütülmüş araç modelleri üst üste binmesin diye çizim konumlarını
// birbirinden iter. Gerçek konumlar (store) değişmez; yalnızca XZ düzleminde çizim ofseti.

/**
 * items: [{ x, z, r }] (r = modelin yarıçapı, sahne birimi). `out` içine ayrışmış x/z
 * yazılır. Aynı girdi her zaman aynı sonucu verir; kare kare titreme olmaz.
 */
export function separate(items, out = items.map(() => ({ x: 0, z: 0 })), iterations = 4) {
  for (let i = 0; i < items.length; i++) { out[i].x = items[i].x; out[i].z = items[i].z; }
  for (let pass = 0; pass < iterations; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const minimum = items[i].r + items[j].r;
        let dx = out[j].x - out[i].x;
        let dz = out[j].z - out[i].z;
        if (Math.abs(dx) >= minimum || Math.abs(dz) >= minimum) continue;
        let distance = Math.hypot(dx, dz);
        if (distance >= minimum) continue;
        if (distance < 1e-6) { // Tam çakışma: sıraya bağlı sabit bir yön seç.
          const angle = (i * 2.399963 + j) % (Math.PI * 2);
          dx = Math.cos(angle); dz = Math.sin(angle); distance = 1;
        }
        const push = (minimum - distance) / 2 / distance;
        out[i].x -= dx * push; out[i].z -= dz * push;
        out[j].x += dx * push; out[j].z += dz * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}
