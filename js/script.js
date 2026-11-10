"use strict";

/* ============================================================
 * 一、工具函数
 * ============================================================ */

const EPS = 1e-9; // 防止浮点误差导致 floor 少 1（例如 23.9999999999 实为 24）

function floorSafe(value) {
  return Math.floor(value + EPS);
}

function countDecimals(text) {
  const s = String(text).trim();
  const idx = s.indexOf(".");
  return idx === -1 ? 0 : s.length - idx - 1;
}

function formatNumber(value, decimals) {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/* ============================================================
 * 二、输入解析与验证
 * ============================================================ */

function parseNumber(raw, label) {
  const text = String(raw).trim();
  if (text === "") return { error: label + "不能为空" };
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return { error: label + "必须是有效数字" };
  const value = Number(text);
  if (!Number.isFinite(value)) return { error: label + "数值无效" };
  return { value };
}

/**
 * 验证全部输入，返回 { values, errors }
 * errors: { 字段id: 错误信息 }
 */
function validateInputs(raw) {
  const errors = {};
  const values = {};

  const rules = [
    { id: "entryPrice", label: "入场价格", check: v => v > 0, msg: "入场价格必须大于 0" },
    { id: "atrValue", label: "ATR", check: v => v > 0, msg: "ATR 必须大于 0" },
    { id: "atrMultiplier", label: "ATR 倍数", check: v => v > 0, msg: "ATR 倍数必须大于 0" },
    { id: "margin", label: "保证金", check: v => v > 0, msg: "保证金必须大于 0" },
    { id: "riskRatio", label: "风险比例", check: v => v > 0 && v <= 100, msg: "风险比例必须大于 0 且不超过 100%" },
    { id: "maxLeverage", label: "交易所最大杠杆", check: v => v >= 1, msg: "交易所最大杠杆必须大于等于 1" },
  ];

  rules.forEach(rule => {
    const parsed = parseNumber(raw[rule.id], rule.label);
    if (parsed.error) {
      errors[rule.id] = parsed.error;
    } else if (!rule.check(parsed.value)) {
      errors[rule.id] = rule.msg;
    } else {
      values[rule.id] = parsed.value;
    }
  });

  return { values, errors };
}

/* ============================================================
 * 三、核心计算（严格按照公式，纯函数）
 * ============================================================ */

function calculateTrade(params) {
  const { direction, entryPrice, atrValue, atrMultiplier, margin, riskRatioPercent, exchangeMaxLeverage } = params;

  const riskRatio = riskRatioPercent / 100; // 49% -> 0.49

  // 1. ATR 止损距离
  const stopDistance = atrValue * atrMultiplier;

  // 2. 理论最大杠杆 Lmax = (Risk × Price) / (ATR × Multiplier)
  const theoreticalLeverage = (riskRatio * entryPrice) / stopDistance;

  // 4. 止损价格
  const stopLossPrice =
    direction === "LONG" ? entryPrice - stopDistance : entryPrice + stopDistance;

  // 3. 实际可用杠杆 = min(floor(理论), floor(交易所上限))
  const theoreticalFloor = floorSafe(theoreticalLeverage);
  const exchangeFloor = floorSafe(exchangeMaxLeverage);
  const actualLeverage = Math.min(theoreticalFloor, exchangeFloor);
  const limitedByExchange = theoreticalFloor > exchangeFloor;

  const result = {
    direction,
    riskRatio,
    stopDistance,
    theoreticalLeverage,
    stopLossPrice,
    actualLeverage,
    limitedByExchange,
    exchangeFloor,
    valid: actualLeverage >= 1, // 理论杠杆不足 1 时不生成有效持仓结果
    notionalValue: null,
    quantity: null,
    expectedLoss: null,
    actualRiskPercent: null,
  };

  if (!result.valid) return result;

  // 5. 名义持仓价值
  result.notionalValue = margin * actualLeverage;
  // 6. 持仓数量
  result.quantity = result.notionalValue / entryPrice;
  // 7. 预计价格亏损
  result.expectedLoss = result.notionalValue * (stopDistance / entryPrice);
  // 8. 实际保证金风险比例 (%)
  result.actualRiskPercent = ((actualLeverage * stopDistance) / entryPrice) * 100;

  return result;
}

/* ============================================================
 * 四、界面渲染
 * ============================================================ */

const $ = id => document.getElementById(id);
const inputIds = ["entryPrice", "atrValue", "atrMultiplier", "margin", "riskRatio", "maxLeverage"];
const resultIds = [
  "resTheoretical", "resActualLeverage", "resStopDistance", "resStopPrice",
  "resMargin", "resNotional", "resQuantity", "resEntry", "resAtr",
  "resRiskSet", "resRiskActual", "resExpectedLoss", "resExchangeLimit",
];

let currentDirection = "LONG";

function clearResults() {
  resultIds.forEach(id => { $(id).textContent = "--"; });
}

function showBanner(type, message) {
  const banner = $("statusBanner");
  banner.className = "banner " + type;
  banner.textContent = message;
}

function hideBanner() {
  $("statusBanner").className = "banner hidden";
}

function showFieldErrors(errors) {
  inputIds.forEach(id => {
    const input = $(id);
    const msgEl = document.querySelector('[data-error-for="' + id + '"]');
    if (errors[id]) {
      input.classList.add("invalid");
      msgEl.textContent = errors[id];
    } else {
      input.classList.remove("invalid");
      msgEl.textContent = "";
    }
  });
}

function render() {
  const raw = {};
  inputIds.forEach(id => { raw[id] = $(id).value; });

  const { values, errors } = validateInputs(raw);
  showFieldErrors(errors);
  document.body.setAttribute("data-direction", currentDirection);

  if (Object.keys(errors).length > 0) {
    clearResults();
    updateRiskScene(null);
    showBanner("error", "请先修正右侧标红的输入项，修正后将自动计算。");
    return;
  }

  const r = calculateTrade({
    direction: currentDirection,
    entryPrice: values.entryPrice,
    atrValue: values.atrValue,
    atrMultiplier: values.atrMultiplier,
    margin: values.margin,
    riskRatioPercent: values.riskRatio,
    exchangeMaxLeverage: values.maxLeverage,
  });

  // 价格精度：取入场价与 ATR 小数位的较大值，限定在 2~8 位
  const priceDecimals = Math.min(8, Math.max(2, countDecimals(raw.entryPrice), countDecimals(raw.atrValue)));

  // 核心结果（无论杠杆是否有效都可展示）
  $("resTheoretical").textContent = formatNumber(r.theoreticalLeverage, 2) + "x";
  $("resStopDistance").textContent = formatNumber(r.stopDistance, priceDecimals);
  $("resStopPrice").textContent = formatNumber(r.stopLossPrice, priceDecimals);
  $("resEntry").textContent = formatNumber(values.entryPrice, priceDecimals);
  $("resAtr").textContent = formatNumber(values.atrValue, priceDecimals);
  $("resMargin").textContent = formatNumber(values.margin, 2) + " USDT";
  $("resRiskSet").textContent = formatNumber(values.riskRatio, 2) + "%";

  if (!r.valid) {
    updateRiskScene(null);
    $("resActualLeverage").textContent = "不可用";
    $("resNotional").textContent = "--";
    $("resQuantity").textContent = "--";
    $("resRiskActual").textContent = "--";
    $("resExpectedLoss").textContent = "--";
    $("resExchangeLimit").textContent = "--";
    showBanner("warn", "风险不足以支持 1 倍杠杆（理论杠杆 " + formatNumber(r.theoreticalLeverage, 2) +
      "x < 1）。请减小 ATR 倍数、提高风险比例，或更换品种/周期，无法生成有效持仓计算结果。");
    return;
  }

  hideBanner();
  updateRiskScene(r.actualRiskPercent);
  $("resActualLeverage").textContent = r.actualLeverage + "x";
  $("resNotional").textContent = formatNumber(r.notionalValue, 2) + " USDT";
  $("resQuantity").textContent = formatNumber(r.quantity, 4);
  $("resRiskActual").textContent = formatNumber(r.actualRiskPercent, 2) + "%";
  $("resExpectedLoss").textContent = formatNumber(r.expectedLoss, 2) + " USDT";
  $("resExchangeLimit").textContent = r.limitedByExchange
    ? "已触及上限（" + r.exchangeFloor + "x）"
    : "未触及（上限 " + r.exchangeFloor + "x）";
}

/* ============================================================
 * 五、事件绑定
 * ============================================================ */

inputIds.forEach(id => $(id).addEventListener("input", render));

document.querySelectorAll(".dir-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentDirection = btn.dataset.direction;
    document.querySelectorAll(".dir-btn").forEach(b => b.classList.toggle("active", b === btn));
    render();
  });
});

/* ============================================================
 * 六、自检：用测试数据校验计算逻辑（结果见浏览器控制台）
 * ============================================================ */

(function selfTest() {
  const r = calculateTrade({
    direction: "LONG",
    entryPrice: 90.83,
    atrValue: 1.87,
    atrMultiplier: 1,
    margin: 100,
    riskRatioPercent: 49,
    exchangeMaxLeverage: 125,
  });
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const ok =
    near(r.stopDistance, 1.87, 1e-9) &&
    near(r.theoreticalLeverage, 23.80, 0.01) &&
    r.actualLeverage === 23 &&
    near(r.stopLossPrice, 88.96, 1e-9) &&
    near(r.notionalValue, 2300, 1e-9) &&
    near(r.quantity, 25.32, 0.01) &&
    near(r.expectedLoss, 47.35, 0.02) &&
    near(r.actualRiskPercent, 47.35, 0.02);
  console.log(ok ? "[SelfTest] 通过" : "[SelfTest] 失败", r);
})();

/* ============================================================
 * 七、动态背景：电梯小人（风险越高，楼层越高）
 * ============================================================ */

const SCENE_FLOORS = 10;        // 楼层数：0~9 层，第 10 档 = 楼顶
const LOBBY_PHONE_RISK_PERCENT = 5; // 低于此值：一楼出电梯看手机
const ROOF_RISK_PERCENT = 60;   // 实际风险比例 ≥ 此值，小人到楼顶吹风
const ROOF_SMOKE_RISK_PERCENT = 90; // 高于此值：楼顶走到旗杆旁抽烟
const PERSON_ENTRY_DURATION_MS = 1100; // 小人走回电梯的动画时长（略长于 CSS 的 1 秒横移）

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function riskToLevel(riskPercent) {
  if (riskPercent >= ROOF_RISK_PERCENT) return SCENE_FLOORS;
  return Math.min(SCENE_FLOORS - 1, Math.floor((riskPercent / ROOF_RISK_PERCENT) * SCENE_FLOORS));
}

function riskToTier(riskPercent) {
  if (riskPercent >= ROOF_RISK_PERCENT) return { key: "extreme", text: "极高风险" };
  if (riskPercent >= 40) return { key: "high", text: "较高风险" };
  if (riskPercent >= 20) return { key: "mid", text: "中等风险" };
  return { key: "low", text: "低风险" };
}

function levelToLabel(level) {
  return level >= SCENE_FLOORS ? "楼顶" : (level + 1) + "F";
}

function buildFloorsHtml() {
  let html = "";
  for (let i = 0; i < SCENE_FLOORS; i++) {
    let wins = "";
    for (let j = 0; j < 3; j++) {
      wins += '<i class="win' + (Math.random() < 0.45 ? " lit" : "") + '"></i>';
    }
    html += '<div class="floor">' + wins + "</div>";
  }
  return html;
}

function buildSkylineHtml(count, minVh, maxVh, className) {
  let html = "";
  for (let i = 0; i < count; i++) {
    const width = 36 + Math.random() * 54;
    const height = minVh + Math.random() * (maxVh - minVh);
    html += '<i class="city-b" style="width:' + width.toFixed(0) + "px;height:" + height.toFixed(1) + 'vh"></i>';
  }
  return '<div class="city ' + className + '">' + html + "</div>";
}

function buildCloudsHtml() {
  let html = "";
  for (let i = 0; i < 5; i++) {
    const top = 5 + i * 8 + Math.random() * 4;
    const scale = 0.7 + Math.random() * 0.9;
    const duration = 70 + i * 22;
    html +=
      '<i class="cloud" style="top:' + top.toFixed(1) + "vh;--cs:" + scale.toFixed(2) +
      ";--cd:" + duration + "s;--cdl:-" + (i * 17) + 's"></i>';
  }
  return html;
}

function buildWindHtml() {
  let html = "";
  for (let i = 0; i < 9; i++) {
    const top = 10 + Math.random() * 55;
    const width = 90 + Math.random() * 140;
    const duration = 2 + Math.random() * 1.6;
    html +=
      '<i class="wind-line" style="top:' + top.toFixed(1) + "vh;width:" + width.toFixed(0) +
      "px;--wd:" + duration.toFixed(2) + "s;--dl:-" + (Math.random() * 3).toFixed(2) + 's"></i>';
  }
  return html;
}

const PERSON_SVG = `
<svg class="person-svg" viewBox="0 0 24 40" xmlns="http://www.w3.org/2000/svg">
  <g class="p-body">
    <g class="p-leg-l"><rect x="8" y="27" width="3.4" height="11.5" rx="1.7" fill="#1e293b"/></g>
    <g class="p-leg-r"><rect x="12.6" y="27" width="3.4" height="11.5" rx="1.7" fill="#1e293b"/></g>
    <rect x="6" y="13" width="12" height="16" rx="4" fill="#f97316"/>
    <g class="p-arm-l"><rect x="2.8" y="14" width="3.4" height="12" rx="1.7" fill="#ea580c"/></g>
    <g class="p-arm-r"><rect x="17.8" y="14" width="3.4" height="12" rx="1.7" fill="#ea580c"/></g>
    <circle cx="12" cy="8" r="5.5" fill="#fcd9b6"/>
    <path d="M6.3 7.6 Q6.8 1.6 12 1.8 Q17.2 1.6 17.7 7.6 Q14 4.4 6.3 7.6Z" fill="#1f2937"/>
    <circle cx="10" cy="8.6" r="0.8" fill="#1f2937"/>
    <circle cx="14" cy="8.6" r="0.8" fill="#1f2937"/>
    <rect x="6.5" y="13" width="11" height="2.4" rx="1.2" fill="#38bdf8"/>
    <path class="p-scarf-tail" d="M15.5 14 h3 v8 h-3z" fill="#38bdf8"/>
    <path class="p-lobby-arm" d="M19 15 Q20.5 16.5 18.2 18.2 L16.3 20" fill="none" stroke="#ea580c" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    <g class="p-phone"><rect x="10.8" y="18.2" width="3.5" height="5.8" rx="0.7" fill="#0f172a"/><rect x="11.3" y="18.8" width="2.5" height="4" rx="0.3" fill="#7dd3fc"/></g>
    <path class="p-smoking-arm" d="M19 15 Q21 14.5 19.5 12.5" fill="none" stroke="#ea580c" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    <g class="p-cigarette"><path d="M17.5 12.7 h3.8" stroke="#f8fafc" stroke-width="0.9" stroke-linecap="round"/><path d="M20.8 12.7 h0.6" stroke="#fb923c" stroke-width="0.9" stroke-linecap="round"/></g>
  </g>
</svg>`;

/* ---------- 创建场景 DOM ---------- */

const scene = document.createElement("div");
scene.className = "scene";
scene.setAttribute("aria-hidden", "true");
scene.dataset.risk = "mid";
scene.dataset.wind = "0";
scene.innerHTML = `
  <div class="sun"></div>
  ${buildCloudsHtml()}
  ${buildWindHtml()}
  ${buildSkylineHtml(44, 8, 26, "far")}
  ${buildSkylineHtml(36, 5, 16, "near")}
  <div class="ground"></div>
  <div class="tower">
    <div class="risk-badge">
      <b class="rb-risk">风险 --</b><span class="rb-tier">等待输入</span><span class="rb-floor"></span>
    </div>
    <div class="building">${buildFloorsHtml()}</div>
    <div class="roof"><i class="pole"></i><i class="flag"></i></div>
    <div class="shaft"><div class="car"><span class="car-led">1F</span></div></div>
    <div class="person">${PERSON_SVG}</div>
  </div>`;
document.body.prepend(scene);

const sceneTower = scene.querySelector(".tower");
const scenePerson = scene.querySelector(".person");
const sceneLed = scene.querySelector(".car-led");
const sceneFloors = scene.querySelectorAll(".floor");
const badgeRisk = scene.querySelector(".rb-risk");
const badgeTier = scene.querySelector(".rb-tier");
const badgeFloor = scene.querySelector(".rb-floor");

let sceneLevel = 0;          // 电梯当前目标档位（0~9 层，10 = 楼顶）
let scenePersonMode = "inside"; // inside / lobby / roof / smoking
let sceneReturnPromise = null;   // 共用回轿厢等待，避免快速改值时电梯提前启动
let sceneRunId = 0;          // 用于打断上一次尚未完成的动画流程
let sceneTimer = null;       // 输入防抖

sceneFloors[0].classList.add("here");

function setPersonMode(mode) {
  scenePersonMode = mode;
  scenePerson.classList.toggle("out", mode === "roof" || mode === "smoking");
  scenePerson.classList.toggle("lobby", mode === "lobby");
  scenePerson.classList.toggle("smoking", mode === "smoking");
  scenePerson.classList.add("walking");
  setTimeout(() => scenePerson.classList.remove("walking"), 1000);
}

function returnPersonToElevator() {
  if (scenePersonMode !== "inside") {
    setPersonMode("inside");
    sceneReturnPromise = sleep(PERSON_ENTRY_DURATION_MS).then(() => {
      sceneReturnPromise = null;
    });
  }
  return sceneReturnPromise || Promise.resolve();
}

async function goToLevel(target, destinationMode = "inside") {
  const runId = ++sceneRunId;

  // 只在同一楼层的楼顶姿势切换时留在外面；其他换层都先回轿厢并等横移结束。
  if (sceneReturnPromise) {
    await sceneReturnPromise;
    if (runId !== sceneRunId) return;
  }
  if (scenePersonMode !== "inside" && (target !== sceneLevel || destinationMode === "inside")) {
    await returnPersonToElevator();
    if (runId !== sceneRunId) return;
  }

  // 2. 电梯移动
  if (target !== sceneLevel) {
    const duration = Math.max(0.9, Math.abs(target - sceneLevel) * 0.32);
    sceneLed.textContent = target > sceneLevel ? "▲" : "▼";
    sceneFloors.forEach(f => f.classList.remove("here"));
    sceneTower.style.setProperty("--dur", duration + "s");
    sceneTower.style.setProperty("--lv", target);
    sceneLevel = target;
    await sleep(duration * 1000 + 100);
    if (runId !== sceneRunId) return;
  }

  sceneLed.textContent = levelToLabel(target);
  sceneFloors.forEach((f, i) => f.classList.toggle("here", i === target));

  // 到站后再执行目标姿势；roof ↔ smoking 只改变横向位置，不乘梯。
  if (destinationMode !== scenePersonMode) setPersonMode(destinationMode);
}

/**
 * 根据实际保证金风险比例更新背景。
 * 传入 null 表示当前输入无效：小人原地不动。
 */
function updateRiskScene(riskPercent) {
  if (riskPercent === null || !Number.isFinite(riskPercent)) {
    badgeRisk.textContent = "风险 --";
    badgeTier.textContent = "等待有效输入";
    badgeFloor.textContent = "";
    return;
  }

  const tier = riskToTier(riskPercent);
  const target = riskToLevel(riskPercent);
  const personMode = riskPercent < LOBBY_PHONE_RISK_PERCENT ? "lobby" :
    (riskPercent > ROOF_SMOKE_RISK_PERCENT ? "smoking" :
      (riskPercent >= ROOF_RISK_PERCENT ? "roof" : "inside"));

  scene.dataset.risk = tier.key;
  scene.dataset.wind = riskPercent >= ROOF_RISK_PERCENT ? "2" : riskPercent >= 40 ? "1" : "0";
  badgeRisk.textContent = "风险 " + riskPercent.toFixed(1) + "%";
  badgeTier.textContent = tier.text;
  badgeFloor.textContent = personMode === "lobby" ? "1F 看手机" :
    (personMode === "roof" ? "楼顶吹风" :
      (personMode === "smoking" ? "旗边抽烟" : "目标 " + levelToLabel(target)));

  // 防抖：避免输入过程中电梯来回乱跑
  clearTimeout(sceneTimer);
  sceneTimer = setTimeout(() => goToLevel(target, personMode), 350);
}

/* ============================================================
 * 八、使用说明弹窗
 * ============================================================ */

(function setupGuideModal() {
  const modal = $("guideModal");

  function openGuide() {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden"; // 弹窗打开时锁定背景滚动
  }

  function closeGuide() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  $("openGuide").addEventListener("click", openGuide);
  $("closeGuide").addEventListener("click", closeGuide);

  // 点击遮罩层空白处关闭
  modal.addEventListener("click", event => {
    if (event.target === modal) closeGuide();
  });

  // 按 Esc 关闭
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("open")) closeGuide();
  });
})();

/* ============================================================
 * 九、首次渲染（必须放在场景模块之后）
 * ============================================================ */

render();
