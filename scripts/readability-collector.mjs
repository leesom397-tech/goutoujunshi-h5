// Runs in the browser. Reports computed evidence, not a WCAG certification.
export function collectReadability() {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  context.canvas.width = context.canvas.height = 1;
  const parse = value => {
    if (!value) return null;
    context.clearRect(0, 0, 1, 1); context.fillStyle = '#010203';
    try { context.fillStyle = value; context.fillRect(0, 0, 1, 1); } catch { return null; }
    const rgba = Array.from(context.getImageData(0, 0, 1, 1).data); rgba[3] /= 255; return rgba;
  };
  const blend = (front, back) => {
    const a = front[3] + back[3] * (1 - front[3]);
    return [0, 1, 2].map(i => a ? (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / a : 0).concat(a);
  };
  const lum = color => color.slice(0, 3).map(n => { const s = n / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
  const colors = value => [...value.matchAll(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]+\)|#[\da-f]{3,8}\b|\btransparent\b/ig)].map(match => parse(match[0])).filter(Boolean);
  const layers = value => { const result = []; let depth = 0, start = 0; for (let i = 0; i < value.length; i++) { if (value[i] === '(') depth++; else if (value[i] === ')') depth--; else if (value[i] === ',' && depth === 0) { result.push(value.slice(start, i)); start = i + 1; } } result.push(value.slice(start)); return result; };
  const compress = values => [...new Map(values.map(value => [value.map((n, i) => i === 3 ? n.toFixed(2) : Math.round(n)).join(','), value])).values()].sort((a, b) => lum(a) - lum(b)).filter((_, i, all) => all.length <= 32 || i === 0 || i === all.length - 1 || i % Math.ceil(all.length / 28) === 0);
  const rgba = value => `rgba(${value.slice(0, 3).map(Math.round).join(', ')}, ${value[3].toFixed(2)})`;
  const path = element => {
    const parts = []; for (let node = element; node && node !== document.body && parts.length < 4; node = node.parentElement) { let part = node.tagName.toLowerCase(); if (node.id) { parts.unshift(part + '#' + node.id); break; } if (typeof node.className === 'string' && node.className.trim()) part += '.' + node.className.trim().split(/\s+/).slice(0, 3).join('.'); parts.unshift(part); }
    return parts.join(' > ');
  };
  const ownText = element => ['INPUT', 'TEXTAREA'].includes(element.tagName) ? element.value || element.getAttribute('placeholder') || '' : element.tagName === 'SELECT' ? element.selectedOptions?.[0]?.text || '' : Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(' ').replace(/\s+/g, ' ').trim();
  function category(element, text) {
    const name = [element.className, element.parentElement?.className].filter(value => typeof value === 'string').join(' ');
    if (!/[\u3400-\u9fff]/.test(text) && /[a-z]/i.test(text) && (element.closest('.web-brand') || /brand|stamp|kicker|eyebrow|caption|wordmark|signature|art-label|entry-detail|workspace-welcome/i.test(name))) return { role: 'decorative', minimum: 0, target: 0 };
    if (/^H[1-6]$/.test(element.tagName)) return { role: 'heading', minimum: 14, target: 18 };
    if (element.closest('nav')) return { role: 'navigation', minimum: 12, target: 13 };
    if (['SMALL', 'TIME', 'CODE', 'DT', 'CAPTION'].includes(element.tagName) || element.closest('small,footer')) return { role: 'support', minimum: 12, target: 13 };
    if (element.closest('.wa-check,.register-consent')) return { role: 'consent-support', minimum: 13, target: 14 };
    if (element.closest('.wa-tabs')) return { role: 'compact-tab', minimum: 13, target: 13 };
    if (element.closest('button,label,legend,summary,th') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.matches('a[class*=button],a[class*=primary],a[class*=cta]')) return { role: 'control', minimum: 13, target: 14 };
    if (['SMALL', 'TIME', 'CODE', 'DT', 'CAPTION'].includes(element.tagName) || element.closest('small,footer') || /source|caption|eyebrow|kicker|hint|badge|pill|tag|footnote|meta|note|muted|secondary|capability-strip|workspace-trust|_stat_/i.test(name)) return { role: 'support', minimum: 12, target: 13 };
    return { role: 'body', minimum: 14, target: 15 };
  }
  function background(element) {
    let samples = [[255, 255, 255, 1]], uncertain = [], gradient = false;
    const chain = []; for (let node = element; node; node = node.parentElement) chain.unshift(node);
    const stack = [];
    for (const node of chain) {
      const style = getComputedStyle(node), textBackground = (style.backgroundClip || style.webkitBackgroundClip || '').includes('text');
      const solid = parse(style.backgroundColor);
      if (!textBackground && solid?.[3] > 0) {
        if (solid[3] >= .999) uncertain = uncertain.filter(reason => /opacity|blend|pseudo/.test(reason));
        samples = samples.map(sample => blend(solid, sample));
        stack.push({ element: path(node), color: style.backgroundColor });
      }
      if (!textBackground && style.backgroundImage !== 'none') {
        stack.push({ element: path(node), image: style.backgroundImage });
        for (const layer of layers(style.backgroundImage).reverse()) {
          if (/gradient\(/.test(layer)) {
            const stops = colors(layer);
            if (!stops.length) uncertain.push('unparsed gradient');
            else { gradient = true; samples = compress(samples.flatMap(sample => stops.map(stop => blend(stop, sample)))); }
          } else uncertain.push('background image');
        }
      }
      if (Number(style.opacity) < .999) uncertain.push(`ancestor opacity ${style.opacity}`);
      if (style.mixBlendMode !== 'normal') uncertain.push(`blend mode ${style.mixBlendMode}`);
      for (const pseudo of ['::before', '::after']) {
        const paint = getComputedStyle(node, pseudo);
        if (paint.content !== 'none' && paint.content !== 'normal' && paint.display !== 'none' && (paint.backgroundImage !== 'none' || parse(paint.backgroundColor)?.[3] > 0)) uncertain.push('painted ancestor pseudo-element');
      }
    }
    return { samples: compress(samples), uncertain: [...new Set(uncertain)], gradient, stack };
  }
  const rows = [];
  for (const element of document.querySelectorAll('body *')) {
    if (element.closest('svg,script,style,noscript,[aria-hidden=true],[hidden]') || element.matches('input[type=checkbox],input[type=radio],input[type=range],input[type=file],input[type=hidden]') || !element.getClientRects().length) continue;
    const base = getComputedStyle(element), rect = element.getBoundingClientRect();
    if (base.display === 'none' || base.visibility !== 'visible' || rect.width <= 0 || rect.height <= 0 || Number(base.opacity) === 0) continue;
    const text = ownText(element); if (!text.trim()) continue;
    const placeholder = ['INPUT', 'TEXTAREA'].includes(element.tagName) && !element.value;
    const style = placeholder ? getComputedStyle(element, '::placeholder') : base;
    const group = category(element, text), size = parseFloat(style.fontSize), weight = Number(style.fontWeight) || style.fontWeight;
    const back = background(element), front = parse(style.color), textGradient = (base.backgroundClip || base.webkitBackgroundClip || '').includes('text');
    const foregrounds = textGradient ? colors(base.backgroundImage) : front ? [front] : [];
    if (textGradient && !foregrounds.length) back.uncertain.push('unparsed text gradient');
    if (placeholder && Number(style.opacity) < .999) back.uncertain.push(`placeholder opacity ${style.opacity}`);
    if (foregrounds.some(value => value[3] === 0)) back.uncertain.push('transparent text paint');
    const values = foregrounds.flatMap(foreground => back.samples.map(sample => ratio(blend(foreground, sample), sample)));
    const contrast = values.length ? Math.min(...values) : null;
    const disabled = !!element.closest(':disabled,[aria-disabled=true]');
    const issues = [];
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) && element.scrollWidth > element.clientWidth + 1 && ['hidden', 'clip'].includes(base.overflowX)) issues.push('check-clipped-text');
    if (group.minimum && size + .1 < group.minimum) issues.push('below-minimum-size');
    else if (group.target && size + .1 < group.target) issues.push('below-target-size');
    if (contrast !== null && contrast < 4.5 && !disabled && group.role !== 'decorative') issues.push(back.uncertain.length ? 'manual-low-contrast-candidate' : back.gradient || textGradient ? 'gradient-low-contrast-candidate' : 'low-contrast');
    rows.push({ text: text.slice(0, 220), selector: path(element), tag: element.tagName.toLowerCase(), role: group.role, placeholder,
      size, weight, lineHeight: style.lineHeight, minimum: group.minimum, target: group.target,
      foreground: style.color, textGradient: textGradient ? base.backgroundImage : '', backgroundCandidates: back.samples.map(rgba), backgroundStack: back.stack,
      contrast: contrast === null ? null : Math.round(contrast * 100) / 100,
      contrastMethod: back.uncertain.length ? 'computed-candidates-manual-review' : back.gradient || textGradient ? 'minimum-known-gradient-stops' : 'alpha-composited-solid',
      manualReasons: back.uncertain, disabled, selected: !!element.closest('[aria-current=page],[aria-selected=true],input:checked'),
      issues, viewport: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } });
  }
  return { url: location.href, viewport: { width: innerWidth, height: innerHeight, contentWidth: document.documentElement.scrollWidth }, rows };
}
