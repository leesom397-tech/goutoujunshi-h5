function drawRadar(page, canvasId, rows, axisLabels = []) {
  if (typeof wx.createCanvasContext !== "function") return;
  const ctx = wx.createCanvasContext(canvasId, page);
  const dimensions = Array.from({ length: 6 }, (_, i) => {
    const row = Array.isArray(rows) && rows[i] && typeof rows[i] === "object" ? rows[i] : {};
    return { ...row, label: row.label || row.dimension || axisLabels[i] || `维度 ${i + 1}` };
  });
  const point = (i, level) => [150 + Math.cos(-Math.PI / 2 + i * Math.PI / 3) * 86 * level, 132 + Math.sin(-Math.PI / 2 + i * Math.PI / 3) * 86 * level];
  ctx.clearRect(0, 0, 300, 270);
  [0.25, 0.5, 0.75, 1].forEach(level => {
    ctx.beginPath();
    dimensions.forEach((_, i) => { const p = point(i, level); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
    ctx.closePath(); ctx.setStrokeStyle("#d8cbbb"); ctx.stroke();
  });
  const value = row => { const n = typeof row.value === "number" ? row.value : row.score; return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; };
  if (dimensions.every(row => value(row) !== null)) {
    ctx.beginPath(); dimensions.forEach((row, i) => { const p = point(i, Math.max(0, Math.min(100, value(row))) / 100); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
    ctx.closePath(); ctx.setFillStyle("rgba(71,122,120,0.14)"); ctx.fill(); ctx.setStrokeStyle("#477a78"); ctx.stroke();
  }
  dimensions.forEach((row, i) => {
    const edge = point(i, 1); ctx.beginPath(); ctx.moveTo(150, 132); ctx.lineTo(edge[0], edge[1]); ctx.setStrokeStyle("#d8cbbb"); ctx.stroke();
    const n = value(row); if (n !== null) { const p = point(i, Math.max(0, Math.min(100, n)) / 100); ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.setFillStyle(n >= 75 ? "#477a78" : n < 40 ? "#b35b48" : "#aa7a36"); ctx.fill(); }
    const label = point(i, 1.32); ctx.setTextAlign("center"); ctx.setFontSize(12); ctx.setFillStyle("#4b4038"); ctx.fillText(row.label || row.dimension || "待补充", label[0], label[1]); ctx.setFillStyle(n === null ? "#756960" : "#477a78"); ctx.fillText(n === null ? "待了解" : String(n), label[0], label[1] + 15);
  });
  ctx.draw();
}
function drawTrend(page, canvasId, rows) {
  if (typeof wx.createCanvasContext !== "function") return;
  const ctx = wx.createCanvasContext(canvasId, page);
  ctx.clearRect(0, 0, 300, 200);
  const points = (rows || []).filter(row => row.eventStart).slice(-8);
  ctx.setFontSize(12); ctx.setTextAlign("right");
  [0, 50, 100].forEach(value => { const y = 164 - value * 1.3; ctx.beginPath(); ctx.moveTo(34, y); ctx.lineTo(284, y); ctx.setStrokeStyle("#d8cbbb"); ctx.stroke(); ctx.setFillStyle("#756960"); ctx.fillText(String(value), 27, y + 4); });
  let previous = null;
  points.forEach((row, i) => {
    const x = points.length === 1 ? 159 : 34 + i * 250 / (points.length - 1);
    if (typeof row.score === "number") {
      const y = 164 - Math.max(0, Math.min(100, row.score)) * 1.3;
      if (previous && row.connectPrevious) { ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(x, y); ctx.setStrokeStyle("#477a78"); ctx.setLineWidth(2); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.setFillStyle("#477a78"); ctx.fill(); previous = { x, y };
    } else previous = null;
    ctx.setTextAlign(points.length > 1 && i === 0 ? "left" : points.length > 1 && i === points.length - 1 ? "right" : "center"); ctx.setFillStyle("#756960"); ctx.fillText(row.axisLabel || row.eventStart.slice(5), x, i % 2 ? 196 : 181);
  });
  if (!points.length) { ctx.setTextAlign("center"); ctx.setFillStyle("#756960"); ctx.fillText("聊天日期确认后显示趋势", 159, 100); }
  ctx.draw();
}
module.exports = { drawRadar, drawTrend };
