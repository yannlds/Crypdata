// script_criptos.js

// Elementos do DOM
const tabelaBody          = document.querySelector('#crypto-table-list tbody');
const paginationContainer = document.getElementById('pagination-controls');
const searchInput         = document.getElementById('search-crypto');

// Estado da aplicação
let allMoedas    = [];
let searchTerm   = '';
let currentPage  = 1;
const perPage    = 10;
let totalPages   = 1;
const coinIconsMap = {}; // símbolo → URL do ícone

// 1) Carrega ícones via CoinGecko
async function fetchCoinIcons() {
  console.log('> fetchCoinIcons');
  const pages = [1, 2];
  await Promise.all(pages.map(async page => {
    const url = new URL('https://api.coingecko.com/api/v3/coins/markets');
    url.searchParams.set('vs_currency', 'usd');
    url.searchParams.set('order', 'market_cap_desc');
    url.searchParams.set('per_page', '250');
    url.searchParams.set('page', String(page));
    url.searchParams.set('sparkline', 'false');

    const res   = await fetch(url);
    const dados = await res.json();
    dados.forEach(c => {
      coinIconsMap[c.symbol.toUpperCase()] = c.image;
    });
  }));
}

// 2) Busca tickers Binance e popula allMoedas
async function fetchMoedas() {
  console.log('> fetchMoedas');
  const res   = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  const dados = await res.json();

  allMoedas = dados
    .filter(m => m.symbol.endsWith('USDT'))
    .map(m => ({
      ...m,
      symbolClean: m.symbol.replace(/USDT$/, '')
    }))
    // remove todas as moedas que não têm logo no coinIconsMap
    .filter(m => coinIconsMap[m.symbolClean])
    .filter(m =>
      +m.lastPrice   > 0 &&
      +m.volume      > 0 &&
      +m.quoteVolume > 0 &&
      m.count        > 0
    );

  renderPage(currentPage);
}

// 3) Captura busca e renderiza página 1
searchInput.addEventListener('input', () => {
  searchTerm = searchInput.value.trim().toUpperCase();
  renderPage(1);
});

// 4) Renderiza uma página da tabela
function renderPage(page) {
  const filtered = allMoedas.filter(m =>
    m.symbolClean.includes(searchTerm)
  );

  totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  if (page > totalPages) page = totalPages;
  currentPage = page;

  tabelaBody.innerHTML = '';
  const start     = (currentPage - 1) * perPage;
  const pageItems = filtered.slice(start, start + perPage);

  pageItems.forEach(moeda => {
    const price = parseFloat(moeda.lastPrice)
      .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const pct      = +moeda.priceChangePercent;
    const variac   = Math.abs(pct).toFixed(2);
    const arrow    = pct >= 0 ? '▲' : '▼';
    const cssClass = pct >= 0 ? 'var-positive' : 'var-negative';

    const high     = parseFloat(moeda.highPrice)
      .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const low      = parseFloat(moeda.lowPrice)
      .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const volUSDT  = parseFloat(moeda.quoteVolume)
      .toLocaleString('pt-BR', { maximumFractionDigits: 0 });

    const volBase  = parseFloat(moeda.volume)
      .toLocaleString('pt-BR', { maximumFractionDigits: 2 });

    const trades   = moeda.count;
    const iconUrl  = coinIconsMap[moeda.symbolClean];

    const tr = document.createElement('tr');
    tr.dataset.coin = moeda.symbolClean;  // marca moeda

    tr.innerHTML = `
      <td>
        <img src="${iconUrl}"
             alt="${moeda.symbolClean}"
             class="logo-crypto"
             width="20"
             height="20"
             style="vertical-align: middle; margin-right: 8px;">
        ${moeda.symbolClean}
      </td>
      <td>${price}</td>
      <td class="${cssClass}">${arrow} ${variac}%</td>
      <td>${high}</td>
      <td>${low}</td>
      <td>${volUSDT}</td>
      <td>${volBase}</td>
      <td>${trades}</td>
    `;

    tabelaBody.appendChild(tr);
  });

  updatePaginationControls();
}

// 5) Atualiza controles de paginação
function updatePaginationControls() {
  paginationContainer.innerHTML = '';
  const createBtn = (text, page, disabled = false) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.disabled    = disabled;
    if (!disabled) btn.onclick = () => renderPage(page);
    return btn;
  };

  paginationContainer.appendChild(
    createBtn('Anterior', currentPage - 1, currentPage === 1)
  );

  const delta = 2;
  let startPage = Math.max(1, currentPage - delta);
  let endPage   = Math.min(totalPages, currentPage + delta);

  if (currentPage <= delta) {
    endPage = Math.min(totalPages, endPage + (delta - currentPage + 1));
  }
  if (currentPage + delta > totalPages) {
    startPage = Math.max(1, startPage - (currentPage + delta - totalPages));
  }

  if (startPage > 1) {
    paginationContainer.appendChild(createBtn('1', 1));
    if (startPage > 2) {
      const ell = document.createElement('span');
      ell.textContent = '…';
      paginationContainer.appendChild(ell);
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    paginationContainer.appendChild(
      createBtn(String(i), i, i === currentPage)
    );
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      const ell = document.createElement('span');
      ell.textContent = '…';
      paginationContainer.appendChild(ell);
    }
    paginationContainer.appendChild(
      createBtn(String(totalPages), totalPages)
    );
  }

  paginationContainer.appendChild(
    createBtn('Próximo', currentPage + 1, currentPage === totalPages)
  );
}

// 6) Bootstrap
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await fetchCoinIcons();
  } catch (e) {
    console.warn('Coin icons falharam:', e);
  }

  await fetchMoedas();
  setInterval(fetchMoedas, 5000);

  // Clique na linha leva ao trade na mesma aba
  tabelaBody.style.cursor = 'pointer';
  tabelaBody.addEventListener('click', event => {
    const tr = event.target.closest('tr[data-coin]');
    if (!tr) return;
    const coin = tr.dataset.coin;
    console.log('Navegando para trade.html?coin=' + coin);
    window.location.href = `trade.html?coin=${coin}`;
  });
});