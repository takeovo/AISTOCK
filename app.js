// ===== AI 台股溢價監控系統 (Yahoo Finance 整合版) =====
const AppState = {
  stockData: [], premiumList: [], highOpenList: [], gapList: [],
  arbitrageList: [], predictions: [], isLoading: false,
  refreshTimer: null, refreshInterval: 60, alertThreshold: 5,
  highOpenThreshold: 2, soundEnabled: true, displayLimit: 50,
  lastUpdate: null, mainChart: null, currentChartType: 'premium',
  alertedStocks: new Set()
};

const SECTOR_MAP = {
  '半導體': ['2330','2454','2308','2303','2379','3034','3037','3711','2337','4966','5347','6415'],
  '電子零組件': ['2317','2382','2357','2395','3008','2345','4938','3533','3702'],
  '金融': ['2881','2882','2886','2891','2892'],
  '傳產': ['1301','1303','2002','1101','1102','1216','2207','2105','2201','2211','6505'],
  '電信': ['2412','4904','3045'],
  '航運': ['2609','2615','2603','2610'],
  'ETF': ['0050','0056','00878','00919','00929','006208','00631L','00632R'],
  'AI伺服器': ['6669','3231']
};

const SYMBOL_LIST = [
  '2330.TW','2317.TW','2454.TW','2308.TW','2382.TW','2881.TW','2882.TW','2886.TW','2891.TW','2892.TW',
  '1301.TW','1303.TW','2002.TW','2412.TW','3008.TW','2357.TW','2379.TW','2395.TW','2408.TW','3711.TW',
  '2345.TW','4904.TW','2609.TW','2615.TW','2603.TW','6505.TW','6415.TW','3034.TW','3037.TW','4938.TW',
  '2207.TW','1216.TW','1101.TW','2303.TW','5347.TW','6669.TW','0050.TW','0056.TW','00878.TW','00919.TW',
  '2337.TW','3533.TW','3702.TW','4966.TW','2201.TW','2211.TW','2105.TW','006208.TW','00631L.TW','3231.TW','2610.TW'
];

function formatNumber(num, decimals) {
  decimals = (decimals !== undefined) ? decimals : 2;
  if (num === null || num === undefined || num === '' || isNaN(num)) return '--';
  return parseFloat(num).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatVolume(vol) {
  if (!vol || isNaN(vol)) return '--';
  const v = parseInt(vol);
  if (v >= 10000) return (v / 10000).toFixed(1) + '萬';
  return v.toLocaleString();
}

function getChangeClass(change) {
  if (!change && change !== 0) return 'price-flat';
  const c = parseFloat(change);
  if (c > 0) return 'price-up';
  if (c < 0) return 'price-down';
  return 'price-flat';
}

function getPremiumClass(pct) {
  if (pct >= 5) return 'premium-high';
  if (pct >= 2) return 'premium-mid';
  return 'premium-low';
}

function getHeatmapColor(change) {
  const c = parseFloat(change) || 0;
  if (c >= 5) return { bg: 'rgba(255,71,87,0.9)', text: '#fff' };
  if (c >= 2) return { bg: 'rgba(255,71,87,0.6)', text: '#fff' };
  if (c >= 0.5) return { bg: 'rgba(255,71,87,0.3)', text: '#ffb3b8' };
  if (c > -0.5) return { bg: 'rgba(255,255,255,0.08)', text: '#8892b0' };
  if (c > -2) return { bg: 'rgba(0,255,136,0.3)', text: '#66ffb3' };
  if (c > -5) return { bg: 'rgba(0,255,136,0.6)', text: '#fff' };
  return { bg: 'rgba(0,255,136,0.9)', text: '#fff' };
}

function getCurrentTime() {
  return new Date().toLocaleTimeString('zh-TW', { hour12: false });
}

function isMarketOpen() {
  const now = new Date();
  const day = now.getDay();
  const totalMin = now.getHours() * 60 + now.getMinutes();
  if (day === 0 || day === 6) return false;
  return totalMin >= 540 && totalMin < 810;
}

function isPreMarket() {
  const now = new Date();
  const day = now.getDay();
  const totalMin = now.getHours() * 60 + now.getMinutes();
  if (day === 0 || day === 6) return false;
  return totalMin >= 510 && totalMin < 540;
}

function updateClock() {
  document.getElementById('timeDisplay').textContent = getCurrentTime();
  updateMarketStatus();
}

function updateMarketStatus() {
  const statusEl = document.getElementById('marketStatus');
  const dotEl = document.getElementById('statusDot');
  const textEl = document.getElementById('statusText');
  if (isMarketOpen()) {
    statusEl.className = 'market-status open'; dotEl.className = 'status-dot open'; textEl.textContent = '交易中';
  } else if (isPreMarket()) {
    statusEl.className = 'market-status pre'; dotEl.className = 'status-dot pre'; textEl.textContent = '盤前準備';
  } else {
    statusEl.className = 'market-status closed'; dotEl.className = 'status-dot closed'; textEl.textContent = '已收盤';
  }
}

async function fetchGoodinfoData() {
  try {
    const url = 'https://goodinfo.tw/tw/StockList.asp?MARKET_CAT=%E7%86%B1%E9%96%80%E6%8E%92%E8%A1%8C&INDUSTRY_CAT=%E7%86%B1%E9%96%80%E5%80%8B%E8%82%A1%28%E7%95%B6%E6%97%A5%29';
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const response = await fetch(proxyUrl + encodeURIComponent(url), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Goodinfo request failed');
    const wrapper = await response.json();
    const html = wrapper.contents;
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tr[id^="row"]');
    
    if (rows.length > 0) {
      const results = [];
      rows.forEach(function(row) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 10) {
          results.push({
            code: cells[1].innerText.trim(),
            name: cells[2].innerText.trim(),
            price: parseFloat(cells[3].innerText.trim()) || 0,
            change: parseFloat(cells[5].innerText.trim()) || 0,
            changePct: parseFloat(cells[6].innerText.trim()) || 0,
            volume: parseInt(cells[8].innerText.replace(/,/g, '')) || 0,
            open: parseFloat(cells[9].innerText.trim()) || 0,
            high: parseFloat(cells[10].innerText.trim()) || 0,
            low: parseFloat(cells[11].innerText.trim()) || 0
          });
        }
      });
      console.log('Goodinfo data parsed successfully:', results.length, 'stocks');
      return { source: 'Goodinfo', data: results };
    }
    return null;
  } catch (err) {
    console.warn('Goodinfo data fetch failed:', err.message);
    return null;
  }
}

async function fetchTWSERealtimeData() {
  try {
    const stockCodes = ['2330','2317','2454','2308','2382','2881','2882','2886','2891','2892',
      '1301','1303','2002','2412','3008','2357','2379','2395','2408','3711',
      '2345','4904','2609','2615','2603','6505','6415','3034','3037','4938',
      '2207','1216','1101','2303','5347','6669','0050','0056','00878','00919',
      '2337','3533','3702','4966','2201','2211','2105','006208','00631L','3231','2610'];
    
    const ex_ch = stockCodes.map(function(c) { return 'tse_' + c + '.tw'; }).join('|');
    const apiUrl = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' + encodeURIComponent(ex_ch) + '&json=1&delay=0';
    
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const response = await fetch(proxyUrl + encodeURIComponent(apiUrl), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('TWSE API failed');
    const wrapper = await response.json();
    const data = JSON.parse(wrapper.contents);
    
    if (data.msgArray && Array.isArray(data.msgArray)) {
      console.log('TWSE real-time data fetched successfully:', data.msgArray.length, 'stocks');
      return { source: 'TWSE', data: data.msgArray };
    }
    return null;
  } catch (err) {
    console.warn('TWSE real-time API failed:', err.message);
    return null;
  }
}

async function fetchYahooFinanceData() {
  try {
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const symbols = SYMBOL_LIST.join(',');
    const apiUrl = encodeURIComponent(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`);
    const response = await fetch(proxyUrl + apiUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('API failed');
    const wrapper = await response.json();
    const data = JSON.parse(wrapper.contents);
    if (data.quoteResponse && data.quoteResponse.result) {
      console.log('Yahoo Finance data fetched successfully');
      return { source: 'Yahoo', data: data.quoteResponse.result };
    }
    return null;
  } catch (err) {
    console.warn('Yahoo Finance API failed:', err.message);
    return null;
  }
}

function generateMockData() {
  const stocks = [
    {code:'2330',name:'台積電',sector:'半導體',basePrice:1865},
    {code:'2317',name:'鴻海',sector:'電子零組件',basePrice:215},
    {code:'2454',name:'聯發科',sector:'半導體',basePrice:1280},
    {code:'2308',name:'台達電',sector:'電子零組件',basePrice:385},
    {code:'2382',name:'廣達',sector:'AI伺服器',basePrice:310},
    {code:'2881',name:'富邦金',sector:'金融',basePrice:98},
    {code:'2882',name:'國泰金',sector:'金融',basePrice:62},
    {code:'2886',name:'兆豐金',sector:'金融',basePrice:44},
    {code:'2891',name:'中信金',sector:'金融',basePrice:38},
    {code:'2892',name:'第一金',sector:'金融',basePrice:35},
    {code:'1301',name:'台塑',sector:'傳產',basePrice:82},
    {code:'1303',name:'南亞',sector:'傳產',basePrice:68},
    {code:'2002',name:'中鋼',sector:'傳產',basePrice:28},
    {code:'2412',name:'中華電',sector:'電信',basePrice:128},
    {code:'3008',name:'大立光',sector:'電子零組件',basePrice:2450},
    {code:'2357',name:'華碩',sector:'電子零組件',basePrice:540},
    {code:'2379',name:'瑞昱',sector:'半導體',basePrice:680},
    {code:'2395',name:'研華',sector:'電子零組件',basePrice:420},
    {code:'2408',name:'南亞科',sector:'半導體',basePrice:98},
    {code:'3711',name:'日月光投控',sector:'半導體',basePrice:168},
    {code:'2345',name:'智邦',sector:'電子零組件',basePrice:620},
    {code:'4904',name:'遠傳',sector:'電信',basePrice:82},
    {code:'2609',name:'陽明',sector:'航運',basePrice:72},
    {code:'2615',name:'萬海',sector:'航運',basePrice:68},
    {code:'2603',name:'長榮',sector:'航運',basePrice:198},
    {code:'6505',name:'台塑化',sector:'傳產',basePrice:92},
    {code:'6415',name:'矽力-KY',sector:'半導體',basePrice:1580},
    {code:'3034',name:'聯詠',sector:'半導體',basePrice:520},
    {code:'3037',name:'欣興',sector:'電子零組件',basePrice:185},
    {code:'4938',name:'和碩',sector:'電子零組件',basePrice:88},
    {code:'2207',name:'和泰車',sector:'傳產',basePrice:680},
    {code:'1216',name:'統一',sector:'傳產',basePrice:78},
    {code:'1101',name:'台泥',sector:'傳產',basePrice:42},
    {code:'2303',name:'聯電',sector:'半導體',basePrice:58},
    {code:'5347',name:'世界',sector:'半導體',basePrice:98},
    {code:'6669',name:'緯穎',sector:'AI伺服器',basePrice:3200},
    {code:'0050',name:'元大台灣50',sector:'ETF',basePrice:192},
    {code:'0056',name:'元大高股息',sector:'ETF',basePrice:38.5},
    {code:'00878',name:'國泰永續高股息',sector:'ETF',basePrice:22.5},
    {code:'00919',name:'群益台灣精選高息',sector:'ETF',basePrice:18.8},
    {code:'2337',name:'旺宏',sector:'半導體',basePrice:68},
    {code:'3533',name:'嘉澤',sector:'電子零組件',basePrice:890},
    {code:'3702',name:'大聯大',sector:'電子零組件',basePrice:82},
    {code:'4966',name:'譜瑞-KY',sector:'半導體',basePrice:1280},
    {code:'2201',name:'裕隆',sector:'傳產',basePrice:58},
    {code:'2211',name:'長榮鋼',sector:'傳產',basePrice:38},
    {code:'2105',name:'正新',sector:'傳產',basePrice:52},
    {code:'006208',name:'富邦台50',sector:'ETF',basePrice:177},
    {code:'00631L',name:'元大台灣50正2',sector:'ETF',basePrice:470},
    {code:'3231',name:'緯創',sector:'AI伺服器',basePrice:128},
    {code:'2610',name:'華航',sector:'航運',basePrice:28}
  ];
  const now = Date.now();
  return stocks.map(function(s) {
    const seed = s.code.split('').reduce(function(a,c){return a+c.charCodeAt(0);},0);
    const r = function() { const x = Math.sin(seed + now/100000) * 10000; return x - Math.floor(x); };
    const changePct = (r() - 0.45) * 12;
    const change = s.basePrice * changePct / 100;
    const close = s.basePrice + change;
    const open = s.basePrice * (1 + (r() - 0.48) * 0.04);
    const high = Math.max(open, close) * (1 + r() * 0.015);
    const low = Math.min(open, close) * (1 - r() * 0.015);
    const volume = Math.floor(r() * 80000 + 500);
    return {
      code: s.code, name: s.name, sector: s.sector,
      openPrice: parseFloat(open.toFixed(2)),
      highPrice: parseFloat(high.toFixed(2)),
      lowPrice: parseFloat(low.toFixed(2)),
      closePrice: parseFloat(close.toFixed(2)),
      prevClose: s.basePrice,
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePct.toFixed(2)),
      volume: volume,
      premiumPct: parseFloat(changePct.toFixed(2)),
      isRealtime: false
    };
  });
}

function processStockData(rawData, source) {
  if (!rawData || rawData.length === 0) return generateMockData();
  
  if (source === 'Goodinfo') {
    return rawData.map(function(s) {
      const prevClose = s.price - s.change;
      return {
        code: s.code, name: s.name, sector: getSector(s.code),
        openPrice: s.open, highPrice: s.high, lowPrice: s.low,
        closePrice: s.price, prevClose: prevClose, change: s.change,
        changePercent: s.changePct,
        volume: s.volume, premiumPct: s.changePct, isRealtime: true
      };
    });
  } else if (source === 'TWSE') {
    return rawData.map(function(s) {
      const fields = s.split('|');
      if (fields.length < 9) return null;
      
      const code = fields[0].replace('tse_', '').replace('.tw', '');
      const name = fields[1];
      const openPrice = parseFloat(fields[3]) || 0;
      const highPrice = parseFloat(fields[4]) || 0;
      const lowPrice = parseFloat(fields[5]) || 0;
      const closePrice = parseFloat(fields[2]) || 0;
      const prevClose = parseFloat(fields[6]) || closePrice;
      const change = closePrice - prevClose;
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
      const volume = parseInt(fields[8].replace(/,/g, '')) || 0;
      
      return {
        code: code, name: name, sector: getSector(code),
        openPrice: openPrice, highPrice: highPrice, lowPrice: lowPrice,
        closePrice: closePrice, prevClose: prevClose, change: change,
        changePercent: parseFloat(changePct.toFixed(2)),
        volume: volume, premiumPct: parseFloat(changePct.toFixed(2)), isRealtime: true
      };
    }).filter(function(s) { return s !== null; });
  } else if (source === 'Yahoo') {
    return rawData.map(function(s) {
      const close = s.regularMarketPrice || 0;
      const open = s.regularMarketOpen || close;
      const high = s.regularMarketDayHigh || close;
      const low = s.regularMarketDayLow || close;
      const prevClose = s.regularMarketPreviousClose || close;
      const change = s.regularMarketChange || 0;
      const changePct = s.regularMarketChangePercent || 0;
      const volume = s.regularMarketVolume || 0;
      const code = s.symbol.replace('.TW', '');
      
      return {
        code: code, name: s.shortName || s.longName || code, sector: getSector(code),
        openPrice: open, highPrice: high, lowPrice: low,
        closePrice: close, prevClose: prevClose, change: change,
        changePercent: parseFloat(changePct.toFixed(2)),
        volume: volume, premiumPct: parseFloat(changePct.toFixed(2)), isRealtime: true
      };
    });
  }
  
  return generateMockData();
}

function getSector(code) {
  for (const sector in SECTOR_MAP) {
    if (SECTOR_MAP[sector].indexOf(code) !== -1) return sector;
  }
  return '其他';
}

function detectHighOpen(stocks) {
  return stocks
    .filter(function(s){ return s.prevClose > 0 && ((s.openPrice - s.prevClose) / s.prevClose * 100) >= AppState.highOpenThreshold; })
    .map(function(s){ return Object.assign({}, s, { highOpenPct: parseFloat(((s.openPrice - s.prevClose) / s.prevClose * 100).toFixed(2)) }); })
    .sort(function(a,b){ return b.highOpenPct - a.highOpenPct; })
    .slice(0, AppState.displayLimit);
}

function detectGaps(stocks) {
  const gaps = [];
  stocks.forEach(function(s) {
    if (!s.openPrice || !s.prevClose || s.prevClose <= 0) return;
    const prevHigh = s.prevClose * 1.015;
    const prevLow = s.prevClose * 0.985;
    if (s.openPrice > prevHigh) {
      gaps.push(Object.assign({}, s, { gapType: 'up', gapSize: parseFloat(((s.openPrice - prevHigh) / prevHigh * 100).toFixed(2)), refPrice: prevHigh }));
    } else if (s.openPrice < prevLow) {
      gaps.push(Object.assign({}, s, { gapType: 'down', gapSize: parseFloat(((prevLow - s.openPrice) / prevLow * 100).toFixed(2)), refPrice: prevLow }));
    }
  });
  return gaps.sort(function(a,b){ return b.gapSize - a.gapSize; }).slice(0, AppState.displayLimit);
}

function detectArbitrage(stocks) {
  return stocks
    .filter(function(s){ return Math.abs(s.premiumPct) >= AppState.alertThreshold; })
    .map(function(s){
      let risk = '低';
      if (Math.abs(s.premiumPct) > 8) risk = '高';
      else if (Math.abs(s.premiumPct) > 5) risk = '中';
      return Object.assign({}, s, { arbitrageRisk: risk });
    })
    .sort(function(a,b){ return Math.abs(b.premiumPct) - Math.abs(a.premiumPct); })
    .slice(0, AppState.displayLimit);
}

function generateAIPredictions(stocks) {
  return stocks.slice(0, 15).map(function(s) {
    const prob = 40 + (Math.abs(s.changePercent) * 5) + (s.volume > 5000 ? 15 : 0);
    return {
      code: s.code, name: s.name,
      burstProbability: Math.min(99, Math.floor(prob)),
      reason: s.changePercent > 3 ? '高開強勢且量能增溫' : '價格震盪劇烈，買盤湧入',
      sentiment: s.changePercent > 0 ? '看多' : '看空'
    };
  }).sort(function(a,b){ return b.burstProbability - a.burstProbability; });
}

function checkAlerts(stocks) {
  stocks.forEach(function(s) {
    if (Math.abs(s.premiumPct) >= AppState.alertThreshold && !AppState.alertedStocks.has(s.code)) {
      AppState.alertedStocks.add(s.code);
      triggerAlert(s);
    }
  });
}

function triggerAlert(stock) {
  const alertContainer = document.getElementById('alertBanner');
  alertContainer.innerHTML = `🚨 警報：${stock.name} (${stock.code}) 溢價已達 ${stock.premiumPct}%！請注意風險。`;
  alertContainer.classList.add('active');
  
  showNotification('warning', '溢價警報', `${stock.name} 溢價過高 (${stock.premiumPct}%)`);
  
  if (AppState.soundEnabled) {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.play().catch(function(e){ console.log('Audio play failed'); });
  }
  
  setTimeout(function(){ alertContainer.classList.remove('active'); }, 8000);
}

function showNotification(type, title, message) {
  const container = document.getElementById('notificationContainer');
  const id = 'notif-' + Date.now();
  const html = `
    <div id="${id}" class="notification ${type}">
      <div class="notif-title">${title}</div>
      <div class="notif-message">${message}</div>
    </div>
  `;
  container.insertAdjacentHTML('afterbegin', html);
  setTimeout(function(){
    const el = document.getElementById(id);
    if (el) { el.style.opacity = '0'; setTimeout(function(){ el.remove(); }, 500); }
  }, 5000);
}

function renderPremiumTable(stocks) {
  const tbody = document.getElementById('premiumTableBody');
  tbody.innerHTML = '';
  stocks.sort(function(a,b){ return b.premiumPct - a.premiumPct; }).slice(0, AppState.displayLimit).forEach(function(s, idx) {
    const medal = idx === 0 ? '🥇 ' : (idx === 1 ? '🥈 ' : (idx === 2 ? '🥉 ' : ''));
    const row = `
      <tr>
        <td>${medal}${s.code}</td>
        <td>${s.name}</td>
        <td class="${getChangeClass(s.closePrice - s.prevClose)}">${formatNumber(s.closePrice)}</td>
        <td class="${getChangeClass(s.changePercent)}">${s.changePercent > 0 ? '+' : ''}${s.changePercent}%</td>
        <td class="${getPremiumClass(s.premiumPct)}">${s.premiumPct > 0 ? '+' : ''}${s.premiumPct}%</td>
        <td>${formatVolume(s.volume)}</td>
        <td><span class="badge ${s.isRealtime ? 'badge-realtime' : 'badge-mock'}">${s.isRealtime ? '即時' : '模擬'}</span></td>
      </tr>
    `;
    tbody.insertAdjacentHTML('beforeend', row);
  });
}

function renderHighOpenTable(stocks) {
  const tbody = document.getElementById('highOpenTableBody');
  tbody.innerHTML = '';
  const highOpens = detectHighOpen(stocks);
  if (highOpens.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#8892b0;">目前無高開標的</td></tr>';
    return;
  }
  highOpens.forEach(function(s) {
    const row = `
      <tr>
        <td>${s.code}</td>
        <td>${s.name}</td>
        <td>${formatNumber(s.prevClose)}</td>
        <td class="price-up">${formatNumber(s.openPrice)}</td>
        <td class="price-up">+${s.highOpenPct}%</td>
      </tr>
    `;
    tbody.insertAdjacentHTML('beforeend', row);
  });
}

function renderGapTable(stocks) {
  const tbody = document.getElementById('gapTableBody');
  tbody.innerHTML = '';
  const gaps = detectGaps(stocks);
  if (gaps.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#8892b0;">目前無明顯跳空標的</td></tr>';
    return;
  }
  gaps.forEach(function(s) {
    const type = s.gapType === 'up' ? '<span class="price-up">向上</span>' : '<span class="price-down">向下</span>';
    const row = `
      <tr>
        <td>${s.code}</td>
        <td>${s.name}</td>
        <td>${type}</td>
        <td>${s.gapSize}%</td>
        <td>${formatNumber(s.openPrice)}</td>
      </tr>
    `;
    tbody.insertAdjacentHTML('beforeend', row);
  });
}

function renderArbitrageTable(stocks) {
  const tbody = document.getElementById('arbitrageTableBody');
  tbody.innerHTML = '';
  const arb = detectArbitrage(stocks);
  if (arb.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#8892b0;">目前無明顯套利機會</td></tr>';
    return;
  }
  arb.forEach(function(s) {
    const riskClass = s.arbitrageRisk === '高' ? 'price-down' : (s.arbitrageRisk === '中' ? 'premium-mid' : 'price-up');
    const row = `
      <tr>
        <td>${s.code}</td>
        <td>${s.name}</td>
        <td class="${getPremiumClass(s.premiumPct)}">${s.premiumPct}%</td>
        <td class="${riskClass}">${s.arbitrageRisk}</td>
        <td><button class="btn-primary" style="padding:2px 8px;font-size:12px;">分析</button></td>
      </tr>
    `;
    tbody.insertAdjacentHTML('beforeend', row);
  });
}

function renderAIAnalysis(stocks) {
  const container = document.getElementById('aiAnalysisContent');
  const predictions = generateAIPredictions(stocks);
  let html = '<div class="ai-card-grid">';
  predictions.slice(0, 6).forEach(function(p) {
    const color = p.sentiment === '看多' ? '#ff4757' : '#00ff88';
    html += `
      <div class="ai-prediction-card">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
          <span style="font-weight:bold;color:#fff;">${p.name} (${p.code})</span>
          <span style="color:${color}">${p.sentiment}</span>
        </div>
        <div class="progress-container">
          <div class="progress-bar" style="width:${p.burstProbability}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:5px;">
          <span>爆量機率</span>
          <span style="color:#00d2ff;font-weight:bold;">${p.burstProbability}%</span>
        </div>
        <div style="font-size:12px;color:#8892b0;margin-top:10px;line-height:1.4;">
          AI 觀點：${p.reason}
        </div>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderHeatmap(stocks) {
  const container = document.getElementById('heatmapContent');
  container.innerHTML = '';
  stocks.slice(0, 51).forEach(function(s) {
    const color = getHeatmapColor(s.changePercent);
    const box = `
      <div class="heatmap-box" style="background-color:${color.bg};color:${color.text};" title="${s.name} ${s.changePercent}%">
        <div style="font-size:11px;font-weight:bold;">${s.code}</div>
        <div style="font-size:10px;">${s.changePercent}%</div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', box);
  });
}

function updateCharts(stocks) {
  const ctx = document.getElementById('mainChart').getContext('2d');
  const type = AppState.currentChartType;
  let data, labels, label, colors;
  
  if (type === 'premium') {
    const sorted = stocks.sort(function(a,b){ return b.premiumPct - a.premiumPct; }).slice(0, 10);
    labels = sorted.map(function(s){ return s.name; });
    data = sorted.map(function(s){ return s.premiumPct; });
    label = '溢價幅度 (%)';
    colors = 'rgba(0, 210, 255, 0.6)';
  } else if (type === 'volume') {
    const sorted = stocks.sort(function(a,b){ return b.volume - a.volume; }).slice(0, 10);
    labels = sorted.map(function(s){ return s.name; });
    data = sorted.map(function(s){ return s.volume / 1000; });
    label = '成交量 (千張)';
    colors = 'rgba(255, 71, 87, 0.6)';
  } else {
    const sectors = {};
    stocks.forEach(function(s){ sectors[s.sector] = (sectors[s.sector] || 0) + 1; });
    labels = Object.keys(sectors);
    data = Object.values(sectors);
    label = '類股分布';
    colors = ['#ff4757', '#2ed573', '#1e90ff', '#ffa502', '#3742fa', '#747d8c', '#a4b0be', '#f1f2f6'];
  }
  
  if (AppState.mainChart) AppState.mainChart.destroy();
  
  AppState.mainChart = new Chart(ctx, {
    type: type === 'sector' ? 'pie' : 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: label,
        data: data,
        backgroundColor: colors,
        borderColor: Array.isArray(colors) ? '#1a1d2e' : colors.replace('0.6', '1'),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: type === 'sector', labels: { color: '#8892b0' } } },
      scales: type === 'sector' ? {} : {
        y: { ticks: { color: '#8892b0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { ticks: { color: '#8892b0' }, grid: { display: false } }
      }
    }
  });
}

async function refreshData() {
  if (AppState.isLoading) return;
  AppState.isLoading = true;
  document.getElementById('refreshBtn').innerHTML = '<span class="loading-spinner"></span> 載入中...';
  
  let result = await fetchGoodinfoData();
  let processed;
  
  if (result && result.data && result.data.length > 0) {
    processed = processStockData(result.data, 'Goodinfo');
    showNotification('success', '資料來源', '已連接 Goodinfo! 即時行情');
  } else {
    console.log('Goodinfo unavailable, trying TWSE...');
    result = await fetchTWSERealtimeData();
    if (result && result.data && result.data.length > 0) {
      processed = processStockData(result.data, 'TWSE');
      showNotification('info', '資料來源', '已連接 TWSE 官方即時 API');
    } else {
      console.log('TWSE API unavailable, trying Yahoo Finance...');
      result = await fetchYahooFinanceData();
      if (result && result.data && result.data.length > 0) {
        processed = processStockData(result.data, 'Yahoo');
        showNotification('info', '資料來源', '已連接 Yahoo Finance API');
      } else {
        console.log('All APIs unavailable, using mock data');
        processed = generateMockData();
        showNotification('warning', '資料來源', '使用模擬數據（實時 API 暫時無法連接）');
      }
    }
  }
  
  AppState.stockData = processed;
  AppState.lastUpdate = new Date();
  
  renderPremiumTable(processed);
  renderHighOpenTable(processed);
  renderGapTable(processed);
  renderArbitrageTable(processed);
  renderAIAnalysis(processed);
  renderHeatmap(processed);
  updateCharts(processed);
  checkAlerts(processed);
  
  AppState.isLoading = false;
  document.getElementById('refreshBtn').innerHTML = '🔄 立即刷新';
  document.getElementById('lastUpdate').textContent = '最後更新：' + AppState.lastUpdate.toLocaleTimeString();
}

function switchChart(type) {
  AppState.currentChartType = type;
  document.querySelectorAll('.chart-btn').forEach(function(btn){ btn.classList.remove('active'); });
  event.target.classList.add('active');
  updateCharts(AppState.stockData);
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
  document.getElementById(tabId).classList.add('active');
  event.target.classList.add('active');
}

function updateRefreshInterval(interval) {
  AppState.refreshInterval = interval;
  if (AppState.refreshTimer) { clearInterval(AppState.refreshTimer); AppState.refreshTimer = null; }
  if (interval > 0) {
    AppState.refreshTimer = setInterval(refreshData, interval * 1000);
    showNotification('info', '設定已更新', '自動刷新間隔設為 ' + interval + ' 秒');
  } else {
    showNotification('info', '設定已更新', '已關閉自動刷新');
  }
}

function setupSettingsListeners() {
  document.getElementById('alertThreshold').addEventListener('change', function() {
    AppState.alertThreshold = parseFloat(this.value); AppState.alertedStocks.clear();
    if (AppState.stockData.length > 0) { renderPremiumTable(AppState.stockData); renderArbitrageTable(AppState.stockData); }
  });
  document.getElementById('highOpenThreshold').addEventListener('change', function() {
    AppState.highOpenThreshold = parseFloat(this.value);
    if (AppState.stockData.length > 0) renderHighOpenTable(AppState.stockData);
  });
  document.getElementById('soundAlert').addEventListener('change', function() { AppState.soundEnabled = this.checked; });
  document.getElementById('displayLimit').addEventListener('change', function() {
    AppState.displayLimit = parseInt(this.value);
    if (AppState.stockData.length > 0) renderPremiumTable(AppState.stockData);
  });
}

function init() {
  updateClock();
  setInterval(updateClock, 1000);
  setupSettingsListeners();
  refreshData();
  AppState.refreshTimer = setInterval(refreshData, AppState.refreshInterval * 1000);
  setTimeout(function(){ showNotification('success', '系統啟動成功', 'AI 台股溢價監控系統已就緒，開始監控市場...'); }, 1000);
}

document.addEventListener('DOMContentLoaded', init);
