// script.js

// ==================== CONFIG ====================
const moedasDesejadas    = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT"];
const TIMEFRAME          = "1m";
const HIST_LIMIT         = 50;      // reduzido para acelerar o load
const EXTRA_GRAPH_HEIGHT = 50;
const RIGHT_OFFSET_BARS  = 2;
const TZ_OFFSET_SECONDS  = new Date().getTimezoneOffset() * 60;

let chart, candleSeries;
let moedaMaisValorizada, moedaMaisValorizadaPercent;

// ==================== UTIL ====================
const sleep = ms => new Promise(res => setTimeout(res, ms));

// ==================== BUSCA TOP COIN EM PARALELO ====================
async function obterMaisValorizada() {
  const requests = moedasDesejadas.map(symbol =>
    fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=30`
    )
    .then(res => res.json())
    .catch(() => [])
  );

  const results = await Promise.all(requests);
  let melhor = null, melhorPct = -Infinity;

  results.forEach((data, i) => {
    if (!Array.isArray(data) || data.length === 0) return;
    const firstClose = +data[0][4];
    const lastClose  = +data[data.length - 1][4];
    const pct        = ((lastClose - firstClose) / firstClose) * 100;
    if (pct > melhorPct) {
      melhorPct = pct;
      melhor    = moedasDesejadas[i];
    }
  });

  moedaMaisValorizada        = melhor;
  moedaMaisValorizadaPercent = melhorPct.toFixed(2);
}

// ==================== INICIALIZA GRÁFICO E REMOVE PLACEHOLDER ====================
async function inicializarGrafico() {
  await obterMaisValorizada();

  // 1) pega URL do ícone da moeda vencedora na tabela
  const baseSymbol = moedaMaisValorizada.replace("USDT", "");
  const imgElem    = document.querySelector(
    `#crypto-table tbody tr[data-coin="${baseSymbol}"] img`
  );
  const iconUrl    = imgElem ? imgElem.src : "";

  const graficoEl = document.getElementById("grafico");
  graficoEl.style.position = "relative";

  // cria chart
  chart = LightweightCharts.createChart(graficoEl, {
    width:  graficoEl.clientWidth,
    height: graficoEl.clientHeight + EXTRA_GRAPH_HEIGHT,
    layout: {
      background: { color: "#0d1117" },
      textColor:   "#d1d4dc",
    },
    grid: {
      vertLines: { color: "#1e222d" },
      horzLines: { color: "#1e222d" },
    },
    priceScale: {
      scaleMargins: { top: 0.25, bottom: 0.15 },
    },
    timeScale: {
      rightOffset:    RIGHT_OFFSET_BARS,
      barSpacing:     8,
      timeVisible:    true,
      secondsVisible: true,
    },
    localization: {
      locale:     "pt-BR",
      dateFormat: "dd/MM/yyyy",
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor:       "#26a69a",
    downColor:     "#ef5350",
    borderUpColor: "#26a69a",
    borderDownColor: "#ef5350",
    wickUpColor:   "#26a69a",
    wickDownColor: "#ef5350",
  });

  // busca e plota histórico
  const resp        = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${moedaMaisValorizada}&interval=${TIMEFRAME}&limit=${HIST_LIMIT}`
  );
  const rawIntraday = await resp.json();
  const intraday    = rawIntraday.map(c => ({
    time:  Math.floor(c[0] / 1000) - TZ_OFFSET_SECONDS,
    open:  +c[1],
    high:  +c[2],
    low:   +c[3],
    close: +c[4],
  }));

  candleSeries.setData(intraday);

  // remove placeholder de loading
  graficoEl.classList.remove("grafico-loading");

  // enquadra e avança para “agora”
  chart.timeScale().fitContent();
  chart.timeScale().scrollToRealTime();

  // overlay de título + ícone
  let titleEl = document.getElementById("titulo-overlay");
  if (!titleEl) {
    titleEl = document.createElement("div");
    titleEl.id = "titulo-overlay";
    Object.assign(titleEl.style, {
      position:      "absolute",
      top:           "8px",
      left:          "50%",
      transform:     "translateX(-50%)",
      color:         "#fff",
      fontSize:      "16px",
      fontWeight:    "bold",
      pointerEvents: "none",
      zIndex:        "10",
    });
    graficoEl.appendChild(titleEl);
  }

  // img classizada para receber CSS em style.css
  titleEl.innerHTML = `
    <img 
      class="logo-chart"
      src="${iconUrl}" 
      alt="${baseSymbol}"
    />
    Nos últimos 30 dias, a ${baseSymbol} foi a criptomoeda mais valorizada, registrando alta de +${moedaMaisValorizadaPercent}%
  `;

  // conecta WebSocket para ticks em tempo real
  const ws = new WebSocket(
    `wss://stream.binance.com:9443/ws/${moedaMaisValorizada.toLowerCase()}@kline_${TIMEFRAME}`
  );
  ws.onmessage = ({ data }) => {
    const k   = JSON.parse(data).k;
    const bar = {
      time:  Math.floor(k.t / 1000) - TZ_OFFSET_SECONDS,
      open:  +k.o,
      high:  +k.h,
      low:   +k.l,
      close: +k.c,
    };
    candleSeries.update(bar);
    chart.timeScale().scrollToRealTime();
  };

  // responsividade
  new ResizeObserver(entries => {
    for (const { contentRect } of entries) {
      chart.resize(contentRect.width, contentRect.height + EXTRA_GRAPH_HEIGHT);
      chart.timeScale().fitContent();
    }
  }).observe(graficoEl);

  // avança o eixo de tempo a cada segundo
  setInterval(() => chart.timeScale().scrollToRealTime(), 1000);
}

// ==================== ATUALIZAÇÃO DA TABELA 24h ====================
async function atualizar24h() {
  try {
    const res   = await fetch("https://api.binance.com/api/v3/ticker/24hr");
    const dados = await res.json();

    moedasDesejadas.forEach(sym => {
      const item = dados.find(d => d.symbol === sym);
      if (!item) return;

      const base     = sym.slice(0, -4);
      const priceEl  = document.getElementById(`${base}-price`);
      const changeEl = document.getElementById(`${base}-change`);

      const preco = +item.lastPrice;
      const pct   = +item.priceChangePercent;
      const arrow = pct >= 0 ? "▲" : "▼";
      const valor = Math.abs(pct).toFixed(2);

      priceEl.innerHTML         = `<b>$${preco.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}</b>`;
      changeEl.innerHTML        = `${arrow} ${valor}%`;
      changeEl.style.color      = pct >= 0 ? "green" : "red";
      changeEl.style.fontWeight = "bold";
    });
  } catch (e) {
    console.error("Erro 24h:", e);
  }
}

// ==================== BOOTSTRAP ====================
window.addEventListener("DOMContentLoaded", () => {
  // exibe a tabela imediatamente
  atualizar24h();
  // inicia o gráfico em paralelo
  inicializarGrafico();
  // mantém atualização de 24h a cada 5s
  setInterval(atualizar24h, 5000);

  // adiciona clique nas linhas da tabela
  document.querySelectorAll('#crypto-table tbody tr').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      const coin = row.dataset.coin;
      window.location.href = `trade.html?coin=${coin}`;
    });
  });
});