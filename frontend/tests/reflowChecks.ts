import type { Page } from "@playwright/test";

// WCAG 1.4.12 text-spacing overrides, applied on top of the page's own CSS.
export const TEXT_SPACING = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

// WCAG 1.4.10: the page itself must not scroll sideways.
export async function measureOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      viewport: window.innerWidth,
      root: root.scrollWidth,
      body: body.scrollWidth,
    };
  });
}

// Visible text inside a box that hides its overflow must fit that box.
// Intentional truncation (ellipsis) and aria-hidden copies are skipped, and so
// are boxes that scroll on purpose (overflow-x auto/scroll).
export async function findClippedText(page: Page) {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const element of document.querySelectorAll(
      "p, h1, h2, h3, li, a, button, span",
    )) {
      const style = getComputedStyle(element);
      if (style.overflowX === "visible") continue;
      if (style.overflowX === "auto" || style.overflowX === "scroll") continue;
      if (element.closest('[aria-hidden="true"]')) continue;
      if (element.classList.contains("truncate")) continue;
      if (style.textOverflow === "ellipsis") continue;
      if ((element.textContent ?? "").trim().length < 3) continue;
      if (element.clientWidth < 2) continue;
      if (element.scrollWidth > element.clientWidth + 2) {
        found.push(
          `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)} "${(element.textContent ?? "").trim().slice(0, 30)}" ${element.scrollWidth}>${element.clientWidth} ov=${style.overflowX}`,
        );
      }
    }
    return found.slice(0, 5);
  });
}

// Visible text must not be painted over, by other text or by another box.
// - Text against text: each text node's line boxes are compared with every
//   other node's; a pair counts when they share more than 4 px both ways.
// - Text against boxes: inside the viewport, three points on each line box
//   are hit-tested; a hit on a shown element that fills that point (a
//   background, a backdrop blur, an image, a canvas or an SVG) and is neither
//   the text's own element nor its ancestor counts as covered.
// Both compare things in the same layer only: the page flow, or one
// position: fixed layer (the header, the dock, a toast). A fixed layer over
// flowing content is a deliberate overlay the page scrolls under. Text that
// is not painted (hidden, transparent, aria-hidden, a closed <details> body,
// clipped to 1 px for screen readers) and SVG text are skipped; so is text
// with pointer-events: none in the second check.
export async function findOverlappingText(page: Page) {
  return page.evaluate(() => {
    type Box = {
      left: number;
      right: number;
      top: number;
      bottom: number;
      owner: Element;
      layer: Element | null;
      label: string;
    };
    const styles = new Map<Element, CSSStyleDeclaration>();
    const styleOf = (element: Element) => {
      let style = styles.get(element);
      if (!style) {
        style = getComputedStyle(element);
        styles.set(element, style);
      }
      return style;
    };
    const layers = new Map<Element, Element | null>();
    const layerOf = (element: Element): Element | null => {
      if (layers.has(element)) return layers.get(element) ?? null;
      const layer =
        styleOf(element).position === "fixed"
          ? element
          : element.parentElement
            ? layerOf(element.parentElement)
            : null;
      layers.set(element, layer);
      return layer;
    };
    const painted = (element: Element) => {
      if (
        !element.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        })
      ) {
        return false;
      }
      for (
        let node: Element | null = element;
        node && node !== document.documentElement;
        node = node.parentElement
      ) {
        const style = styleOf(node);
        if (node.getAttribute("aria-hidden") === "true") return false;
        const rect = node.getBoundingClientRect();
        if (
          (style.position === "absolute" || style.position === "fixed") &&
          rect.width <= 1 &&
          rect.height <= 1
        ) {
          return false;
        }
        if (style.clip === "rect(0px, 0px, 0px, 0px)") return false;
        if (style.clipPath === "inset(50%)") return false;
      }
      return true;
    };
    // The part of the viewport where an element can show: inside every
    // ancestor that clips its overflow.
    const clipOf = (element: Element) => {
      let left = 0;
      let top = 0;
      let right = window.innerWidth;
      let bottom = window.innerHeight;
      for (
        let node = element.parentElement;
        node && node !== document.documentElement;
        node = node.parentElement
      ) {
        const style = styleOf(node);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
          const rect = node.getBoundingClientRect();
          left = Math.max(left, rect.left);
          top = Math.max(top, rect.top);
          right = Math.min(right, rect.right);
          bottom = Math.min(bottom, rect.bottom);
        }
        if (style.position === "fixed") break;
      }
      return { left, top, right, bottom };
    };
    // Whether an element visibly paints at a point: it is shown, the point is
    // inside its own box (a stretched link's transparent ::after is not), and
    // it has a fill (a background, a blur, an image, a canvas or an SVG).
    const paintsAt = (element: Element, x: number, y: number) => {
      if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        return false;
      }
      if (
        element.closest("svg") ||
        ["IMG", "CANVAS", "VIDEO", "PICTURE"].includes(element.tagName)
      ) {
        return true;
      }
      const style = styleOf(element);
      const transparent = (color: string) =>
        color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);
      return (
        !transparent(style.backgroundColor) ||
        style.backgroundImage !== "none" ||
        style.backdropFilter !== "none"
      );
    };
    // The hit element, or one of its ancestors below the box the text shares
    // with it, paints over the text at this point.
    const coveredBy = (hit: Element, owner: Element, x: number, y: number) => {
      for (
        let node: Element | null = hit;
        node && !node.contains(owner);
        node = node.parentElement
      ) {
        if (paintsAt(node, x, y)) return node;
      }
      return null;
    };

    const boxes: Box[] = [];
    const visible = new Map<Element, boolean>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      if (text.trim().length === 0) continue;
      const owner = node.parentElement;
      if (!owner || owner.closest("svg, script, style, noscript, template")) {
        continue;
      }
      let shown = visible.get(owner);
      if (shown === undefined) {
        shown = painted(owner);
        visible.set(owner, shown);
      }
      if (!shown) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width < 2 || rect.height < 2) continue;
        boxes.push({
          left: rect.left + window.scrollX,
          right: rect.right + window.scrollX,
          top: rect.top + window.scrollY,
          bottom: rect.bottom + window.scrollY,
          owner,
          layer: layerOf(owner),
          label: `${owner.tagName.toLowerCase()}.${String(owner.className).slice(0, 40)} "${text.trim().slice(0, 24)}"`,
        });
      }
    }

    const found: string[] = [];
    const MIN = 4;
    const sorted = [...boxes].sort((a, b) => a.top - b.top);
    for (let i = 0; i < sorted.length && found.length < 5; i += 1) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j += 1) {
        const b = sorted[j];
        if (b.top >= a.bottom - MIN) break;
        if (a.owner === b.owner || a.layer !== b.layer) continue;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > MIN && overlapY > MIN) {
          found.push(
            `${a.label} overlaps ${b.label} by ${Math.round(overlapX)}x${Math.round(overlapY)} at y=${Math.round(a.top)}`,
          );
          break;
        }
      }
    }

    const clips = new Map<Element, ReturnType<typeof clipOf>>();
    for (const box of boxes) {
      if (found.length >= 5) break;
      // Hit-testing passes through pointer-events: none, so it cannot tell
      // whether such text is on top.
      if (styleOf(box.owner).pointerEvents === "none") continue;
      const clip = clips.get(box.owner) ?? clipOf(box.owner);
      clips.set(box.owner, clip);
      const top = box.top - window.scrollY;
      const bottom = box.bottom - window.scrollY;
      const y = (top + bottom) / 2;
      if (y < clip.top + 1 || y > clip.bottom - 1) continue;
      for (const x of [box.left + 3, (box.left + box.right) / 2, box.right - 3]) {
        if (x < clip.left + 1 || x > clip.right - 1) continue;
        const hit = document.elementFromPoint(x - window.scrollX, y);
        if (!hit || hit === box.owner || box.owner.contains(hit) || hit.contains(box.owner)) {
          continue;
        }
        if (layerOf(hit) !== box.layer) continue;
        const cover = coveredBy(hit, box.owner, x - window.scrollX, y);
        if (!cover) continue;
        found.push(
          `${box.label} is covered by ${cover.tagName.toLowerCase()}.${String(cover.getAttribute("class") ?? "").slice(0, 40)} at ${Math.round(x)},${Math.round(y)}`,
        );
        break;
      }
    }
    return found;
  });
}

// A floating layer (the home page's first-visit hint) must not sit over any
// text or control outside itself. findOverlappingText compares a fixed layer
// only with its own text, by design, so a layer that floats over the page is
// checked here on its own: every visible text line and every visible control
// whose box it overlaps by more than 1 px both ways is reported. Screen-reader
// only text and boxes that fill most of the viewport (the sky canvas) are not
// counted.
export async function findCoveredByLayer(page: Page, selector: string) {
  return page.evaluate((layerSelector) => {
    const layer = document.querySelector(layerSelector);
    if (!layer) return [`no element matches ${layerSelector}`];
    const box = layer.getBoundingClientRect();
    const covers = (rect: DOMRect) =>
      Math.min(rect.right, box.right) - Math.max(rect.left, box.left) > 1 &&
      Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top) > 1;
    const shown = (element: Element) => {
      if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
        return false;
      }
      if (element.closest('[aria-hidden="true"], .sr-only')) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const label = (element: Element) =>
      `${element.tagName.toLowerCase()} "${(
        element.getAttribute("aria-label") ??
        element.textContent ??
        ""
      )
        .trim()
        .slice(0, 28)}"`;

    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? "").trim();
      const owner = node.parentElement;
      if (!text || !owner || layer.contains(owner)) continue;
      if (owner.closest("svg, script, style, noscript, template")) continue;
      if (!shown(owner)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if ([...range.getClientRects()].some((rect) => rect.width >= 2 && rect.height >= 2 && covers(rect))) {
        found.push(`text in ${label(owner)}: "${text.slice(0, 28)}"`);
      }
    }
    const area = window.innerWidth * window.innerHeight;
    for (const control of document.querySelectorAll(
      'a[href], button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])',
    )) {
      if (layer.contains(control) || control.contains(layer) || !shown(control)) continue;
      const rect = control.getBoundingClientRect();
      if (rect.width * rect.height > area / 2) continue;
      if (covers(rect)) found.push(`control ${label(control)}`);
    }
    return found.slice(0, 8);
  }, selector);
}

// Lets layout settle after a style change: two frames, then any finite
// running animations (capped at 2 s), then a short pause for scripts that
// re-measure on resize.
export async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise((done) =>
      requestAnimationFrame(() => requestAnimationFrame(done)),
    );
    const running = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === "running" &&
          Number.isFinite(Number(animation.effect?.getTiming().iterations ?? 1)),
      );
    await Promise.race([
      Promise.all(running.map((animation) => animation.finished.catch(() => null))),
      new Promise((done) => setTimeout(done, 2_000)),
    ]);
  });
  await page.waitForTimeout(500);
}
