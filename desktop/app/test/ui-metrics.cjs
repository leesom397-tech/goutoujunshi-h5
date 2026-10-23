'use strict';

// Runs inside the renderer. Uses final CSS colors, including transparent parent
// surfaces and gradient stops; decorative background images are reported for
// visual review rather than assigned a made-up color.
function textContrast(selectors) {
  const color = value => {
    const found = /^rgba?\(([^)]+)\)$/.exec(value || '');
    if (!found) return null;
    const numbers = found[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [numbers[0], numbers[1], numbers[2], numbers.length > 3 ? numbers[3] : 1];
  };
  const over = (front, back) => front.slice(0, 3).map((part, index) => part * front[3] + back[index] * (1 - front[3]));
  const luminance = rgb => rgb.map(value => { const scaled = value / 255; return scaled <= .04045 ? scaled / 12.92 : ((scaled + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const samples = [], unresolved = [];
  for (const element of document.querySelectorAll(selectors)) {
    const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
    const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
    const text = (input ? element.value || element.placeholder : element.textContent).trim().slice(0, 70);
    if (!text || !bounds.width || !bounds.height || style.visibility === 'hidden' || element.closest('[disabled],[aria-disabled="true"]')) continue;
    const foregroundStyle = input && !element.value ? getComputedStyle(element, '::placeholder') : style;
    const foreground = color(foregroundStyle.color);
    if (!foreground) { unresolved.push({ text, reason: 'unsupported text color', color: foregroundStyle.color }); continue; }
    const parents = []; let current = element;
    while (current) { parents.unshift(current); current = current.parentElement; }
    let backgrounds = [[255, 255, 255]], unknown = false;
    for (const parent of parents) {
      const surface = getComputedStyle(parent), base = color(surface.backgroundColor);
      if (base) backgrounds = backgrounds.map(background => over(base, background));
      if (surface.backgroundImage !== 'none') {
        if (surface.backgroundImage.includes('url(')) { unknown = true; break; }
        const stops = [...surface.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(match => color(match[0])).filter(Boolean);
        if (!stops.length) { unknown = true; break; }
        backgrounds = backgrounds.flatMap(background => stops.map(stop => over(stop, background)));
      }
    }
    if (unknown) { unresolved.push({ text, reason: 'image background needs visual review' }); continue; }
    const ratios = backgrounds.map(background => {
      const a = luminance(over(foreground, background)), b = luminance(background);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    const size = parseFloat(style.fontSize), weight = parseInt(style.fontWeight, 10) || 400;
    const minimum = size >= 24 || size >= 18.66 && weight >= 700 ? 3 : 4.5;
    const ratio = Math.min(...ratios);
    samples.push({ text, tag: element.tagName, className: element.className, color: foregroundStyle.color, size, minimum, ratio: Math.round(ratio * 100) / 100, passes: ratio + .001 >= minimum });
  }
  return { samples, unresolved, failures: samples.filter(sample => !sample.passes) };
}

module.exports = { textContrast };
