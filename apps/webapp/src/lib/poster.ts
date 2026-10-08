import { MEDIA_MAX_BYTES } from '@church/shared';

/** Waits until every picture in the poster has loaded and decoded (or failed). */
export async function picturesReady(node: HTMLElement): Promise<void> {
  const imgs = [...node.querySelectorAll('img')];
  await Promise.all(
    imgs.map((img) =>
      (img.complete
        ? Promise.resolve()
        : new Promise((r) => img.addEventListener('load', r, { once: true }))
      )
        .then(() => img.decode?.())
        .catch(() => undefined),
    ),
  );
}

/**
 * A speaker photo as it shows on the poster — cropped like `object-fit: cover` to its box
 * (keeping the top, middle or bottom in view) and fading out towards the poster's middle —
 * as one canvas. Null when it can't be drawn.
 */
function fadedCopy(img: HTMLImageElement): HTMLCanvasElement | null {
  // The box in poster pixels (unscaled), drawn at twice that for a sharp picture.
  const bw = img.offsetWidth;
  const bh = img.offsetHeight;
  if (!bw || !bh) return null;
  const k = Math.min(2, 1400 / Math.max(bw, bh));
  const w = Math.round(bw * k);
  const h = Math.round(bh * k);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const fit = Math.max(bw / iw, bh / ih);
  const sw = bw / fit;
  const sh = bh / fit;
  const pos = img.dataset.pos;
  const sy = pos === 'top' ? 0 : pos === 'bottom' ? ih - sh : (ih - sh) / 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, (iw - sw) / 2, sy, sw, sh, 0, 0, w, h);
  // Keep the photo only where the fade lets it through (the same fade as on screen).
  ctx.globalCompositeOperation = 'destination-in';
  const side = img.dataset.fade;
  if (side === 'center') {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale((w / 2) * Math.SQRT2, (h / 2) * Math.SQRT2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0.4, '#000');
    g.addColorStop(0.72, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  } else {
    const g =
      side === 'left' ? ctx.createLinearGradient(0, 0, w, 0) : ctx.createLinearGradient(w, 0, 0, 0);
    g.addColorStop(0, '#000');
    g.addColorStop(0.45, '#000');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  return c;
}

/**
 * Whether a drawn poster came out blank (one flat colour, or black where its photo should
 * be — on iPhones a drawing can miss its pictures, and a JPEG turns the gaps black).
 */
async function looksBlank(dataUrl: string): Promise<boolean> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 24;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, 24, 24);
    const d = ctx.getImageData(0, 0, 24, 24).data;
    let min = 255;
    let max = 0;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (v < 14) dark++;
    }
    // One flat colour, or nearly all pitch black (a missing photo with only the title on it).
    return max - min < 12 || dark > 0.88 * (d.length / 4);
  } catch {
    return false;
  }
}

// ---------- Photos drawn by us (iPhones leave them out of the library's drawing) ----------

/** Where an element sits in the poster, in poster pixels (the poster may be shown scaled). */
export function boxIn(node: HTMLElement, el: Element) {
  const n = node.getBoundingClientRect();
  const k = n.width / (node.offsetWidth || n.width || 1) || 1;
  const r = el.getBoundingClientRect();
  return { x: (r.left - n.left) / k, y: (r.top - n.top) / k, w: r.width / k, h: r.height / k };
}

/** A CSS position ("50% 0%", "center top") as fractions across and down. */
function position(v: string): [number, number] {
  const part = (t: string | undefined) =>
    !t || t === 'center'
      ? 0.5
      : t === 'left' || t === 'top'
        ? 0
        : t === 'right' || t === 'bottom'
          ? 1
          : t.endsWith('%')
            ? Number.parseFloat(t) / 100
            : 0.5;
  const [a, b] = v.trim().split(/\s+/);
  return [part(a), part(b)];
}

/** A picture drawn into a box like CSS object-fit / object-position would show it. */
function drawFitted(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: string,
  pos: string,
) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih || w <= 0 || h <= 0) return;
  const [px, py] = position(pos);
  if (fit === 'contain') {
    const k = Math.min(w / iw, h / ih);
    const dw = iw * k;
    const dh = ih * k;
    ctx.drawImage(img, x + (w - dw) * px, y + (h - dh) * py, dw, dh);
  } else if (fit === 'cover') {
    const k = Math.max(w / iw, h / ih);
    const sw = w / k;
    const sh = h / k;
    ctx.drawImage(img, (iw - sw) * px, (ih - sh) * py, sw, sh, x, y, w, h);
  } else ctx.drawImage(img, x, y, w, h);
}

/** A CSS mask "linear-gradient(to right | 135deg, #000 a%, transparent b%)" kept on a box. */
function applyMask(ctx: CanvasRenderingContext2D, mask: string, w: number, h: number) {
  // The browser may rewrite the colours ("rgb(0, 0, 0)"): only the direction and stops count.
  const m = /linear-gradient\(\s*([^,]+),(.*)\)/.exec(mask);
  const stops = m ? [...m[2]!.matchAll(/([\d.]+)%/g)].map((x) => Number(x[1])) : [];
  if (!m || stops.length < 2) return;
  const dir = m[1]!.trim();
  const deg =
    dir === 'to right'
      ? 90
      : dir === 'to left'
        ? 270
        : dir === 'to bottom'
          ? 180
          : dir === 'to top'
            ? 0
            : Number.parseFloat(dir);
  const a = (deg * Math.PI) / 180;
  // The CSS gradient line: through the middle, long enough to reach the corners.
  const len = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
  const dx = (Math.sin(a) * len) / 2;
  const dy = (-Math.cos(a) * len) / 2;
  const g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
  g.addColorStop(Math.min(1, stops[0]! / 100), '#000');
  g.addColorStop(Math.min(1, stops[1]! / 100), 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * One marked photo drawn onto the poster picture: a picture (cropped and placed like CSS,
 * see-through, rounded) or a photo frame (a picture with colour layers over it and a fading
 * mask, like the ministry photo).
 */
export function drawShot(ctx: CanvasRenderingContext2D, node: HTMLElement, el: HTMLElement) {
  const box = boxIn(node, el);
  if (box.w <= 0 || box.h <= 0) return;
  const css = getComputedStyle(el);
  ctx.save();
  ctx.globalAlpha = Number(css.opacity) || 1;
  if (el instanceof HTMLImageElement) {
    if (!el.naturalWidth) return void ctx.restore();
    const faded = el.dataset.fade ? fadedCopy(el) : null;
    // Rounded pictures (speaker photos, the logo) keep their corners.
    const r = css.borderTopLeftRadius;
    const radius = r.endsWith('%')
      ? (Number.parseFloat(r) / 100) * Math.min(box.w, box.h)
      : Math.min(Number.parseFloat(r) || 0, Math.min(box.w, box.h) / 2);
    if (radius > 0) {
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, radius);
      ctx.clip();
    }
    if (faded) ctx.drawImage(faded, box.x, box.y, box.w, box.h);
    else {
      // Inside the padding (the logo sits on a white tile with a margin).
      const pl = Number.parseFloat(css.paddingLeft) || 0;
      const pt = Number.parseFloat(css.paddingTop) || 0;
      const pr = Number.parseFloat(css.paddingRight) || 0;
      const pb = Number.parseFloat(css.paddingBottom) || 0;
      drawFitted(
        ctx,
        el,
        box.x + pl,
        box.y + pt,
        box.w - pl - pr,
        box.h - pt - pb,
        css.objectFit,
        css.objectPosition,
      );
    }
    ctx.restore();
    return;
  }
  // A frame: its picture and colour layers on a canvas of its own, then its mask.
  const k = 2;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(box.w * k));
  c.height = Math.max(1, Math.round(box.h * k));
  const fc = c.getContext('2d')!;
  fc.scale(k, k);
  for (const child of [...el.children] as HTMLElement[]) {
    const cb = boxIn(node, child);
    const cc = getComputedStyle(child);
    if (child instanceof HTMLImageElement) {
      if (child.naturalWidth)
        drawFitted(
          fc,
          child,
          cb.x - box.x,
          cb.y - box.y,
          cb.w,
          cb.h,
          cc.objectFit,
          cc.objectPosition,
        );
    } else if (cc.backgroundColor && cc.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      fc.save();
      fc.globalAlpha = Number(cc.opacity) || 1;
      if (cc.mixBlendMode && cc.mixBlendMode !== 'normal')
        fc.globalCompositeOperation = cc.mixBlendMode as GlobalCompositeOperation;
      fc.fillStyle = cc.backgroundColor;
      fc.fillRect(cb.x - box.x, cb.y - box.y, cb.w, cb.h);
      fc.restore();
    }
  }
  const mask = el.style.maskImage || el.style.webkitMaskImage;
  if (mask) applyMask(fc, mask, box.w, box.h);
  ctx.drawImage(c, box.x, box.y, box.w, box.h);
  ctx.restore();
}

/** Hides elements for one drawing pass; returns how to show them again. */
function hide(els: HTMLElement[]): () => void {
  const before = els.map((e) => e.style.visibility);
  els.forEach((e) => (e.style.visibility = 'hidden'));
  return () => els.forEach((e, i) => (e.style.visibility = before[i]!));
}

/**
 * Gives a canvas's memory back at once. iPhones keep a dropped canvas's pixels until much
 * later and allow only so much canvas memory in all: a recording makes hundreds of
 * them, and the next recording got empty canvases (no photo, only effects).
 */
export function freeCanvas(c: HTMLCanvasElement | null | undefined) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

/**
 * The poster as one picture. Photos are not left to the drawing library (iPhones drop big
 * photos from it): it draws everything below the photos, the photos are drawn here, then
 * it draws everything above them on a see-through layer, and the small top photos (speaker
 * photos, the logo) are drawn last.
 */
async function compose(node: HTMLElement, pixelRatio: number, skipFonts: boolean) {
  const { toCanvas } = await import('html-to-image');
  const W = node.offsetWidth;
  const H = node.offsetHeight;
  const unders = [...node.querySelectorAll<HTMLElement>('[data-shot="under"]')];
  const tops = [...node.querySelectorAll<HTMLElement>('[data-shot="top"]')];
  // The poster itself may sit in a wrapper: its parts are the children of the first
  // element with more than one.
  let frame = node;
  const chain = [node];
  while (frame.children.length === 1) chain.push((frame = frame.children[0] as HTMLElement));
  const kids = [...frame.children] as HTMLElement[];
  // Everything after the last part holding an under-photo is "above" the photos.
  const last = kids.reduce((n, k, i) => (unders.some((u) => k === u || k.contains(u)) ? i : n), -1);
  const out = document.createElement('canvas');
  out.width = Math.round(W * pixelRatio);
  out.height = Math.round(H * pixelRatio);
  const ctx = out.getContext('2d')!;
  ctx.scale(pixelRatio, pixelRatio);
  const paint = async () => {
    const pic = await toCanvas(node, { pixelRatio, skipFonts });
    ctx.drawImage(pic, 0, 0, W, H);
    freeCanvas(pic);
  };
  if (last >= 0) {
    let show = hide([...kids.slice(last + 1), ...unders]);
    try {
      await paint();
    } finally {
      show();
    }
    for (const u of unders) drawShot(ctx, node, u);
    show = hide(kids.slice(0, last + 1));
    // See-through above the photos: the poster's own background was drawn below them.
    const bgs = chain.map((e) => e.style.background);
    chain.forEach((e) => (e.style.background = 'none'));
    try {
      await paint();
    } finally {
      show();
      chain.forEach((e, i) => (e.style.background = bgs[i]!));
    }
  } else await paint();
  for (const t of tops) drawShot(ctx, node, t);
  return out;
}

/**
 * Draws a rendered cover as a JPEG small enough to upload (the bot sends it as a picture).
 * Lowers the size and quality until it fits; null when it can't be drawn — or comes out
 * blank, so the bot sends the cover photo instead of a black square.
 */
export async function capturePoster(node: HTMLElement, sharp = false): Promise<Blob | null> {
  try {
    const { toJpeg } = await import('html-to-image');
    await picturesReady(node);
    // Moving effects stay out of the still picture: those blending with what is under them
    // (smoke, light leaks…) can't be drawn into it and would come out as black patches.
    node.classList.add('capturing');
    const attempts = [
      ...(sharp
        ? ([
            [2, 0.88],
            [2, 0.72],
          ] as const)
        : []),
      [1.5, 0.85],
      [1.5, 0.7],
      [1, 0.7],
      [1, 0.5],
    ] as const;
    for (const skipFonts of [false, true]) {
      try {
        // A first small drawing loads the fonts and pictures into the copy; thrown away.
        await toJpeg(node, { pixelRatio: 0.25, quality: 0.3, skipFonts }).catch(() => undefined);
        for (const [pixelRatio, quality] of attempts) {
          const canvas = await compose(node, pixelRatio, skipFonts);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          freeCanvas(canvas);
          // Blank = no poster rather than a black one.
          if (await looksBlank(dataUrl)) return null;
          const blob = await (await fetch(dataUrl)).blob();
          if (blob.size <= MEDIA_MAX_BYTES) return blob;
        }
        return null;
      } catch {
        // Embedding the fonts failed: try again without them.
      }
    }
  } catch {
    // No poster is better than no save.
  } finally {
    node.classList.remove('capturing');
  }
  return null;
}
