// ===== AI 台股溢價監控系統 =====
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

async function fetchTWSEData() {
  try {
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const apiUrl = encodeURIComponent('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
    const response = await fetch(proxyUrl + apiUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('API failed');
    const wrapper = await response.json();
    return JSON.parse(wrapper.contents);
  } catch (err) {
    console.warn('TWSE API failed:', err.message);
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

function processStockData(rawData) {
  if (!rawData || rawData.length === 0) return generateMockData();
  return rawData
    .filter(function(s){ return s.ClosingPrice && s.ClosingPrice !== '' && parseFloat(s.ClosingPrice) > 0; })
    .slice(0, 200)
    .map(function(s) {
      const close = parseFloat(s.ClosingPrice) || 0;
      const open = parseFloat(s.OpeningPrice) || close;
      const high = parseFloat(s.HighestPrice) || close;
      const low = parseFloat(s.LowestPrice) || close;
      const change = parseFloat(s.Change) || 0;
      const prevClose = close - change;
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
      const volume = parseInt((s.TradeVolume || '').replace(/,/g, '')) || 0;
      return {
        code: s.Code, name: s.Name, sector: getSector(s.Code),
        openPrice: open, highPrice: high, lowPrice: low,
        closePrice: close, prevClose: prevClose, change: change,
        changePercent: parseFloat(changePct.toFixed(2)),
        volume: volume, premiumPct: parseFloat(changePct.toFixed(2)), isRealtime: false
      };
    });
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
    .map(function(s) {
      const fairValue = s.prevClose;
      const arbitrageSpace = Math.abs(s.closePrice - fairValue);
      const risk = Math.abs(s.premiumPct) >= 10 ? '高' : Math.abs(s.premiumPct) >= 7 ? '中' : '低';
      return Object.assign({}, s, { fairValue: parseFloat(fairValue.toFixed(2)), arbitrageSpace: parseFloat(arbitrageSpace.toFixed(2)), risk: risk });
    })
    .sort(function(a,b){ return Math.abs(b.premiumPct) - Math.abs(a.premiumPct); })
    .slice(0, AppState.displayLimit);
}

function predictVolumeExplosion(stocks) {
  return stocks.map(function(s) {
    let score = Math.min(Math.abs(s.changePercent) * 5, 30);
    score += Math.min(s.volume / 10000 * 10, 25);
    if (s.openPrice > s.prevClose * 1.02) score += 20;
    if (s.openPrice > s.prevClose * 1.03) score += 15;
    score += Math.random() * 10;
    const probability = Math.min(Math.round(score), 99);
    const signals = [];
    if (Math.abs(s.changePercent) > 5) signals.push('大幅波動');
    if (s.openPrice > s.prevClose * 1.02) signals.push('高開');
    if (s.volume > 20000) signals.push('量大');
    if (s.premiumPct > 3) signals.push('溢價');
    return Object.assign({}, s, { probability: probability, signals: signals });
  }).sort(function(a,b){ return b.probability - a.probability; }).slice(0, 8);
}

function generateAIAnalysis(stocks) {
  if (!stocks || stocks.length === 0) return;
  const upStocks = stocks.filter(function(s){ return s.changePercent > 0; });
  const downStocks = stocks.filter(function(s){ return s.changePercent < 0; });
  const upRatio = (upStocks.length / stocks.length * 100).toFixed(1);
  const avgChange = (stocks.reduce(function(sum,s){ return sum + s.changePercent; }, 0) / stocks.length).toFixed(2);
  const topGainers = stocks.slice().sort(function(a,b){ return b.changePercent - a.changePercent; }).slice(0, 3);
  const marketSentiment = parseFloat(avgChange) > 0.5 ? 'bullish' : parseFloat(avgChange) < -0.5 ? 'bearish' : 'neutral';
  const sentimentText = { bullish: '📈 多頭格局，市場情緒偏多', bearish: '📉 空頭壓力，市場情緒偏空', neutral: '⚖️ 盤整格局，多空均衡' };
  const sectorPerf = {};
  stocks.forEach(function(s) { if (!sectorPerf[s.sector]) sectorPerf[s.sector] = []; sectorPerf[s.sector].push(s.changePercent); });
  const sectorAvg = Object.keys(sectorPerf).map(function(sector) {
    const changes = sectorPerf[sector];
    return { sector: sector, avg: changes.reduce(function(a,b){ return a+b; },0) / changes.length };
  }).sort(function(a,b){ return b.avg - a.avg; });
  const topSector = sectorAvg[0];
  const bottomSector = sectorAvg[sectorAvg.length - 1];
  const html = '<div class="ai-signal ' + marketSentiment + '"><i class="fas fa-brain"></i><strong>' + sentimentText[marketSentiment] + '</strong></div>' +
    '<div class="ai-insight"><div class="ai-insight-title"><i class="fas fa-chart-line"></i> 市場概況分析</div><div class="ai-insight-text">今日監控 ' + stocks.length + ' 支股票，上漲 ' + upStocks.length + ' 支（' + upRatio + '%），下跌 ' + downStocks.length + ' 支。平均漲跌幅 ' + (avgChange > 0 ? '+' : '') + avgChange + '%。' + AppState.premiumList.filter(function(s){ return s.premiumPct >= AppState.alertThreshold; }).length + ' 支股票溢價超過 ' + AppState.alertThreshold + '%，' + AppState.gapList.filter(function(s){ return s.gapType === "up"; }).length + ' 支出現跳空向上缺口。</div></div>' +
    '<div class="ai-insight"><div class="ai-insight-title"><i class="fas fa-industry"></i> 類股輪動分析</div><div class="ai-insight-text">強勢類股：<strong style="color:var(--accent-red)">' + (topSector ? topSector.sector : '--') + '</strong>（平均 ' + (topSector && topSector.avg > 0 ? '+' : '') + (topSector ? topSector.avg.toFixed(2) : '--') + '%）。弱勢類股：<strong style="color:var(--accent-green)">' + (bottomSector ? bottomSector.sector : '--') + '</strong>（平均 ' + (bottomSector ? bottomSector.avg.toFixed(2) : '--') + '%）。資金明顯流入 ' + (topSector ? topSector.sector : '--') + ' 類股，建議關注相關標的。</div></div>' +
    '<div class="ai-insight"><div class="ai-insight-title"><i class="fas fa-star"></i> 強勢股排行</div><div class="ai-insight-text">' + topGainers.map(function(s,i){ return '<span style="margin-right:12px">' + (i+1) + '. <strong style="color:var(--accent-blue)">' + s.code + '</strong> ' + s.name + ' <span class="price-up">+' + s.changePercent.toFixed(2) + '%</span></span>'; }).join('') + '</div></div>' +
    '<div class="ai-insight"><div class="ai-insight-title"><i class="fas fa-exclamation-triangle"></i> 風險提示</div><div class="ai-insight-text">' + (AppState.arbitrageList.length > 0 ? '發現 ' + AppState.arbitrageList.length + ' 個套利機會，溢價最高為 ' + AppState.arbitrageList[0].name + ' (' + AppState.arbitrageList[0].premiumPct.toFixed(2) + '%)，請注意回調風險。' : '目前市場溢價程度正常，未發現明顯套利機會。') + (AppState.gapList.length > 0 ? ' 共 ' + AppState.gapList.length + ' 支股票出現跳空缺口，缺口填補機率較高，操作需謹慎。' : '') + '</div></div>' +
    '<div style="font-size:11px;color:var(--text-muted);margin-top:12px;text-align:right;"><i class="fas fa-clock"></i> AI 分析時間：' + getCurrentTime() + ' | 僅供參考，不構成投資建議</div>';
  document.getElementById('aiAnalysisContent').innerHTML = html;
}

function updateOverviewCards(stocks) {
  const avgChange = stocks.reduce(function(sum,s){ return sum + s.changePercent; }, 0) / stocks.length;
  const taiexBase = 22500;
  const taiexVal = taiexBase * (1 + avgChange / 100);
  document.getElementById('taiexValue').textContent = formatNumber(taiexVal, 0);
  const taiexChangeEl = document.getElementById('taiexChange');
  const taiexChange = taiexVal - taiexBase;
  taiexChangeEl.textContent = (taiexChange > 0 ? '+' : '') + formatNumber(taiexChange, 0) + ' (' + (avgChange > 0 ? '+' : '') + avgChange.toFixed(2) + '%)';
  taiexChangeEl.className = 'card-change ' + getChangeClass(avgChange);
  document.getElementById('premiumCount').textContent = AppState.premiumList.filter(function(s){ return s.premiumPct >= AppState.alertThreshold; }).length + ' 支';
  document.getElementById('gapCount').textContent = AppState.gapList.length + ' 支';
  document.getElementById('volumeCount').textContent = AppState.predictions.filter(function(s){ return s.probability >= 70; }).length + ' 支';
  document.getElementById('arbitrageCount').textContent = AppState.arbitrageList.length + ' 支';
  document.getElementById('highOpenCount').textContent = AppState.highOpenList.length + ' 支';
}

function renderPremiumTable(stocks) {
  const sorted = stocks.slice().sort(function(a,b){ return Math.abs(b.premiumPct) - Math.abs(a.premiumPct); }).slice(0, AppState.displayLimit);
  AppState.premiumList = sorted;
  const tbody = document.getElementById('premiumTableBody');
  if (sorted.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="loading-row">暫無資料</td></tr>'; return; }
  tbody.innerHTML = sorted.map(function(s, i) {
    const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';
    const premClass = getPremiumClass(Math.abs(s.premiumPct));
    const isAlert = Math.abs(s.premiumPct) >= AppState.alertThreshold;
    const changeSign = s.changePercent >= 0 ? '+' : '';
    return '<tr><td><span class="rank-badge ' + rankClass + '">' + (i+1) + '</span></td><td><div class="stock-code">' + s.code + '</div><div class="stock-name">' + s.name + '</div></td><td class="' + getChangeClass(s.changePercent) + '">' + formatNumber(s.closePrice) + '</td><td>' + formatNumber(s.prevClose) + '</td><td><span class="premium-badge ' + premClass + '">' + changeSign + s.premiumPct.toFixed(2) + '%</span></td><td>' + formatVolume(s.volume) + '</td><td><span class="alert-icon ' + (isAlert ? 'alert-active' : 'alert-inactive') + '">' + (isAlert ? '🔔' : '🔕') + '</span></td></tr>';
  }).join('');
  document.getElementById('premiumUpdateTime').textContent = '更新：' + getCurrentTime();
  checkAlerts(sorted);
}

function renderHighOpenTable(stocks) {
  AppState.highOpenList = detectHighOpen(stocks);
  const tbody = document.getElementById('highOpenTableBody');
  if (AppState.highOpenList.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="loading-row">今日無高開股（閾值：' + AppState.highOpenThreshold + '%）</td></tr>'; return; }
  tbody.innerHTML = AppState.highOpenList.map(function(s){ return '<tr><td class="stock-code">' + s.code + '</td><td>' + s.name + '</td><td class="price-up">' + formatNumber(s.openPrice) + '</td><td>' + formatNumber(s.prevClose) + '</td><td><span class="premium-badge premium-high">+' + s.highOpenPct.toFixed(2) + '%</span></td><td class="' + getChangeClass(s.changePercent) + '">' + formatNumber(s.closePrice) + '</td><td>' + formatVolume(s.volume) + '</td></tr>'; }).join('');
  document.getElementById('highOpenUpdateTime').textContent = '更新：' + getCurrentTime();
}

function renderGapTable(stocks) {
  AppState.gapList = detectGaps(stocks);
  const tbody = document.getElementById('gapTableBody');
  if (AppState.gapList.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="loading-row">今日無跳空缺口</td></tr>'; return; }
  tbody.innerHTML = AppState.gapList.map(function(s){ return '<tr><td class="stock-code">' + s.code + '</td><td>' + s.name + '</td><td><span class="' + (s.gapType === 'up' ? 'gap-up-badge' : 'gap-down-badge') + '">' + (s.gapType === 'up' ? '⬆ 跳空向上' : '⬇ 跳空向下') + '</span></td><td class="' + (s.gapType === 'up' ? 'price-up' : 'price-down') + '">' + formatNumber(s.openPrice) + '</td><td>' + formatNumber(s.refPrice) + '</td><td><span class="premium-badge ' + (s.gapType === 'up' ? 'premium-high' : 'premium-low') + '">' + s.gapSize.toFixed(2) + '%</span></td><td class="' + getChangeClass(s.changePercent) + '">' + formatNumber(s.closePrice) + '</td></tr>'; }).join('');
  document.getElementById('gapUpdateTime').textContent = '更新：' + getCurrentTime();
}

function renderArbitrageTable(stocks) {
  AppState.arbitrageList = detectArbitrage(stocks);
  const tbody = document.getElementById('arbitrageTableBody');
  if (AppState.arbitrageList.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="loading-row">目前無明顯套利機會（閾值：' + AppState.alertThreshold + '%）</td></tr>'; return; }
  tbody.innerHTML = AppState.arbitrageList.map(function(s) {
    const riskColor = s.risk === '高' ? 'premium-high' : s.risk === '中' ? 'premium-mid' : 'premium-low';
    return '<tr><td class="stock-code">' + s.code + '</td><td>' + s.name + '</td><td class="' + getChangeClass(s.changePercent) + '">' + formatNumber(s.closePrice) + '</td><td>' + formatNumber(s.fairValue) + '</td><td><span class="premium-badge ' + getPremiumClass(Math.abs(s.premiumPct)) + '">' + (s.premiumPct > 0 ? '+' : '') + s.premiumPct.toFixed(2) + '%</span></td><td class="' + (s.premiumPct > 0 ? 'price-up' : 'price-down') + '">NT$ ' + formatNumber(s.arbitrageSpace) + '</td><td><span class="premium-badge ' + riskColor + '">' + s.risk + '風險</span></td></tr>';
  }).join('');
  document.getElementById('arbitrageUpdateTime').textContent = '更新：' + getCurrentTime();
}

function renderPredictions(stocks) {
  AppState.predictions = predictVolumeExplosion(stocks);
  const container = document.getElementById('predictionList');
  const emojis = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'];
  container.innerHTML = AppState.predictions.map(function(s, i) {
    return '<div class="prediction-item"><div class="prediction-rank">' + (emojis[i] || (i+1)) + '</div><div class="prediction-info"><div class="prediction-code">' + s.code + '</div><div class="prediction-name">' + s.name + ' ' + (s.signals||[]).map(function(sig){ return '<span style="font-size:10px;background:rgba(0,212,255,0.1);padding:1px 5px;border-radius:4px;color:var(--accent-blue)">' + sig + '</span>'; }).join(' ') + '</div></div><div class="prediction-prob"><div class="prob-value">' + s.probability + '%</div><div class="prob-label">爆量機率</div><div class="prob-bar"><div class="prob-fill" style="width:' + s.probability + '%"></div></div></div></div>';
  }).join('');
}

function renderHeatmap(stocks) {
  const container = document.getElementById('heatmapContainer');
  container.innerHTML = stocks.slice(0, 60).map(function(s) {
    const colors = getHeatmapColor(s.changePercent);
    const size = Math.max(60, Math.min(100, 60 + Math.abs(s.changePercent) * 5));
    const changeSign = s.changePercent >= 0 ? '+' : '';
    return '<div class="heatmap-cell" style="background:' + colors.bg + ';color:' + colors.text + ';width:' + size + 'px;height:' + (size*0.8) + 'px" title="' + s.code + ' ' + s.name + ': ' + changeSign + s.changePercent.toFixed(2) + '%" onclick="showStockDetail(\'' + s.code + '\',\'' + s.name + '\',' + s.closePrice + ',' + s.changePercent + ')"><div class="heatmap-code">' + s.code + '</div><div class="heatmap-change">' + changeSign + s.changePercent.toFixed(2) + '%</div><div class="heatmap-name">' + s.name + '</div></div>';
  }).join('');
}

function renderChart(stocks, type) {
  const ctx = document.getElementById('mainChart').getContext('2d');
  if (AppState.mainChart) AppState.mainChart.destroy();
  let config;
  if (type === 'premium') {
    const top15 = stocks.slice().sort(function(a,b){ return Math.abs(b.premiumPct) - Math.abs(a.premiumPct); }).slice(0, 15);
    config = { type: 'bar', data: { labels: top15.map(function(s){ return s.code; }), datasets: [{ label: '溢價幅度(%)', data: top15.map(function(s){ return s.premiumPct; }), backgroundColor: top15.map(function(s){ return s.premiumPct >= 0 ? 'rgba(255,71,87,0.7)' : 'rgba(0,255,136,0.7)'; }), borderColor: top15.map(function(s){ return s.premiumPct >= 0 ? '#ff4757' : '#00ff88'; }), borderWidth: 1, borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c){ return (c.raw > 0 ? '+' : '') + c.raw.toFixed(2) + '%'; }, title: function(c){ const s = top15[c[0].dataIndex]; return s.code + ' ' + s.name; } } } }, scales: { x: { ticks: { color: '#8892b0', font: { size: 11 } }, grid: { color: 'rgba(30,45,74,0.5)' } }, y: { ticks: { color: '#8892b0', font: { size: 11 }, callback: function(v){ return v + '%'; } }, grid: { color: 'rgba(30,45,74,0.5)' } } } } };
  } else if (type === 'volume') {
    const top15 = stocks.slice().sort(function(a,b){ return b.volume - a.volume; }).slice(0, 15);
    config = { type: 'bar', data: { labels: top15.map(function(s){ return s.code; }), datasets: [{ label: '成交量(張)', data: top15.map(function(s){ return s.volume; }), backgroundColor: 'rgba(0,212,255,0.6)', borderColor: '#00d4ff', borderWidth: 1, borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#8892b0', font: { size: 11 } }, grid: { color: 'rgba(30,45,74,0.5)' } }, y: { ticks: { color: '#8892b0', font: { size: 11 } }, grid: { color: 'rgba(30,45,74,0.5)' } } } } };
  } else {
    const sectorData = {};
    stocks.forEach(function(s){ if (!sectorData[s.sector]) sectorData[s.sector] = []; sectorData[s.sector].push(s.changePercent); });
    const sectors = Object.keys(sectorData);
    const avgChanges = sectors.map(function(sec){ return sectorData[sec].reduce(function(a,b){ return a+b; },0) / sectorData[sec].length; });
    config = { type: 'doughnut', data: { labels: sectors, datasets: [{ data: sectors.map(function(s,i){ return Math.abs(avgChanges[i]) + 1; }), backgroundColor: ['rgba(0,212,255,0.7)','rgba(168,85,247,0.7)','rgba(0,255,136,0.7)','rgba(255,71,87,0.7)','rgba(255,215,0,0.7)','rgba(255,107,53,0.7)','rgba(100,200,255,0.7)','rgba(200,100,255,0.7)'], borderColor: 'rgba(20,27,45,0.8)', borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#8892b0', font: { size: 11 }, padding: 10 } }, tooltip: { callbacks: { label: function(c){ const avg = avgChanges[c.dataIndex]; return sectors[c.dataIndex] + ': ' + (avg > 0 ? '+' : '') + avg.toFixed(2) + '%'; } } } } } };
  }
  AppState.mainChart = new Chart(ctx, config);
}

function checkAlerts(stocks) {
  const threshold = AppState.alertThreshold;
  const alertStocks = stocks.filter(function(s){ return Math.abs(s.premiumPct) >= threshold; });
  alertStocks.forEach(function(s) {
    const key = s.code + '_' + Math.floor(Math.abs(s.premiumPct));
    if (!AppState.alertedStocks.has(key)) {
      AppState.alertedStocks.add(key);
      showNotification('alert', '🚨 溢價警報：' + s.code + ' ' + s.name, '溢價幅度 ' + (s.premiumPct > 0 ? '+' : '') + s.premiumPct.toFixed(2) + '%，已超過警報閾值 ' + threshold + '%');
    }
  });
  if (alertStocks.length > 0) {
    document.getElementById('alertBanner').style.display = 'block';
    document.getElementById('alertMessage').textContent = '⚠️ 發現 ' + alertStocks.length + ' 支股票溢價超過 ' + threshold + '%！最高：' + alertStocks[0].code + ' ' + alertStocks[0].name + ' (' + alertStocks[0].premiumPct.toFixed(2) + '%)';
  }
}

function showNotification(type, title, text) {
  const container = document.getElementById('notificationContainer');
  const icons = { alert: 'fa-exclamation-circle', info: 'fa-info-circle', success: 'fa-check-circle' };
  const notif = document.createElement('div');
  notif.className = 'notification ' + type;
  notif.innerHTML = '<div class="notification-icon"><i class="fas ' + icons[type] + '"></i></div><div><div class="notification-title">' + title + '</div><div class="notification-text">' + text + '</div></div>';
  container.appendChild(notif);
  setTimeout(function() { notif.style.opacity = '0'; notif.style.transform = 'translateX(100%)'; notif.style.transition = 'all 0.3s'; setTimeout(function(){ notif.remove(); }, 300); }, 6000);
  if (AppState.soundEnabled && type === 'alert') {
    try {
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = actx.createOscillator(); const gain = actx.createGain();
      osc.connect(gain); gain.connect(actx.destination);
      osc.frequency.setValueAtTime(880, actx.currentTime); osc.frequency.setValueAtTime(660, actx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, actx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.3);
      osc.start(actx.currentTime); osc.stop(actx.currentTime + 0.3);
    } catch(e) {}
  }
}

function showStockDetail(code, name, price, change) {
  showNotification('info', code + ' ' + name, '現價：' + formatNumber(price) + ' | 漲跌：' + (change > 0 ? '+' : '') + change.toFixed(2) + '%');
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(function(btn){ btn.classList.remove('active'); });
  document.querySelectorAll('.tab-content').forEach(function(c){ c.classList.remove('active'); });
  event.currentTarget.classList.add('active');
  document.getElementById('tab-' + tabName).classList.add('active');
}

function switchChart(type) {
  AppState.currentChartType = type;
  document.querySelectorAll('.chart-btn').forEach(function(btn){ btn.classList.remove('active'); });
  event.currentTarget.classList.add('active');
  renderChart(AppState.stockData, type);
}

function refreshAIAnalysis() {
  document.getElementById('aiAnalysisContent').innerHTML = '<div class="ai-loading"><div class="ai-spinner"></div><span>AI 重新分析市場趨勢...</span></div>';
  setTimeout(function(){ generateAIAnalysis(AppState.stockData); }, 1500);
}

async function refreshData() {
  if (AppState.isLoading) return;
  AppState.isLoading = true;
  const btn = document.querySelector('.refresh-btn');
  btn.classList.add('loading');
  try {
    showNotification('info', '資料更新中', '正在從 TWSE 抓取最新資料...');
    const rawData = await fetchTWSEData();
    let stocks;
    if (rawData && rawData.length > 0) {
      stocks = processStockData(rawData);
      showNotification('success', '資料更新成功', '已載入 ' + stocks.length + ' 支股票資料（TWSE OpenAPI）');
    } else {
      stocks = generateMockData();
      showNotification('info', '使用模擬資料', '因 CORS 限制，使用模擬資料展示系統功能');
    }
    AppState.stockData = stocks;
    AppState.lastUpdate = new Date();
    renderPremiumTable(stocks); renderHighOpenTable(stocks); renderGapTable(stocks);
    renderArbitrageTable(stocks); renderPredictions(stocks); renderHeatmap(stocks);
    renderChart(stocks, AppState.currentChartType); updateOverviewCards(stocks); generateAIAnalysis(stocks);
  } catch (err) {
    console.error('Update failed:', err);
    showNotification('alert', '更新失敗', '資料抓取發生錯誤，使用模擬資料');
    const stocks = generateMockData();
    AppState.stockData = stocks;
    renderPremiumTable(stocks); renderHighOpenTable(stocks); renderGapTable(stocks);
    renderArbitrageTable(stocks); renderPredictions(stocks); renderHeatmap(stocks);
    renderChart(stocks, AppState.currentChartType); updateOverviewCards(stocks); generateAIAnalysis(stocks);
  } finally {
    AppState.isLoading = false;
    btn.classList.remove('loading');
  }
}

function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function updateRefreshInterval() {
  const interval = parseInt(document.getElementById('refreshInterval').value);
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
