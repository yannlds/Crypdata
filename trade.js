// trade.js

// ---------------- CONFIGURAÇÕES ----------------
const TIMEFRAME         = "1m";
const HIST_LIMIT        = 100;
const RIGHT_OFFSET_BARS = 2;
const TZ_OFFSET_SECONDS = new Date().getTimezoneOffset() * 60;

// --------------- UTILITÁRIOS ---------------
/**
 * Calcula casas decimais dinamicamente com base no preço:
 *   moedas caras   → 2 casas
 *   ~1–10           → 4 casas
 *   ~0.01–1         → 6 casas
 *   ~0.0001–0.01    → 8 casas
 *   valores <0.0001 → até 12 casas, conforme magnitude
 */
function getPrecision(price) {
  // -Math.floor(log10(price)) + 4 gera:
  //  price=45000 → -4 + 4 = 0   → clamped para 2  
  //  price=2.75  → -0 + 4 = 4   → 4 casas  
  //  price=0.02  → -(-2) + 4 = 6 → 6 casas  
  //  price=0.005 → -(-3) + 4 = 7 → 7 casas  
  //  price=0.000000235 → -(-7) + 4 = 11 → 11 casas
  const dynamic = -Math.floor(Math.log10(price)) + 4;
  return Math.min(Math.max(dynamic, 2), 12);
}

// ------------- PARÂMETRO DA MOEDA -------------
const params     = new URLSearchParams(window.location.search);
const COIN       = (params.get("coin") || "BTC").toUpperCase();
const pairSymbol = `${COIN}USDT`;
const pairLower  = pairSymbol.toLowerCase();

// ----------------- ÍCONES ----------------------
const coinIconsMap = {};
async function fetchCoinIcons() {
  try {
    await Promise.all([1, 2].map(async page => {
      const url = new URL("https://api.coingecko.com/api/v3/coins/markets");
      url.searchParams.set("vs_currency", "usd");
      url.searchParams.set("order", "market_cap_desc");
      url.searchParams.set("per_page", "250");
      url.searchParams.set("page", String(page));
      url.searchParams.set("sparkline", "false");
      const res   = await fetch(url);
      const dados = await res.json();
      dados.forEach(c => {
        coinIconsMap[c.symbol.toUpperCase()] = c.image;
      });
    }));
  } catch {
    console.warn("Falha ao carregar logos CoinGecko");
  }
}

// ------------- ELEMENTOS DO DOM --------------
const graficoEl = document.getElementById("trade-chart");
const priceEl   = document.getElementById("current-price");
const sellList  = document.getElementById("sell-orders");
const buyList   = document.getElementById("buy-orders");

// ------------- VARIÁVEIS DO CHART ------------
let chart, candleSeries;

// ---------- THROTTLE PARA depthUpdate ------------
let depthTimer  = null;
let latestDepth = null;
const DEPTH_MS  = 500;

function scheduleDepth(d) {
  latestDepth = d;
  if (!depthTimer) {
    depthTimer = setTimeout(() => {
      applyPushDown(latestDepth);
      depthTimer = null;
    }, DEPTH_MS);
  }
}

// --------- PUSH-DOWN (linha1 empurra) ----------
const MAX_ROWS = 20;

function applyPushDown(d) {
  const [askPx, askQty] = d.asks[0];
  const [bidPx, bidQty] = d.bids[0];
  renderTopRow(sellList, parseFloat(askPx), parseFloat(askQty));
  renderTopRow(buyList,  parseFloat(bidPx), parseFloat(bidQty));
}

function renderTopRow(listEl, price, amount) {
  const value = (price * amount)
    .toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const precision = getPrecision(price);

  const li = document.createElement("li");
  li.className = "book-row";
  li.innerHTML = `
    <span>${price.toFixed(precision)}</span>
    <span>${amount}</span>
    <span>${value}</span>
  `;
  listEl.insertBefore(li, listEl.children[1]);

  if (listEl.children.length > MAX_ROWS + 1) {
    listEl.removeChild(listEl.lastChild);
  }
}

// ------------- FETCH INICIAL DE DEPTH -------------
async function fetchInitialDepth() {
  try {
    const res  = await fetch(
      `https://api.binance.com/api/v3/depth?symbol=${pairSymbol}&limit=${MAX_ROWS}`
    );
    const data = await res.json();

    [sellList, buyList].forEach(list => {
      while (list.children.length > 1) {
        list.removeChild(list.lastChild);
      }
    });

    data.asks.forEach(([px, qty]) => {
      const price     = parseFloat(px);
      const precision = getPrecision(price);
      const value     = (price * qty)
        .toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

      const li = document.createElement("li");
      li.className = "book-row";
      li.innerHTML = `
        <span style="color:#ef5350;">${price.toFixed(precision)}</span>
        <span>${qty}</span>
        <span>${value}</span>
      `;
      sellList.appendChild(li);
    });

    data.bids.forEach(([px, qty]) => {
      const price     = parseFloat(px);
      const precision = getPrecision(price);
      const value     = (price * qty)
        .toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

      const li = document.createElement("li");
      li.className = "book-row";
      li.innerHTML = `
        <span style="color:#26a69a;">${price.toFixed(precision)}</span>
        <span>${qty}</span>
        <span>${value}</span>
      `;
      buyList.appendChild(li);
    });

  } catch (err) {
    console.error("Erro ao buscar orderbook inicial:", err);
  }
}

// ---------------- CHART ----------------------
async function initChart() {
  chart = LightweightCharts.createChart(graficoEl, {
    width:  graficoEl.clientWidth,
    height: graficoEl.clientHeight,
    layout: {
      background: { color: "#0d1117" },
      textColor:   "#d1d4dc"
    },
    grid: {
      vertLines: { color: "#1e222d" },
      horzLines: { color: "#1e222d" }
    },
    priceScale: {
      scaleMargins: { top: 0.25, bottom: 0.15 }
    },
    timeScale: {
      rightOffset:    RIGHT_OFFSET_BARS,
      barSpacing:     8,
      timeVisible:    true,
      secondsVisible: true
    },
    localization: {
      locale:     "pt-BR",
      dateFormat: "dd/MM/yyyy"
    }
  });

  // overlay do título + logo
  let titleEl = document.getElementById("chart-title");
  if (!titleEl) {
    titleEl = document.createElement("div");
    titleEl.id = "chart-title";
    Object.assign(titleEl.style, {
      position:      "absolute",
      top:           "8px",
      left:          "50%",
      transform:     "translateX(-50%)",
      display:       "flex",
      alignItems:    "center",
      pointerEvents: "none",
      zIndex:        "10"
    });
    graficoEl.appendChild(titleEl);
  }
  const iconUrl = coinIconsMap[COIN] || "";
  titleEl.innerHTML = `
    <img src="${iconUrl}"
         alt="${COIN}"
         style="width:20px;height:20px;margin-right:8px;object-fit:contain;">
    <span style="color:#ffffff;font-weight:bold;font-size:1rem;">
      ${COIN}/USDT
    </span>
  `;

  candleSeries = chart.addCandlestickSeries({
    upColor:       "#26a69a",
    downColor:     "#ef5350",
    borderUpColor: "#26a69a",
    borderDownColor:"#ef5350",
    wickUpColor:   "#26a69a",
    wickDownColor: "#ef5350"
  });

  // histórico inicial de candles
  const resp    = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${pairSymbol}&interval=${TIMEFRAME}&limit=${HIST_LIMIT}`
  );
  const raw     = await resp.json();
  const candles = raw.map(c => ({
    time:  Math.floor(c[0] / 1000) - TZ_OFFSET_SECONDS,
    open:  +c[1],
    high:  +c[2],
    low:   +c[3],
    close: +c[4]
  }));

  // precision dinâmica baseado no último preço
  const lastClose = candles[candles.length - 1].close;
  const precision = getPrecision(lastClose);

  candleSeries.applyOptions({
    priceFormat: {
      type:    "price",
      precision,
      minMove: Math.pow(10, -precision)
    }
  });

  candleSeries.setData(candles);
  chart.timeScale().fitContent();
  chart.timeScale().scrollToRealTime();

  new ResizeObserver(entries => {
    for (const { contentRect } of entries) {
      chart.resize(contentRect.width, contentRect.height);
      chart.timeScale().fitContent();
    }
  }).observe(graficoEl);
}

// ------------ WEBSOCKET COMBINADO ------------
function initWebSocket() {
  const streams = `${pairLower}@kline_${TIMEFRAME}/${pairLower}@depth10@100ms`;
  const socket  = new WebSocket(
    `wss://stream.binance.com:9443/stream?streams=${streams}`
  );

  socket.addEventListener("message", ({ data }) => {
    const { stream, data: d } = JSON.parse(data);

    // candle + preço
    if (stream.endsWith(`@kline_${TIMEFRAME}`)) {
      const k   = d.k;
      const bar = {
        time:  Math.floor(k.t / 1000) - TZ_OFFSET_SECONDS,
        open:  +k.o,
        high:  +k.h,
        low:   +k.l,
        close: +k.c
      };

      candleSeries.update(bar);
      chart.timeScale().scrollToRealTime();

      // formatação de preço com precisão dinâmica
      const pricePrecision = getPrecision(bar.close);
      priceEl.textContent = bar.close.toLocaleString("pt-BR", {
        style:                 "currency",
        currency:              "BRL",
        minimumFractionDigits: pricePrecision,
        maximumFractionDigits: pricePrecision
      });

      // cor conforme alta/queda
      if (bar.close > bar.open) {
        priceEl.style.color = "#26a69a";
      } else if (bar.close < bar.open) {
        priceEl.style.color = "#ef5350";
      } else {
        priceEl.style.color = "#ffffff";
      }
    }

    // depth throttled
    if (stream.endsWith("@depth10@100ms")) {
      scheduleDepth(d);
    }
  });

  socket.addEventListener("error", e => console.error("WS error:", e));
  socket.addEventListener("close", () => {
    console.warn("WS desconectado, recarregando em 5s…");
    setTimeout(() => window.location.reload(), 5000);
  });
}

// --------------- BOOTSTRAP ---------------
window.addEventListener("DOMContentLoaded", async () => {
  await fetchCoinIcons();
  await initChart();
  await fetchInitialDepth();
  initWebSocket();
});