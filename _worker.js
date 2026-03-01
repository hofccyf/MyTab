/**
 * Cloudflare Worker: MyTab
 * 1. 推荐workers部署。
 * 2. 建立任意名称KV空间。
 * 3. 绑定建立的KV空间，变量名为大写的DB。
 * 4. 务必修改密码，可调参数均有备注！
 * 5. 绑定域名，访问域名，点右下角齿轮进行各种设置。
 * 6. 音乐插件的API来自于https://t.me/gdstudio_music，当主API失效时会切换到网易云官方API。
 * 7. 导入时必须先填写密码再点导入，否则会提示输入密码，导入成功后会自动刷新页面生效。
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    /* ========================================================= */
    /* === 👇 可调参数 1：管理员后台保存密码，请务必修改 👇 === */
    /* ========================================================= */
    const MY_PASSWORD = "admin"; 
    /* ========================================================= */

    // === API: 音乐跨域代理 - 搜索列表 ===
    if (url.pathname === '/api/music') {
        try {
            const source  = url.searchParams.get('source')  || 'kuwo'; // 默认为酷我，音乐源: netease、kuwo、joox、bilibili，如需修改需要与可调参数5一起修改
            const keyword = url.searchParams.get('keyword') || '洋澜一'; // 默认搜索歌手洋澜一
            const count   = url.searchParams.get('count')   || '18'; // 默认搜索18首歌曲，不要超过49首，API有50次/5分限制
            let tracks = [];

            try {
                const res = await Promise.race([
                    fetch(`https://music-api.gdstudio.xyz/api.php?types=search&source=${source}&name=${encodeURIComponent(keyword)}&count=${count}`,
                        { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music-api.gdstudio.xyz/' } }),
                    new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000))
                ]);
                if (!res.ok) throw new Error(`search ${res.status}`);
                tracks = await res.json();
                if (!Array.isArray(tracks) || tracks.length === 0) throw new Error('empty');
            } catch(e) {
                // 备用API：网易云官方底层接口
                const fetchCount = Math.min(parseInt(count) * 3, 100);
                const searchBody = `s=${encodeURIComponent(keyword)}&type=1&limit=${fetchCount}&offset=0`;
                const fbRes = await fetch('https://music.163.com/api/cloudsearch/pc', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0',
                        'Referer': 'https://music.163.com/',
                        'Cookie': 'os=pc;'
                    },
                    body: searchBody
                });
                const fbData = await fbRes.json();
                if (fbData && fbData.result && fbData.result.songs) {
                    tracks = fbData.result.songs
                        .filter(song => song.fee === 0 || song.fee === 8)
                        .slice(0, parseInt(count))
                        .map(song => ({
                            id:      song.id,
                            name:    song.name,
                            artist:  song.ar ? song.ar.map(a => a.name).join(' / ') : '未知',
                            pic_id:  song.al ? song.al.id : '',
                            source:  'netease',
                            pic_url: song.al && song.al.picUrl ? song.al.picUrl : ''
                        }));
                }
            }

            return new Response(JSON.stringify(tracks), {
                headers: { 'content-type': 'application/json;charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
            });
        } catch(e) {
            return new Response(JSON.stringify([]), {
                headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }
    }

    // === API: 音乐 - 获取单曲播放URL ===
    if (url.pathname === '/api/music/url') {
        try {
            const source = url.searchParams.get('source') || 'netease';
            const id     = url.searchParams.get('id');
            if (!id) throw new Error('no id');
            let finalUrl = '';

            try {
                const res = await Promise.race([
                    fetch(`https://music-api.gdstudio.xyz/api.php?types=url&source=${source}&id=${id}`,
                        { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music-api.gdstudio.xyz/' } }),
                    new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000))
                ]);
                if (!res.ok) throw new Error(`url ${res.status}`);
                const data = await res.json();
                if (!data.url) throw new Error('empty url');
                finalUrl = data.url;
            } catch(e1) {
                try {
                    const res2 = await Promise.race([
                        fetch(`https://api.injahow.cn/meting/?server=${source}&type=url&id=${id}`,
                            { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://api.injahow.cn/' } }),
                        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 6000))
                    ]);
                    if (!res2.ok) throw new Error(`b1 ${res2.status}`);
                    const d2 = await res2.json();
                    const u2 = Array.isArray(d2) ? (d2[0] && d2[0].url) : (d2 && d2.url);
                    if (!u2) throw new Error('b1 no url');
                    finalUrl = u2;
                } catch(e2) {
                    try {
                        const res3 = await Promise.race([
                            fetch(`https://api.i-meto.com/meting/api?server=${source}&type=url&id=${id}`,
                                { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://api.i-meto.com/' } }),
                            new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 6000))
                        ]);
                        if (!res3.ok) throw new Error(`b2 ${res3.status}`);
                        const d3 = await res3.json();
                        const u3 = Array.isArray(d3) ? (d3[0] && d3[0].url) : (d3 && d3.url);
                        if (!u3) throw new Error('b2 no url');
                        finalUrl = u3;
                    } catch(e3) {
                        finalUrl = `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
                    }
                }
            }

            return new Response(JSON.stringify({ url: finalUrl }), {
                headers: { 'content-type': 'application/json;charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
            });
        } catch(e) {
            return new Response(JSON.stringify({ url: '' }), {
                headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }
    }

    if (url.pathname === '/api/hot') {
        try {
            const res = await fetch('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.toutiao.com/' } });
            const json = await res.json();
            const list = json.data.map(item => ({ title: item.Title, url: item.Url || `https://so.toutiao.com/search?keyword=${encodeURIComponent(item.Title)}` })).slice(0, 15);
            return new Response(JSON.stringify(list), { headers: { 'content-type': 'application/json' } });
        } catch (e) { return new Response(JSON.stringify([{ title: "加载中...", url: "#" }]), { headers: { 'content-type': 'application/json' } }); }
    }

    if (url.pathname === '/api/quote') {
        try { return new Response(await (await fetch(`https://v1.hitokoto.cn/?c=d&c=i&c=k&encode=json&_t=${Date.now()}`)).text(), { headers: { 'content-type': 'application/json' } }); } 
        catch(e) { return new Response(JSON.stringify({ hitokoto: "保持热爱，奔赴山海。", from: "MyTab" }), { headers: { 'content-type': 'application/json' } }); }
    }

    if (url.pathname === '/api/history') {
        try {
            const date = new Date();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            const res = await fetch(`https://baike.baidu.com/cms/home/eventsOnHistory/${m}.json`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const json = await res.json();
            const list = json[m][m+d] || [];
            const cleanList = list.map(item => ({ year: item.year, title: item.title.replace(/<[^>]+>/g, '') }));
            return new Response(JSON.stringify({ result: cleanList }), { headers: { 'content-type': 'application/json' } });
        } catch(e) { return new Response(JSON.stringify({ error: true, msg: "网络错误" }), { headers: { 'content-type': 'application/json' } }); }
    }

    if (url.pathname === '/api/rtnews') {
        try {
            const res = await fetch('https://top.baidu.com/api/board?platform=pc&tab=realtime', { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const json = await res.json();
            const list = json.data.cards[0].content.map(item => ({ title: item.word, url: item.appUrl || item.url || `https://www.baidu.com/s?wd=${encodeURIComponent(item.word)}` })).slice(0, 15);
            return new Response(JSON.stringify({ data: list }), { headers: { 'content-type': 'application/json' } });
        } catch(e) { return new Response(JSON.stringify({ success: false, data: [] }), { headers: { 'content-type': 'application/json' } }); }
    }

    if (url.pathname === '/api/stock') {
        try {
            const codes = url.searchParams.get('codes') || 'sh000001,sz399001,sz399006';
            const res = await fetch(`https://hq.sinajs.cn/list=${codes}`, { headers: { 'Referer': 'https://finance.sina.com.cn/' } });
            const text = await res.text();
            const data = [];
            const lines = text.split('\n');
            for (let line of lines) {
                const match = line.match(/hq_str_([a-z0-9]+)="([^"]+)"/);
                if (match) {
                    const code = match[1], parts = match[2].split(',');
                    if (parts.length > 5) {
                        const name = parts[0], yest = parseFloat(parts[2]);
                        let current = parseFloat(parts[3]);
                        if (current === 0) current = yest; 
                        const change = current - yest;
                        const percent = yest ? ((change / yest) * 100).toFixed(2) + '%' : '0.00%';
                        data.push({ code, name, price: current.toFixed(2), change: change > 0 ? '+'+change.toFixed(2) : change.toFixed(2), percent: change > 0 ? '+'+percent : percent });
                    }
                }
            }
            return new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } });
        } catch(e) { return new Response(JSON.stringify({ success: false, data: [] }), { headers: { 'content-type': 'application/json' } }); }
    }

    // === 新增：图标中转代理 (解决大陆无法抓取图标问题) ===
    if (url.pathname === '/api/icon') {
        const domain = url.searchParams.get('domain');
        if (!domain) return new Response(null, { status: 404 });
        
        // 使用 Google Favicon 服务 (Workers 运行在海外，可以访问 Google)
        const googleUrl = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
        
        try {
            const iconRes = await fetch(googleUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            // 转发图片并设置缓存，防止重复请求
            return new Response(iconRes.body, {
                headers: { 
                    'content-type': iconRes.headers.get('content-type') || 'image/png',
                    'cache-control': 'public, max-age=86400, s-maxage=86400' 
                }
            });
        } catch (e) {
            return new Response(null, { status: 500 });
        }
    }

    if (url.pathname === '/api/save' && request.method === 'POST') {
      try {
        const reqBody = await request.json();
        if (reqBody.password !== MY_PASSWORD) return new Response(JSON.stringify({ success: false, msg: "密码错误" }), { status: 403 });
        if (reqBody.weatherCity && reqBody.weatherCity !== reqBody.oldCity) {
            try {
                const geoData = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${reqBody.weatherCity}&count=1&language=zh&format=json`)).json();
                if (geoData.results && geoData.results.length > 0) reqBody.config.geo = { name: geoData.results[0].name, lat: geoData.results[0].latitude, lng: geoData.results[0].longitude };
            } catch (e) {}
        }
        await env.DB.put('config', JSON.stringify(reqBody.config));
        return new Response(JSON.stringify({ success: true }));
      } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
    }

    let userConfig = await env.DB.get('config', { type: 'json' });
    if (!userConfig) {
      userConfig = {
        bgType: 'url', bg: "https://699db746f9006b5d3258bca9.imgix.net/blue003.jpg",
        geo: { name: "Auto", lat: null, lng: null },
        apps: [ { name: "Google", url: "https://www.google.com", icon: "https://www.google.com/favicon.ico" } ], apps2: [], 
        dock: [ { name: "YouTube", url: "https://www.youtube.com", icon: "https://www.youtube.com/s/desktop/1315588c/img/favicon_144x144.png" } ],
        widgets1: [ { id: "w_cal1", type: "calendar" }, { id: "w_stk1", type: "stock" } ], widgets2: []
      };
    }
    if (!userConfig.apps && userConfig.links) { userConfig.apps = userConfig.links; userConfig.dock = []; }
    if (!userConfig.apps2) userConfig.apps2 = [];
    if (!userConfig.widgets1) userConfig.widgets1 = [];
    if (!userConfig.widgets2) userConfig.widgets2 = [];
    if (!userConfig.geo) userConfig.geo = { name: "Auto", lat: null, lng: null };

    const html = renderHtml(userConfig);
    return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
  }
};

function renderHtml(config) {
  const configJson = JSON.stringify(config);
  const dashboardHtml = `
    <div class="dashboard-wrapper">
        <div class="glass-card left-panel">
            <div class="clock-section"><div class="greeting c-greeting">Hi</div><div class="time c-time">00:00</div><div class="date c-date">Loading...</div></div>
            <div class="divider"></div>
            <div class="cal-section">
                <div class="cal-lunar-row"><span class="cal-lunar c-cal-lunar">...</span><span class="cal-ganzhi c-cal-ganzhi">...</span></div>
                <div class="cal-item"><span class="tag-yi">宜</span><span class="almanac-text c-cal-yi">Loading...</span></div>
                <div class="cal-item"><span class="tag-ji">忌</span><span class="almanac-text c-cal-ji">Loading...</span></div>
                <div class="caishen-info c-cal-caishen">财神: ...</div>
            </div>
            <div class="divider"></div>
            <div class="news-section-left" onmouseenter="this.dataset.hover='1'" onmouseleave="this.dataset.hover='0'">
                <div class="news-container-inner c-news-container"><div class="news-item-s">Loading...</div></div>
            </div>
        </div>
        <div class="center-panel">
            <form class="search-form-class" action="https://www.google.com/search" method="get" target="_blank">
                <div class="search-box-wrapper">
                    <div class="engine-selector" onclick="toggleEngineDropdown(event, this)">
                        <img src="" class="current-engine-icon c-engine-icon"><div class="engine-dropdown c-engine-dropdown"></div>
                    </div>
                    <input type="text" name="q" class="search-input search-input-class" placeholder="Search..." autocomplete="off">
                </div>
            </form>
        </div>
        <div class="glass-card right-panel">
            <div class="weather-row" onclick="openSettingsModal()" title="点击设置城市">
                <div class="w-current"><div class="wc-icon c-w-icon">☁️</div><div class="wc-main"><div class="wc-temp c-w-temp">--°</div><div class="wc-detail c-w-detail">...</div></div></div>
                <div class="w-forecast c-w-forecast"></div>
            </div>
            <div class="quote-section-right"><div class="quote-text c-hitokoto">Loading...</div><div class="quote-author c-hitokoto-from"></div></div>
        </div>
    </div>`;

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>我的首页</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/aplayer/1.10.1/APlayer.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/aplayer/1.10.1/APlayer.min.js"></script>
    
    <script src="https://cdn.jsdelivr.net/npm/lunar-javascript/lunar.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.0/Sortable.min.js"></script>
    <style>
        /* ===================================================================== */
        /* === 👇 可调参数 2：全局视觉、图标大小、卡片尺寸设置 👇 === */
        /* ===================================================================== */
        :root { 
            --glass-bg: rgba(255,255,255,0.03);    /* 卡片背景透明度 */
            --glass-border: rgba(255,255,255,0.1); /* 卡片边框透明度 */
            --glass-blur: 8px;                    /* 毛玻璃特效模糊度 */
            --text-color: #fff;                    /* 全局默认文字颜色 */
            
            /* 图标大小控制 */
            --icon-size: 68px;         /* 主屏幕（第1、2页）的图标大小 */
            --dock-icon-size: 58px;    /* 底部全局 Dock 栏的图标大小 */
            --card-width: 98px;        /* 图标外层包裹宽度，建议略大于图标防止文字折行 */
        }
        
        .widget-grid { 
            /* 【调节】控制小组件的网格宽度与行高 */
            grid-template-columns: repeat(auto-fill, minmax(min(338px, 100%), 1fr)); 
            grid-auto-rows: 268px; /* 设定每一行小组件的基础高度为 268px */
        }
        
        .widget-music-card {
            /* 【核心特权】让音乐播放器独享跨越两行的高度 (268px * 2 + 间距) */
            grid-row: span 2;
        }
        /* ===================================================================== */
        /* === 👆 可调参数 2 区域结束 👆 ======================================= */
        /* ===================================================================== */

        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, sans-serif; height: 100vh; width: 100vw; overflow: hidden; color: var(--text-color); background-color: #222; background-repeat: no-repeat; background-position: center center; background-size: cover; background-attachment: fixed; transition: background 0.3s ease; }
        .overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.2); z-index: -1; pointer-events: none; }
        .main-container { height: 100vh; width: 100vw; position: relative; overflow: hidden; }
        .pages-wrapper { height: 100%; width: 100%; transition: transform 0.6s cubic-bezier(0.25, 1, 0.5, 1); will-change: transform; }
        
        .page { height: 100vh; width: 100vw; display: flex; flex-direction: column; padding-top: 5vh; transition: padding-top 0.3s ease; }
        body.editing .page { padding-top: 90px; }

        .scrollable-content { flex: 1; overflow-y: auto; overflow-x: hidden; width: 100%; display: flex; flex-direction: column; align-items: center; padding-bottom: 120px; scrollbar-width: none; }
        .scrollable-content::-webkit-scrollbar { display: none; }
        .page-indicators { position: fixed; right: 25px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 15px; z-index: 50; }
        .dot { width: 12px; height: 12px; border-radius: 50%; background: rgba(255, 255, 255, 0.3); cursor: pointer; transition: all 0.3s ease; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
        .dot.active { background: #fff; box-shadow: 0 0 10px rgba(255,255,255,0.8); transform: scale(1.3); }
        
        .dashboard-wrapper { width: 94%; max-width: 1600px; height: 140px; display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 20px; flex-shrink: 0; }
        .glass-card { background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)); -webkit-backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--glass-border); border-radius: 20px; height: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.05); transition: all 0.3s ease; position: relative; overflow: hidden; }
        .left-panel { flex: 1.5; display: flex; align-items: center; padding: 0 20px; justify-content: space-between; }
        .clock-section { display: flex; flex-direction: column; justify-content: center; min-width: 90px; }
        .greeting { font-size: 0.8rem; color: #ffeb3b; font-weight: bold; }
        .time { font-size: 2.5rem; font-weight: 700; letter-spacing: -2px; line-height: 1; text-shadow: 0 2px 10px rgba(0,0,0,0.3); }
        .date { font-size: 0.8rem; opacity: 0.8; margin-top: 2px; }
        .divider { width: 1px; height: 60%; background: rgba(255,255,255,0.15); margin: 0 12px; }
        .cal-section { display: flex; flex-direction: column; justify-content: center; min-width: 160px; flex-shrink: 0; font-size: 0.8rem; gap: 4px; overflow: hidden; }
        .cal-lunar-row { display: flex; align-items: baseline; gap: 6px; margin-bottom: 2px; white-space: nowrap; }
        .cal-lunar { font-weight: 600; font-size: 0.9rem; }
        .cal-ganzhi, .caishen-info { font-size: 0.7rem; opacity: 0.7; }
        .cal-item { display: flex; align-items: center; gap: 4px; white-space: nowrap; overflow: hidden; width: 100%; }
        .tag-yi { color: #4caf50; font-weight: bold; background: rgba(76,175,80,0.15); padding: 0 4px; border-radius: 3px; font-size: 0.75rem; }
        .tag-ji { color: #ff4757; font-weight: bold; background: rgba(255,71,87,0.15); padding: 0 4px; border-radius: 3px; font-size: 0.75rem; }
        .almanac-text { opacity: 0.9; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; }
        .news-section-left { flex: 1; display: flex; flex-direction: column; justify-content: center; padding-left: 10px; border-left: 1px solid rgba(255,255,255,0.1); margin-left: 6px; height: 85%; overflow: hidden; }
        .news-container-inner { display: flex; flex-direction: column; gap: 6px; transition: opacity 0.5s; opacity: 1; }
        .news-container-inner.fade-out { opacity: 0; }
        .news-item-s { display: flex; align-items: center; font-size: 0.85rem; opacity: 0.9; cursor: pointer; white-space: nowrap; overflow: hidden; }
        .news-item-s:hover { color: #ffeb3b; transform: translateX(2px); transition: 0.2s; }
        .news-rank-s { font-weight: bold; margin-right: 8px; width: 16px; text-align: center; font-size: 0.7rem; background: rgba(255,255,255,0.1); border-radius: 4px; }
        .news-rank-1 { background: #f85959; } .news-rank-2 { background: #ff7f50; } .news-rank-3 { background: #ffca28; }
        .news-text-s { overflow: hidden; text-overflow: ellipsis; flex: 1; }

        .center-panel { flex: 1.2; display: flex; justify-content: center; align-items: flex-start; height: 100%; }
        .search-form-class { width:100%; display:flex; justify-content:center; margin:0; } 
        .search-box-wrapper { width: 100%; max-width: 600px; display: flex; align-items: center; background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--glass-border); border-radius: 40px; height: 50px; transition: 0.3s; }
        .search-box-wrapper:hover, .search-box-wrapper:focus-within { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.25); box-shadow: 0 8px 30px rgba(0,0,0,0.15); }
        .engine-selector { position: relative; height: 100%; padding: 0 15px; cursor: pointer; display: flex; align-items: center; border-right: 1px solid rgba(255,255,255,0.1); }
        .current-engine-icon { width: 22px; height: 22px; border-radius: 50%; }
        .engine-dropdown { position: absolute; top: 115%; left: 0; width: 130px; background: rgba(30,30,30,0.95); backdrop-filter: blur(10px); border-radius: 12px; display: none; z-index: 100; border: 1px solid #444; }
        .engine-dropdown.show { display: block; animation: fadeIn 0.2s; }
        .engine-option { padding: 12px; display: flex; align-items: center; cursor: pointer; color: #eee; font-size: 0.9rem; }
        .engine-option:hover { background: rgba(255,255,255,0.1); }
        .engine-option img { width: 20px; height: 20px; margin-right: 10px; }
        .search-input { flex: 1; background: transparent; border: none; color: white; font-size: 1.1rem; padding: 0 20px; height: 100%; outline: none; }

        .right-panel { flex: 1.2; display: flex; flex-direction: column; padding: 10px 20px; }
        .weather-row { display: flex; justify-content: space-between; align-items: center; height: 55%; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 5px; margin-bottom: 5px; cursor: pointer; }
        .w-current { display: flex; align-items: center; gap: 8px; min-width: 120px; }
        .wc-icon { font-size: 2rem; }
        .wc-main { display: flex; flex-direction: column; }
        .wc-temp { font-size: 1.5rem; font-weight: 500; line-height: 1; }
        .wc-detail { font-size: 0.7rem; opacity: 0.7; margin-top: 2px; }
        .w-forecast { display: flex; flex: 1; justify-content: space-between; margin-left: 15px; }
        .wf-item { display: flex; flex-direction: column; align-items: center; font-size: 0.7rem; opacity: 0.8; }
        .wf-icon { font-size: 0.9rem; margin-bottom: 2px; }
        .quote-section-right { height: 45%; display: flex; flex-direction: column; justify-content: center; }
        .quote-text { font-size: 0.85rem; opacity: 0.9; font-style: italic; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4; }
        .quote-author { font-size: 0.75rem; opacity: 0.6; text-align: right; margin-top: 3px; }

        /* === 小组件区域 === */
        .widget-grid-container { width: 94%; max-width: 1600px; margin-bottom: 20px; flex-shrink: 0; }
        .widget-grid { display: grid; gap: 20px; width: 100%; }
        
        /* 移除固定 height，改为 height:100% 以适配 grid-auto-rows 和 span 2 */
        .widget-card { background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--glass-border); border-radius: 20px; padding: 20px; position: relative; color: white; display: flex; flex-direction: column; transition: 0.2s; box-shadow: 0 8px 30px rgba(0,0,0,0.15); height: 100%; }
        
        .w-header { font-size: 1.15rem; font-weight: bold; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; opacity: 0.9; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; flex-shrink: 0; }
        .w-content { flex: 1; overflow: hidden; font-size: 1.05rem; display: flex; flex-direction: column; }
        
        .w-note-area { width: 100%; height: 100%; background: transparent; border: none; color: #fff; resize: none; outline: none; font-family: inherit; line-height: 1.6; font-size: 1.05rem; }
        .w-clock-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px dashed rgba(255,255,255,0.05); font-size: 1.2rem; }
        .w-calc-input { width: 100%; background: rgba(0,0,0,0.2); border: none; color: white; text-align: right; font-size: 1.65rem; padding: 10px 12px; border-radius: 8px; margin-bottom: 10px; outline: none; flex-shrink: 0; }
        .w-calc-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; flex: 1; }
        .w-calc-btn { background: rgba(255,255,255,0.1); border: none; border-radius: 8px; color: white; cursor: pointer; font-size: 1.3rem; display: flex; align-items: center; justify-content: center; }
        .w-trans-area { flex:1; background: rgba(0,0,0,0.1); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: white; padding: 12px; font-size: 1.05rem; resize: none; outline: none; margin-bottom: 10px; }
        .w-trans-btn { background: #0070f3; color: white; border: none; border-radius: 8px; padding: 10px; cursor: pointer; font-size: 1.05rem; font-weight: bold; flex-shrink: 0; }
        
        /* 股市单行完美排版 */
        .stock-item { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding: 12px 0; }
        .stock-item:last-child { border-bottom: none; }
        .stock-name { font-weight: bold; font-size: 1.2rem; opacity: 0.9; flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .stock-price { font-weight: bold; font-size: 1.3rem; flex: 1; text-align: center; }
        .stock-change { font-size: 1.05rem; flex: 1; text-align: right; font-weight: bold; white-space: nowrap; }
        .stock-up { color: #f2334e; }
        .stock-down { color: #20c064; }

        /* === 音乐播放器拉长版布局与暗色融合 === */
        .c-music-wrapper { flex: 1; display: flex; flex-direction: column; overflow: hidden; border-radius: 12px; }
        .aplayer { margin: 0 !important; background: rgba(0,0,0,0.3) !important; border-radius: 12px !important; box-shadow: none !important; color: #fff !important; font-family: inherit; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .aplayer * { color: inherit; }
        .aplayer .aplayer-info { border-bottom: 1px solid rgba(255,255,255,0.1) !important; padding: 10px 10px 10px 15px !important; flex-shrink: 0; }
        .aplayer .aplayer-info .aplayer-music .aplayer-title { color: #fff !important; font-weight: bold; font-size: 1.05rem; }
        .aplayer .aplayer-info .aplayer-music .aplayer-author { color: #bbb !important; font-size: 0.85rem; }
        .aplayer .aplayer-info .aplayer-controller .aplayer-time { color: #ccc !important; }
        .aplayer .aplayer-info .aplayer-controller .aplayer-time .aplayer-icon path { fill: #ccc !important; }
        
        /* 让歌曲列表充满整个拉长的可用空间 */
        .aplayer .aplayer-list { flex: 1; overflow-y: auto !important; height: auto !important; max-height: none !important; }
        .aplayer .aplayer-list::-webkit-scrollbar { display: none; }
        .aplayer .aplayer-list ol li { border-top: 1px solid rgba(255,255,255,0.05) !important; color: #ccc !important; padding: 10px 15px !important; }
        .aplayer .aplayer-list ol li:hover { background: rgba(255,255,255,0.1) !important; }
        .aplayer .aplayer-list ol li.aplayer-list-light { background: rgba(255,255,255,0.2) !important; color: #fff !important; }
        .aplayer .aplayer-list ol li .aplayer-list-index { color: #aaa !important; }
        .aplayer .aplayer-list ol li .aplayer-list-author { color: #aaa !important; right: 15px !important; }
        .aplayer-icon { fill: #fff !important; }
        .aplayer-pic { border-radius: 8px !important; }
        .music-search-row { display: flex; gap: 6px; padding: 8px 10px 4px; flex-shrink: 0; }
        .music-search-input { flex: 1; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 20px; color: #fff; padding: 5px 12px; font-size: 0.85rem; outline: none; }
        .music-search-input::placeholder { color: #aaa; }
        .music-search-btn { background: rgba(255,235,59,0.25); border: 1px solid rgba(255,235,59,0.4); color: #ffeb3b; border-radius: 20px; padding: 5px 12px; cursor: pointer; font-size: 0.85rem; white-space: nowrap; transition: 0.2s; }
        .music-search-btn:hover { background: rgba(255,235,59,0.4); }
        .music-search-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .c-history-container, .c-rtnews-container { transition: opacity 0.5s; opacity: 1; display: flex; flex-direction: column; justify-content: center; gap: 8px; }
        .c-history-container.fade-out, .c-rtnews-container.fade-out { opacity: 0; }
        .w-hist-item { padding: 6px 0; font-size: 1rem; line-height: 1.4; border-bottom: 1px dashed rgba(255,255,255,0.15); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .w-hist-item.clickable:hover { color: #ffeb3b; transform: translateX(2px); transition: 0.2s; cursor: pointer; }
        
        .w-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center; font-size: 1rem; flex: 1; align-items: stretch; }
        .w-cal-head { font-weight: bold; opacity: 0.7; display: flex; align-items: center; justify-content: center; }
        .w-cal-day { display: flex; align-items: center; justify-content: center; border-radius: 6px; }
        .w-cal-day.active { background: #ffeb3b; color: #333; font-weight: bold; }

        /* === 图标 === */
        .app-grid-container { width: 94%; max-width: 1600px; flex-shrink: 0; }
        .app-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 15px 5px; width: 100%; justify-items: center; padding: 10px 0; }
        .dock-wrapper { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); z-index: 40; max-width: 95%; }
        .dock-container { display: flex; align-items: center; justify-content: center; gap: 15px; background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--glass-border); padding: 15px 25px; border-radius: 32px; box-shadow: 0 10px 40px rgba(0,0,0,0.15); min-width: 120px; }
        .icon-card { display: flex; flex-direction: column; align-items: center; text-decoration: none; color: white; padding: 10px; border-radius: 18px; transition: 0.2s; position: relative; width: 100%; max-width: var(--card-width); }
        .icon-card:hover { transform: translateY(-3px); }
        .icon-img { width: var(--icon-size); height: var(--icon-size); border-radius: 18px; margin-bottom: 8px; object-fit: contain; background: white; padding: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
        
        /* 关键修改：图标双行显示样式 */
        .icon-title { 
            font-size: 0.85rem; 
            text-align: center; 
            width: 100%; 
            overflow: hidden; 
            text-overflow: ellipsis; 
            display: -webkit-box; 
            -webkit-line-clamp: 2; /* 限制为2行 */
            -webkit-box-orient: vertical; 
            white-space: normal; /* 允许换行 */
            line-height: 1.3; 
        }

        .dock-container .icon-card .icon-img { width: var(--dock-icon-size); height: var(--dock-icon-size); }
        .dock-container .icon-card .icon-title { display: none; }
        
        .delete-btn { display: none !important; }
        body.editing .delete-btn { display: flex !important; justify-content: center; align-items: center; position: absolute; top: -5px; right: -5px; width: 24px; height: 24px; background: #ff4757; color: white; border-radius: 50%; font-size: 14px; z-index: 10; cursor: pointer; }
        body.editing .app-grid, body.editing .widget-grid { background: rgba(0,0,0,0.15); border: 2px dashed rgba(255,255,255,0.2); border-radius: 20px; min-height: 100px; padding: 10px; }
        body.editing .dock-container { border: 2px dashed rgba(255,255,255,0.3); }
        body.editing .icon-card, body.editing .widget-card { cursor: grab; animation: jiggle 0.3s infinite alternate; }

        @media (max-width: 1200px) { .dashboard-wrapper { flex-direction: column; height: auto; align-items: stretch; } .center-panel { order: -1; margin-bottom: 10px; padding-top: 0; } .left-panel, .right-panel { height: 140px; } }
        @media (max-width: 700px) { .left-panel, .right-panel { display: none; } .center-panel { height: 60px; } .app-grid { grid-template-columns: repeat(4, 1fr); } }

        .settings-btn { position: fixed; bottom: 30px; right: 30px; width: 60px; height: 60px; cursor: pointer; z-index: 100; transition: 0.5s; }
        .settings-btn img { width: 100%; height: 100%; filter: drop-shadow(0 5px 10px rgba(0,0,0,0.5)); }
        .settings-btn:hover { transform: rotate(90deg) scale(1.1); }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); align-items: center; justify-content: center; z-index: 200; backdrop-filter: blur(10px); }
        .modal.active { display: flex; }
        .modal-content { background: #1e1e1e; width: 450px; padding: 30px; border-radius: 24px; color: white; border: 1px solid #333; max-height: 90vh; overflow-y: auto; }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; margin-bottom: 8px; color: #aaa; }
        .form-group input, .form-group select { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #444; background: #2c2c2c; color: white; outline: none; }
        .btn-row { display: flex; gap: 15px; margin-top: 30px; }
        .btn { flex: 1; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; }
        .btn-primary { background: #0070f3; color: white; }
        .btn-cancel { background: #333; color: white; }
        .btn-warning { background: #ff9800; color: white; }
        
        /* 顶部悬浮工具栏 (已优化宽度和位置) */
        #add-placeholder { 
            display: none; position: fixed; top: 50%; left: 10px; transform: translateY(-50%); 
            z-index: 10000; flex-direction: column; gap: 10px; 
            background: rgba(0,0,0,0.85); 
            backdrop-filter: blur(15px); padding: 15px 12px; border-radius: 20px; 
            border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 10px 40px rgba(0,0,0,0.5); 
            width: auto;
        }
        .btn-add-action { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 8px 15px; border-radius: 20px; cursor: pointer; font-weight: bold; transition: 0.2s; white-space: nowrap; font-size: 0.85rem; }
        .btn-add-action:hover { background: rgba(255,255,255,0.25); }
        .btn-exit-edit { background: #ff4757; border: none; }
        .btn-exit-edit:hover { background: #ff6b81; }
        
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes jiggle { 0% { transform: rotate(-1deg); } 100% { transform: rotate(1deg); } }
    </style>
</head>
<body>
    <div class="overlay"></div>
    <div class="page-indicators">
        <div class="dot active" onclick="scrollToPage(0)" title="第一页"></div>
        <div class="dot" onclick="scrollToPage(1)" title="第二页"></div>
    </div>
    
    <div id="add-placeholder">
        <button class="btn-add-action" onclick="openAddIconModal()">+ 添加图标</button>
        <button class="btn-add-action" onclick="openAddWidgetModal()">+ 添加小组件</button>
        <button class="btn-add-action btn-exit-edit" onclick="handleGearClick()">完成排版</button>
    </div>

    <div class="main-container" id="main-container">
        <div class="pages-wrapper" id="pages-wrapper">
            <div class="page" id="page-1">
                <div class="scrollable-content" id="scroll-1">
                    ${dashboardHtml}
                    <div class="app-grid-container"><div class="app-grid" id="app-grid-1"></div></div>
                </div>
            </div>
            <div class="page" id="page-2">
                <div class="scrollable-content" id="scroll-2">
                    <div class="widget-grid-container"><div class="widget-grid" id="widget-grid-2"></div></div>
                    <div class="app-grid-container"><div class="app-grid" id="app-grid-2"></div></div>
                </div>
            </div>
        </div>
    </div>

    <div class="dock-wrapper"><div class="dock-container" id="dock-container"></div></div>
    
    <div class="settings-btn" onclick="handleGearClick()"><img id="btn-icon" src="https://cdn-icons-png.flaticon.com/512/3953/3953226.png"></div>

    <div class="modal" id="configModal">
        <div class="modal-content">
            <h3 id="modal-title" style="margin-bottom:15px;border-bottom:1px solid #444;padding-bottom:10px;">设置</h3>
            <div id="icon-form" style="display:none;">
                <input type="hidden" id="edit-icon-state" value="add"><input type="hidden" id="edit-icon-index" value="-1"><input type="hidden" id="edit-icon-type" value="apps">
                <div class="form-group"><label>名称</label><input type="text" id="new-name"></div>
                <div class="form-group"><label>链接</label><input type="text" id="new-url"></div>
                <div class="form-group"><label>图标</label><input type="file" id="new-icon-file" accept="image/*"><input type="text" id="new-icon-url" placeholder="URL..." oninput="previewNewIcon(this.value)"><img id="new-icon-preview" style="width:60px;display:none;margin-top:5px;"></div>
                <div class="form-group" id="icon-target-group"><label>位置</label><select id="new-icon-target"><option value="apps1">第一页 主屏幕</option><option value="apps2">第二页 主屏幕</option><option value="dock">底部 Dock</option></select></div>
                <div class="btn-row"><button class="btn btn-cancel" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveIconData()">确定</button></div>
            </div>
            <div id="widget-form" style="display:none;">
                <div class="form-group">
                    <label>选择小组件类型</label>
                    <select id="new-widget-type">
                        <option value="notepad">📝 记事本</option>
                        <option value="world_clock">🌍 世界时钟</option>
                        <option value="calculator">🧮 计算器</option>
                        <option value="calendar">📅 本月日历</option>
                        <option value="translator">🌐 快捷翻译</option>
                        <option value="stock">📈 大盘实时指数</option>
                        <option value="history">⏳ 历史上的今天</option>
                        <option value="rtnews">📰 实时新闻热点</option>
                        <option value="music">🎵 音乐播放器 (指定歌手音乐)</option>
                    </select>
                </div>
                <div class="form-group"><label>放置位置</label><select id="new-widget-target"><option value="widgets1">第一页 顶部</option><option value="widgets2">第二页 顶部</option></select></div>
                <div class="btn-row"><button class="btn btn-cancel" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveWidgetData()">添加</button></div>
            </div>
            <div id="settings-form" style="display:none;">
                <div class="form-group"><label>城市天气</label><input type="text" id="weather-city"></div>
                <div class="form-group"><label>壁纸设置</label><select id="bg-type" onchange="toggleBgInput()"><option value="url">图片链接</option><option value="upload">本地上传</option></select></div>
                <div class="form-group" id="bg-url-group"><input type="text" id="bg-url" placeholder="https://..."></div>
                <div class="form-group" id="bg-upload-group" style="display:none;"><input type="file" id="bg-file" accept="image/*"><img id="bg-preview" style="width:100%;display:none;margin-top:5px;"></div>
                <div class="form-group" style="padding:15px 0; border-top:1px solid #333; border-bottom:1px solid #333; text-align:center;"><button class="btn btn-warning" onclick="enterEditModeFromModal()" style="width:100%">🛠️ 进入编辑排版模式</button></div>
                <div class="form-group" style="margin-top:20px;"><label style="color:#f55">管理员密码</label><input type="password" id="admin-pass" placeholder="保存配置需输入"></div>
                <div class="btn-row" style="margin-top:15px;"><button class="btn btn-cancel" onclick="exportConfig()" style="background:#2c5282;">📤 导出配置</button><button class="btn btn-cancel" onclick="document.getElementById(\'import-file\').click()" style="background:#2c5282;">📥 导入配置</button></div><input type="file" id="import-file" accept=".json" style="display:none" onchange="importConfig(this)"><div class="btn-row"><button class="btn btn-cancel" onclick="closeModal()">关闭</button><button class="btn btn-primary" onclick="saveSettingsData()">保存配置</button></div>
            </div>
        </div>
    </div>

    <script>
        let config = ${configJson};
        let isEditing = false, hasUnsavedChanges = false, sortables = {}; 
        let newsList = [], newsIndex = 0;
        let historyList = [], historyIndex = 0, historyTimer = null;
        let rtnewsList = [], rtnewsIndex = 0, rtnewsTimer = null;
        let currentPage = 0, totalPages = 2, isScrollingLocked = false, touchStartY = 0;

        /* ===================================================================== */
        /* === 👇 可调参数 3：各组件轮播刷新频率 (单位: 毫秒) 👇 ========= */
        /* ===================================================================== */
        const TIME_STOCK_REFRESH = 18000;   // 股市数据刷新频率 (18秒)
        const TIME_HISTORY_ROTATE = 18000;   // 历史上的今天轮播间隔 (18秒)
        const TIME_RTNEWS_ROTATE = 18000;    // 实时新闻轮播间隔 (18秒)
        const TIME_HOTNEWS_ROTATE = 18000;   // 左上角头条热榜轮播间隔 (18秒)
        /* ===================================================================== */

        /* ===================================================================== */
        /* === 👇 可调参数 4：要监控的大盘或股票代码列表 👇 ============== */
        /* ===================================================================== */
        // 代码填写格式: sz + 数字 (深证), sh + 数字 (上证)
        const stockList = [ 
            { name: "上证指数", code: "sh000001" }, 
            { name: "深证成指", code: "sz399001" }, 
            { name: "创业板指", code: "sz399006" } 
        ];
        /* ===================================================================== */

        /* ===================================================================== */
        /* === 👇 可调参数 5：音乐播放器设置 👇 ========================== */
        /* ===================================================================== */
        const MUSIC_SOURCE  = "kuwo";  // 音乐源: netease、kuwo、joox、bilibili
        const MUSIC_KEYWORD = "洋澜一";        // 搜索关键词
        const MUSIC_COUNT  = "18";           // 加载数量（1+18=19次请求，远未达限颖50次/5min）
        /* ===================================================================== */
        /* === 👆 可调参数区域彻底结束 👆 ====================================== */
        /* ===================================================================== */

        const engines = {
            google: { name: "Google", url: "https://www.google.com/search", param: "q", icon: "https://www.google.com/favicon.ico", placeholder: "Google..." },
            baidu:  { name: "Baidu",   url: "https://www.baidu.com/s",        param: "wd", icon: "https://www.baidu.com/favicon.ico", placeholder: "百度一下..." },
            bing:   { name: "Bing",   url: "https://www.bing.com/search",    param: "q", icon: "https://www.bing.com/favicon.ico", placeholder: "Bing..." }
        };
        let currentEngineKey = localStorage.getItem('myTab_engine') || 'google';

        function init() {
            try { document.body.style.backgroundImage = "url('" + (config.bg || '') + "')"; } catch(e){}
            try { renderAll(); } catch(e){ console.error(e); }
            try { updateClock(); setInterval(updateClock, 1000); } catch(e){}
            try { initSearchEngine(); } catch(e){}
            try { if(typeof Lunar !== 'undefined') updateCalendar(); else setTimeout(updateCalendar, 1000); } catch(e){}
            
            try { fetchNews(); } catch(e){}
            try { fetchHitokoto(); } catch(e){}
            try { initWeather(); } catch(e){}
            
            try {
                document.addEventListener('click', (e) => { if (!e.target.closest('.engine-selector')) document.querySelectorAll('.c-engine-dropdown').forEach(el => el.classList.remove('show')); });
                document.getElementById('bg-file').addEventListener('change', (e) => handleFileSelect(e, 'bg-preview'));
                document.getElementById('new-icon-file').addEventListener('change', (e) => handleFileSelect(e, 'new-icon-preview'));
            } catch(e){}

            try { initSmoothScroll(); } catch(e) {}
            try { fetchStockWidget(); setInterval(fetchStockWidget, TIME_STOCK_REFRESH); } catch(e){}
        }

        function updateCalendar() {
            const now = new Date(), hour = now.getHours();
            let greet = hour<6?"夜深了":hour<9?"早上好":hour<12?"上午好":hour<14?"中午好":hour<18?"下午好":"晚上好";
            document.querySelectorAll('.c-greeting').forEach(el => el.innerText = greet);
            document.querySelectorAll('.c-date').forEach(el => el.innerText = now.toLocaleDateString('zh-CN', {weekday:'long', month:'long', day:'numeric'}));
            try {
                const lunar = Lunar.fromDate(now);
                document.querySelectorAll('.c-cal-lunar').forEach(el => el.innerText = lunar.getMonthInChinese() + "月" + lunar.getDayInChinese());
                document.querySelectorAll('.c-cal-ganzhi').forEach(el => el.innerText = \`\${lunar.getYearInGanZhi()}年 \${lunar.getMonthInGanZhi()}月 \${lunar.getDayInGanZhi()}日\`);
                document.querySelectorAll('.c-cal-yi').forEach(el => el.innerText = lunar.getDayYi().slice(0, 4).join(' '));
                document.querySelectorAll('.c-cal-ji').forEach(el => el.innerText = lunar.getDayJi().slice(0, 4).join(' '));
                document.querySelectorAll('.c-cal-caishen').forEach(el => el.innerText = "财神方位: " + lunar.getPositionCai());
            } catch(e) {}
        }

        function getWidgetHTML(w) {
            const id = w.id;
            if(w.type === 'notepad') return \`<div class="w-header">📝 记事本</div><div class="w-content"><textarea class="w-note-area" id="note-\${id}" placeholder="记录点什么..." oninput="localStorage.setItem('note_\${id}', this.value)"></textarea></div>\`;
            if(w.type === 'world_clock') return \`<div class="w-header">🌍 世界时钟</div><div class="w-content" style="justify-content:center; gap:5px;"><div class="w-clock-row"><span>🇺🇸 纽约</span><span class="w-tz-time" data-tz="America/New_York">--:--</span></div><div class="w-clock-row"><span>🇬🇧 伦敦</span><span class="w-tz-time" data-tz="Europe/London">--:--</span></div><div class="w-clock-row"><span>🇯🇵 东京</span><span class="w-tz-time" data-tz="Asia/Tokyo">--:--</span></div></div>\`;
            if(w.type === 'calculator') return \`<div class="w-header">🧮 计算器</div><div class="w-content"><input type="text" class="w-calc-input" id="calc-\${id}" readonly placeholder="0"><div class="w-calc-grid"><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='7'">7</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='8'">8</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='9'">9</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='/'">÷</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='4'">4</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='5'">5</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='6'">6</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='*'">×</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='1'">1</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='2'">2</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='3'">3</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='-'">-</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value=''">C</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='0'">0</button><button class="w-calc-btn" onclick="try{document.getElementById('calc-\${id}').value=eval(document.getElementById('calc-\${id}').value)}catch(e){}">=</button><button class="w-calc-btn" onclick="document.getElementById('calc-\${id}').value+='+'">+</button></div></div>\`;
            if(w.type === 'translator') return \`<div class="w-header">🌐 翻译</div><div class="w-content"><textarea class="w-trans-area" placeholder="输入要翻译的内容..."></textarea><button class="w-trans-btn" onclick="window.open('https://www.bing.com/translator/?text=' + encodeURIComponent(this.previousElementSibling.value) + '&from=auto&to=zh-Hans', '_blank')
">在新标签页中翻译</button></div>\`;
            if(w.type === 'calendar') {
                const now=new Date(), d=now.getDate(), fd=new Date(now.getFullYear(),now.getMonth(),1).getDay(), dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
                let calHTML = '<div class="w-cal-grid"><div class="w-cal-head">日</div><div class="w-cal-head">一</div><div class="w-cal-head">二</div><div class="w-cal-head">三</div><div class="w-cal-head">四</div><div class="w-cal-head">五</div><div class="w-cal-head">六</div>';
                for(let i=0;i<fd;i++) calHTML+='<div></div>'; for(let i=1;i<=dim;i++) calHTML+=\`<div class="w-cal-day \${i===d?'active':''} ">\${i}</div>\`; calHTML+='</div>';
                return \`<div class="w-header">📅 \${now.getFullYear()}年 \${now.getMonth()+1}月</div><div class="w-content">\${calHTML}</div>\`;
            }
            if(w.type === 'stock') return \`<div class="w-header">📈 大盘实时指数</div><div class="w-content c-stock-container"><div class="w-hist-item">查询数据中...</div></div>\`;
            if(w.type === 'history') return \`<div class="w-header">⏳ 历史上的今天</div><div class="w-content c-history-container" onmouseenter="this.dataset.hover='1'" onmouseleave="this.dataset.hover='0'"><div class="w-hist-item">查询数据中...</div></div>\`;
            if(w.type === 'rtnews') return \`<div class="w-header">📰 实时新闻热点</div><div class="w-content c-rtnews-container" onmouseenter="this.dataset.hover='1'" onmouseleave="this.dataset.hover='0'"><div class="w-hist-item">热点拉取中...</div></div>\`;
            
            if(w.type === 'music') return \`<div class="w-header" style="flex-shrink:0">🎵 音乐播放器</div><div class="w-content c-music-wrapper" style="overflow:hidden;display:flex;flex-direction:column;"><div class="music-search-row"><input class="music-search-input" id="music-search-\${id}" placeholder="搜索歌手 / 歌曲..." onkeydown="if(event.key==='Enter')musicSearch('\${id}')"><button class="music-search-btn" id="music-search-btn-\${id}" onclick="musicSearch('\${id}')">🔍 搜索</button></div><div id="aplayer-\${id}" class="aplayer" style="flex:1;overflow:hidden;min-height:0;"></div></div>\`;
            
            return \`<div class="w-header">未知组件</div>\`;
        }

        async function fetchStockWidget() {
            if(!document.querySelector('.c-stock-container')) return; 
            try {
                const codes = stockList.map(s => s.code).join(',');
                const res = await fetch('/api/stock?codes=' + codes); 
                const data = await res.json();
                if(data.success && data.data.length > 0) {
                    let html = '';
                    data.data.forEach(stock => {
                        const customName = stockList.find(s => s.code === stock.code)?.name || stock.name;
                        const isDown = parseFloat(stock.change) < 0;
                        const colorClass = isDown ? 'stock-down' : 'stock-up';
                        html += \`
                            <div class="stock-item">
                                <div class="stock-name">\${customName}</div>
                                <div class="stock-price \${colorClass}">\${stock.price}</div>
                                <div class="stock-change \${colorClass}">\${stock.change} &nbsp; \${stock.percent}</div>
                            </div>\`;
                    });
                    document.querySelectorAll('.c-stock-container').forEach(el => el.innerHTML = html);
                } else {
                    document.querySelectorAll('.c-stock-container').forEach(el => el.innerHTML = '<div class="w-hist-item" style="color:#aaa;">暂无股市数据</div>');
                }
            } catch(e) { document.querySelectorAll('.c-stock-container').forEach(el => el.innerHTML = '<div class="w-hist-item" style="color:#ff4757;">网络或解析失败</div>'); }
        }

        async function fetchHistoryWidget() {
            if(!document.querySelector('.c-history-container')) return; 
            try {
                if(historyList.length === 0) {
                    const res = await fetch('/api/history'); const data = await res.json();
                    historyList = data.result || [];
                }
                if(historyList.length > 0) {
                    rotateHistory(true); if(historyTimer) clearInterval(historyTimer);
                    historyTimer = setInterval(rotateHistory, TIME_HISTORY_ROTATE);
                } else document.querySelectorAll('.c-history-container').forEach(el => el.innerHTML = '<div class="w-hist-item" style="color:#aaa;">暂无今日历史数据</div>');
            } catch(e) { document.querySelectorAll('.c-history-container').forEach(el => el.innerHTML = '<div class="w-hist-item" style="color:#ff4757;">网络或加载失败</div>'); }
        }

        function rotateHistory(immediate = false) {
            if(historyList.length === 0) return;
            const containers = document.querySelectorAll('.c-history-container');
            if(containers.length === 0) return;
            if(!immediate && Array.from(containers).some(el => el.dataset.hover === '1')) return;

            const updateContent = () => {
                containers.forEach(container => {
                    container.innerHTML = '';
                    for(let i=0; i<4; i++) { 
                        const item = historyList[(historyIndex + i) % historyList.length]; if(!item) continue;
                        const div = document.createElement('div'); div.className = 'w-hist-item'; div.title = item.title;
                        div.innerHTML = \`<span style="color:#ffca28; margin-right:8px; font-size:1.2em;">•</span><span style="opacity:0.8; margin-right:6px;">\${item.year}年:</span>\${item.title}\`; 
                        container.appendChild(div);
                    }
                    container.classList.remove('fade-out');
                });
                historyIndex = (historyIndex + 4) % historyList.length;
            };
            if(immediate) updateContent(); else { containers.forEach(el => el.classList.add('fade-out')); setTimeout(updateContent, 500); }
        }

        async function fetchRTNewsWidget() {
            if(!document.querySelector('.c-rtnews-container')) return; 
            try {
                if(rtnewsList.length === 0) {
                    const res = await fetch('/api/rtnews'); const data = await res.json();
                    rtnewsList = data.data || [];
                }
                if(rtnewsList.length > 0) {
                    rotateRTNews(true); if(rtnewsTimer) clearInterval(rtnewsTimer);
                    rtnewsTimer = setInterval(rotateRTNews, TIME_RTNEWS_ROTATE);
                } else document.querySelectorAll('.c-rtnews-container').forEach(el => el.innerHTML = '<div class="w-hist-item" style="color:#aaa;">暂无新闻数据</div>');
            } catch(e) { document.querySelectorAll('.c-rtnews-container').forEach(el => el.innerHTML = '<div class="w-hist-item" style="color:#ff4757;">网络或加载失败</div>'); }
        }

        function rotateRTNews(immediate = false) {
            if(rtnewsList.length === 0) return;
            const containers = document.querySelectorAll('.c-rtnews-container');
            if(containers.length === 0) return;
            if(!immediate && Array.from(containers).some(el => el.dataset.hover === '1')) return;

            const updateContent = () => {
                containers.forEach(container => {
                    container.innerHTML = '';
                    for(let i=0; i<4; i++) { 
                        const item = rtnewsList[(rtnewsIndex + i) % rtnewsList.length]; if(!item) continue;
                        const div = document.createElement('div'); div.className = 'w-hist-item clickable'; div.title = item.title;
                        div.onclick = () => window.open(item.url || item.mobilUrl, '_blank');
                        div.innerHTML = \`<span style="color:#ff4757; margin-right:8px; font-size:1.2em;">•</span><span style="opacity:0.9;">\${item.title}</span>\`; 
                        container.appendChild(div);
                    }
                    container.classList.remove('fade-out');
                });
                rtnewsIndex = (rtnewsIndex + 4) % rtnewsList.length;
            };
            if(immediate) updateContent(); else { containers.forEach(el => el.classList.add('fade-out')); setTimeout(updateContent, 500); }
        }

        async function fetchNews() {
            try { const res = await fetch('/api/hot'); newsList = await res.json();
                if(newsList.length > 0) { setInterval(rotateNews, TIME_HOTNEWS_ROTATE); rotateNews(true); }
            } catch(e) {}
        }
        
        function rotateNews(immediate = false) {
            if(newsList.length === 0) return;
            const containers = document.querySelectorAll('.news-section-left');
            if(containers.length === 0) return;
            if(!immediate && Array.from(containers).some(el => el.dataset.hover === '1')) return;

            const innerContainers = document.querySelectorAll('.c-news-container');
            const updateContent = () => {
                innerContainers.forEach(container => {
                    container.innerHTML = '';
                    for(let i=0; i<3; i++) {
                        const idx = (newsIndex + i) % newsList.length; const item = newsList[idx];
                        const div = document.createElement('div'); div.className = 'news-item-s';
                        const rankClass = idx < 3 ? \`news-rank-\${idx+1}\` : '';
                        div.innerHTML = \`<span class="news-rank-s \${rankClass}">\${idx+1}</span><span class="news-text-s">\${item.title}</span>\`;
                        div.onclick = (e) => { e.stopPropagation(); window.open(item.url, '_blank'); };
                        container.appendChild(div);
                    }
                    container.classList.remove('fade-out');
                });
                newsIndex = (newsIndex + 3) % newsList.length;
            };
            if(immediate) updateContent(); else { innerContainers.forEach(el => el.classList.add('fade-out')); setTimeout(updateContent, 500); }
        }

        // ==================== 跨域直连 APlayer 引擎 ====================
        async function initMusicPlayer(id, keyword) {
            const container = document.getElementById('aplayer-' + id);
            if(!container) return;
            const kw = keyword || MUSIC_KEYWORD;
            const btn = document.getElementById('music-search-btn-' + id);
            const searchInput = document.getElementById('music-search-' + id);
            if(btn) btn.disabled = true;
            try {
                container.innerHTML = '<div style="padding: 20px; text-align: center; color: #aaa;">🔍 搜索中：' + kw + '...</div>';

                // Step1: 获取歌曲列表
                const listRes = await fetch('/api/music?source=' + MUSIC_SOURCE + '&keyword=' + encodeURIComponent(kw) + '&count=' + MUSIC_COUNT);
                const tracks = await listRes.json();
                if(!Array.isArray(tracks) || tracks.length === 0) throw new Error('empty');

                container.innerHTML = '<div style="padding: 20px; text-align: center; color: #aaa;">⏳ 加载音频中 (' + tracks.length + ' 首)...</div>';

                // Step2: 串行获取播放URL，避免并发触发主API限流导致歌曲丢失
                const PIC_BASE = 'https://music-api.gdstudio.xyz/api.php?types=pic&size=300';
                const audioList = [];
                for (const t of tracks) {
                    try {
                        const r = await fetch('/api/music/url?source=' + (t.source || MUSIC_SOURCE) + '&id=' + t.id);
                        const d = await r.json();
                        if (!d.url) continue;
                        audioList.push({
                            name: t.name,
                            artist: Array.isArray(t.artist) ? t.artist.join(' / ') : t.artist,
                            url: d.url,
                            cover: t.pic_url ? t.pic_url : (t.pic_id ? (PIC_BASE + '&source=' + (t.source || MUSIC_SOURCE) + '&id=' + t.pic_id) : ''),
                            lrc: ''
                        });
                    } catch(e) { continue; }
                }

                if(audioList.length === 0) throw new Error('no valid urls');

                container.innerHTML = '';
                // 销毁旧实例防内存泄漏
                if(container._aplayerInstance) { try { container._aplayerInstance.destroy(); } catch(e) {} }
                const ap = new APlayer({
                    container: container,
                    listFolded: false,
                    theme: '#ffeb3b',
                    audio: audioList,
                    lrcType: 0
                });
                container._aplayerInstance = ap;
            } catch(e) {
                console.error('[music]', e);
                container.innerHTML = '<div style="padding: 20px; text-align: center; color: #ff4757;">音乐加载失败，请检查网络连接</div>';
            } finally {
                if(btn) btn.disabled = false;
            }
        }

        function musicSearch(id) {
            const input = document.getElementById('music-search-' + id);
            const kw = input ? input.value.trim() : '';
            if(!kw) return;
            initMusicPlayer(id, kw);
        }


        function initSmoothScroll() {
            const mainContainer = document.getElementById('main-container');
            if (!mainContainer) return;

            const canScrollWholePage = (e, isDown) => {
                const scrollArea = e.target.closest('.scrollable-content');
                if (scrollArea && scrollArea.scrollHeight > scrollArea.clientHeight) {
                    const isAtTop = scrollArea.scrollTop <= 5; 
                    const isAtBottom = Math.abs(scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight) <= 5;
                    if (isDown && !isAtBottom) return false;
                    if (!isDown && !isAtTop) return false;
                }
                return true;
            };

            mainContainer.addEventListener('wheel', (e) => {
                const isDown = e.deltaY > 0;
                if (!canScrollWholePage(e, isDown)) return;
                e.preventDefault(); 
                if (isScrollingLocked) return; 
                if (isDown && currentPage < totalPages - 1) scrollToPage(currentPage + 1);
                else if (!isDown && currentPage > 0) scrollToPage(currentPage - 1);
            }, { passive: false });

            mainContainer.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
            mainContainer.addEventListener('touchmove', (e) => {
                if (!canScrollWholePage(e, touchStartY - e.touches[0].clientY > 0)) return;
                e.preventDefault();
            }, { passive: false });
            mainContainer.addEventListener('touchend', (e) => {
                const diffY = touchStartY - e.changedTouches[0].clientY;
                if (!canScrollWholePage(e, diffY > 0) || isScrollingLocked) return;
                if (diffY > 50 && currentPage < totalPages - 1) scrollToPage(currentPage + 1);
                else if (diffY < -50 && currentPage > 0) scrollToPage(currentPage - 1);
            });
        }

        function scrollToPage(index) {
            currentPage = index; isScrollingLocked = true; 
            document.getElementById('pages-wrapper').style.transform = \`translateY(-\${index * 100}vh)\`;
            document.querySelectorAll('.dot').forEach((dot, idx) => { dot.classList.toggle('active', idx === currentPage); });
            setTimeout(() => { isScrollingLocked = false; }, 600);
        }

        function renderAll() { 
            try {
                // renderWidgets('widget-grid-1', config.widgets1, 'widgets1'); // 已删除第一页组件渲染
                renderWidgets('widget-grid-2', config.widgets2, 'widgets2');
                renderIcons('app-grid-1', config.apps, 'apps1'); 
                renderIcons('app-grid-2', config.apps2, 'apps2'); 
                renderIcons('dock-container', config.dock, 'dock'); 

                // 初始化特殊组件挂载状态
                config.widgets1.concat(config.widgets2).forEach(w => {
                    if (w.type === 'notepad') {
                        const el = document.getElementById('note-'+w.id);
                        if(el) el.value = localStorage.getItem('note_'+w.id) || '';
                    }
                    if (w.type === 'music') {
                        initMusicPlayer(w.id);
                    }
                });
                
                historyList = []; rtnewsList = [];
                fetchHistoryWidget().catch(e=>{}); 
                fetchRTNewsWidget().catch(e=>{}); 
                fetchStockWidget().catch(e=>{});
            } catch(e) { console.error('RenderAll Error:', e); }
        }

        function renderIcons(id, list, type) {
            const el = document.getElementById(id); if(!el) return; el.innerHTML = '';
            (list||[]).forEach((item, i) => {
                const div = document.createElement('div');
                const fallback = \`https://ui-avatars.com/api/?name=\${encodeURIComponent(item.name)}&background=random\`;
                const icon = item.icon || fallback;
                div.innerHTML = \`<a href="\${item.url}" target="_blank" class="icon-card" data-idx="\${i}" data-type="\${type}" onclick="handleIconClick(event, '\${type}', \${i})"><div class="delete-btn" onclick="deleteIcon(event, '\${type}', \${i})">×</div><img src="\${icon}" class="icon-img" onerror="this.src='\${fallback}'"><span class="icon-title">\${item.name}</span></a>\`;
                el.appendChild(div.firstElementChild);
            });
        }

        function renderWidgets(id, list, type) {
            const el = document.getElementById(id); if(!el) return; el.innerHTML = '';
            (list||[]).forEach((item, i) => {
                // 判断是否是音乐组件，赋予其跨两行的专属 CSS 类
                const isMusic = item.type === 'music';
                const div = document.createElement('div'); 
                div.className = "widget-card" + (isMusic ? " widget-music-card" : ""); 
                div.setAttribute('data-idx', i); 
                div.setAttribute('data-type', type);
                div.innerHTML = \`<div class="delete-btn" onclick="deleteWidget(event, '\${type}', \${i})">×</div>\` + getWidgetHTML(item);
                el.appendChild(div);
            });
        }

        function handleIconClick(e, type, index) { if(isEditing) { e.preventDefault(); openEditIconModal(type, index); } }
        function deleteIcon(e, type, index) { e.preventDefault(); e.stopPropagation(); if(!confirm('删除此图标？')) return;
            if(type==='apps1') config.apps.splice(index, 1); else if(type==='apps2') config.apps2.splice(index, 1); else config.dock.splice(index, 1);
            hasUnsavedChanges = true; renderAll(); }
        function deleteWidget(e, type, index) { e.preventDefault(); e.stopPropagation(); if(!confirm('删除此小组件？')) return;
            if(type==='widgets1') config.widgets1.splice(index, 1); else config.widgets2.splice(index, 1);
            hasUnsavedChanges = true; renderAll(); }

        function rebuildConfig() {
            const apps1=[], apps2=[], dock=[], w1=[], w2=[];
            const getIconObj = (el) => (el.getAttribute('data-type')==='apps1'?config.apps : el.getAttribute('data-type')==='apps2'?config.apps2 : config.dock)[el.getAttribute('data-idx')];
            document.querySelectorAll('#app-grid-1 .icon-card').forEach(el => apps1.push(getIconObj(el)));
            document.querySelectorAll('#app-grid-2 .icon-card').forEach(el => apps2.push(getIconObj(el)));
            document.querySelectorAll('#dock-container .icon-card').forEach(el => dock.push(getIconObj(el)));
            config.apps = apps1; config.apps2 = apps2; config.dock = dock; 
            
            const getWidObj = (el) => (el.getAttribute('data-type')==='widgets1'?config.widgets1 : config.widgets2)[el.getAttribute('data-idx')];
            // document.querySelectorAll('#widget-grid-1 .widget-card').forEach(el => w1.push(getWidObj(el))); // 已删除第一页组件收集
            document.querySelectorAll('#widget-grid-2 .widget-card').forEach(el => w2.push(getWidObj(el)));
            config.widgets1 = w1; config.widgets2 = w2; renderAll();
        }

        function handleGearClick() {
            if (isEditing) { if (hasUnsavedChanges) { if(confirm("已修改，是否保存至服务器？")) openSettingsModal(); else toggleEditMode(); } else toggleEditMode(); } 
            else openSettingsModal();
        }
        function enterEditModeFromModal() { closeModal(); setTimeout(toggleEditMode, 200); }
        function toggleEditMode() {
            isEditing = !isEditing; document.body.classList.toggle('editing', isEditing);
            document.getElementById('add-placeholder').style.display = isEditing ? 'flex' : 'none';
            if (isEditing) {
                document.getElementById('btn-icon').src = "https://cdn-icons-png.flaticon.com/512/845/845646.png"; 
                renderAll(); hasUnsavedChanges = false;
                const optsIcon = { group:'i', animation:150, delay:100, delayOnTouchOnly:true, onEnd:()=>{ rebuildConfig(); hasUnsavedChanges=true; } };
                const optsWidget = { group:'w', animation:150, handle:'.widget-card', delay:100, delayOnTouchOnly:true, onEnd:()=>{ rebuildConfig(); hasUnsavedChanges=true; } };
                sortables.a1 = new Sortable(document.getElementById('app-grid-1'), optsIcon); sortables.a2 = new Sortable(document.getElementById('app-grid-2'), optsIcon); sortables.dock = new Sortable(document.getElementById('dock-container'), optsIcon);
                // sortables.w1 = new Sortable(document.getElementById('widget-grid-1'), optsWidget); // 已删除第一页组件排序
                sortables.w2 = new Sortable(document.getElementById('widget-grid-2'), optsWidget);
            } else {
                document.getElementById('btn-icon').src = "https://cdn-icons-png.flaticon.com/512/3953/3953226.png"; 
                Object.values(sortables).forEach(s => s && s.destroy()); sortables = {}; renderAll();
            }
        }

        async function fetchHitokoto() {
            try { 
                const res = await fetch('/api/quote');
                if(!res.ok) throw new Error();
                const data = await res.json();
                document.querySelectorAll('.c-hitokoto').forEach(el => el.innerText = data.hitokoto || "保持热爱，奔赴山海。");
                document.querySelectorAll('.c-hitokoto-from').forEach(el => el.innerText = "— " + (data.from_who || data.from || "MyTab"));
            } catch(e){
                document.querySelectorAll('.c-hitokoto').forEach(el => el.innerText = "生活明朗，万物可爱。");
                document.querySelectorAll('.c-hitokoto-from').forEach(el => el.innerText = "— MyTab");
            }
        }

        function initWeather() { 
            if (config.geo && config.geo.lat) {
                fetchWeather(config.geo.lat, config.geo.lng, config.geo.name); 
            } else if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude, "Local"),
                    (err) => fetchWeather(39.9042, 116.4074, "Beijing") 
                ); 
            } else {
                fetchWeather(39.9042, 116.4074, "Beijing");
            }
        }
        function getWeatherIcon(code) { if (code===0) return "☀️"; if(code<=3) return "⛅"; if(code>=45) return "🌧️"; return "☁️"; }
        async function fetchWeather(lat, lng, name) {
            try {
                const res = await fetch(\`https://api.open-meteo.com/v1/forecast?latitude=\${lat}&longitude=\${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=6\`);
                const data = await res.json();
                if(data.current) {
                    document.querySelectorAll('.c-w-temp').forEach(el => el.innerText = Math.round(data.current.temperature_2m) + "°");
                    document.querySelectorAll('.c-w-detail').forEach(el => el.innerText = \`湿\${data.current.relative_humidity_2m}% 风\${data.current.wind_speed_10m}km\`);
                    document.querySelectorAll('.c-w-icon').forEach(el => el.innerText = getWeatherIcon(data.current.weather_code));
                    let forecastHtml = '';
                    for(let i=1; i<=5; i++) { 
                        const min = Math.round(data.daily.temperature_2m_min[i]), max = Math.round(data.daily.temperature_2m_max[i]), ico = getWeatherIcon(data.daily.weather_code[i]);
                        const day = i===1 ? '明' : (i===2 ? '后' : new Date(new Date().setDate(new Date().getDate()+i)).toLocaleDateString('zh-CN',{weekday:'narrow'}));
                        forecastHtml += \`<div class="wf-item"><span>\${day}</span><span class="wf-icon">\${ico}</span><span class="wf-temp">\${min}°/\${max}°</span></div>\`;
                    }
                    document.querySelectorAll('.c-w-forecast').forEach(el => el.innerHTML = forecastHtml);
                }
            } catch(e){}
        }

        function toggleBgInput() { document.getElementById('bg-url-group').style.display = document.getElementById('bg-type').value === 'url' ? 'block' : 'none'; document.getElementById('bg-upload-group').style.display = document.getElementById('bg-type').value === 'upload' ? 'block' : 'none'; }
        function handleFileSelect(e, pid) { const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=(ev)=>{document.getElementById(pid).src=ev.target.result;document.getElementById(pid).style.display='block';}; r.readAsDataURL(f); }
        function previewNewIcon(v) { if(v) { document.getElementById('new-icon-preview').src=v; document.getElementById('new-icon-preview').style.display='block'; } }
        
        function hideAllForms() { document.getElementById('settings-form').style.display='none'; document.getElementById('icon-form').style.display='none'; document.getElementById('widget-form').style.display='none'; }
        function closeModal() { document.getElementById('configModal').classList.remove('active'); }

        // === 导出配置 ===
        function exportConfig() {
            try {
                const json = JSON.stringify(config, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'mytab-config-' + new Date().toISOString().slice(0,10) + '.json';
                a.click();
                URL.revokeObjectURL(a.href);
            } catch(e) {
                alert('导出失败：' + e.message);
            }
        }

        // === 导入配置 ===
        function importConfig(input) {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const imported = JSON.parse(e.target.result);
                    if (typeof imported !== 'object' || Array.isArray(imported)) throw new Error('无效的配置文件');
                    const pwd = document.getElementById('admin-pass').value;
                    if (!pwd) { alert('请先在下方输入密码再导入'); input.value = ''; return; }
                    const res = await fetch('/api/save', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ password: pwd, config: imported, weatherCity: imported.geo?.name || '', oldCity: config.geo?.name || '' })
                    });
                    const result = await res.json();
                    if (result.success) {
                        alert('导入成功！即将刷新页面');
                        location.reload();
                    } else {
                        alert('导入失败：' + (result.msg || '未知错误'));
                    }
                } catch(e) {
                    alert('导入失败：' + e.message);
                }
                input.value = '';
            };
            reader.readAsText(file);
        }
        function openSettingsModal() { 
            hideAllForms(); document.getElementById('modal-title').innerText="全局设置"; document.getElementById('settings-form').style.display='block'; document.getElementById('configModal').classList.add('active'); 
            if(config.geo && config.geo.name!=='Auto') document.getElementById('weather-city').value=config.geo.name; 
            document.getElementById('bg-type').value = config.bgType || 'url';
            if(config.bg && config.bg.startsWith('data:')) { document.getElementById('bg-url').value = ''; document.getElementById('bg-preview').src = config.bg; document.getElementById('bg-preview').style.display = 'block'; } else { document.getElementById('bg-url').value = config.bg || ''; document.getElementById('bg-preview').style.display = 'none'; }
            toggleBgInput(); 
        }
        function openAddIconModal() { 
            hideAllForms(); document.getElementById('modal-title').innerText="添加图标"; document.getElementById('icon-form').style.display='block'; document.getElementById('configModal').classList.add('active'); 
            document.getElementById('edit-icon-state').value='add'; document.getElementById('new-name').value=''; document.getElementById('new-url').value=''; document.getElementById('new-icon-url').value=''; document.getElementById('new-icon-preview').style.display='none'; document.getElementById('icon-target-group').style.display='block'; 
        }
        function openAddWidgetModal() { hideAllForms(); document.getElementById('modal-title').innerText="添加小组件"; document.getElementById('widget-form').style.display='block'; document.getElementById('configModal').classList.add('active'); }
        function openEditIconModal(t, i) { 
            hideAllForms(); document.getElementById('modal-title').innerText="修改图标"; document.getElementById('icon-form').style.display='block'; document.getElementById('configModal').classList.add('active'); 
            const item = (t==='apps1'?config.apps : t==='apps2'?config.apps2 : config.dock)[i];
            document.getElementById('edit-icon-state').value='edit'; document.getElementById('edit-icon-type').value=t; document.getElementById('edit-icon-index').value=i;
            document.getElementById('new-name').value=item.name; document.getElementById('new-url').value=item.url; document.getElementById('new-icon-preview').src=item.icon; document.getElementById('new-icon-preview').style.display='block'; document.getElementById('icon-target-group').style.display='none';
        }
        
        function saveIconData() {
            const name = document.getElementById('new-name').value; let url = document.getElementById('new-url').value;
            if(!name || !url) return alert('请填写名称和链接');
            if(!url.startsWith('http')) url = 'https://' + url;
            let icon = document.getElementById('new-icon-preview').src;
            
            // === 修改核心：如果没有手动上传或填写图片链接，则使用我们自己后端的 /api/icon 接口代理抓取 ===
            if(!document.getElementById('new-icon-file').files.length && !document.getElementById('new-icon-url').value && document.getElementById('edit-icon-state').value==='add') {
                let host = '';
                try { host = new URL(url).hostname; } catch(e) { host = url; }
                // 使用自己的 Worker 代理，解决大陆无法直接访问 Google Favicon 问题
                icon = \`/api/icon?domain=\${host}\`;
            }
            
            const item = {name, url, icon};
            if(document.getElementById('edit-icon-state').value==='add') { 
                const tgt = document.getElementById('new-icon-target').value;
                if(tgt==='dock') config.dock.push(item); else if(tgt==='apps2') config.apps2.push(item); else config.apps.push(item); 
            } else { 
                const t=document.getElementById('edit-icon-type').value, i=document.getElementById('edit-icon-index').value; 
                if(t==='apps1') config.apps[i]=item; else if(t==='apps2') config.apps2[i]=item; else config.dock[i]=item; 
            }
            hasUnsavedChanges = true; renderAll(); closeModal();
        }
        function saveWidgetData() {
            const type = document.getElementById('new-widget-type').value; const target = document.getElementById('new-widget-target').value;
            if (target === 'widgets1') config.widgets1.push({ id: 'w_' + Date.now(), type: type }); else config.widgets2.push({ id: 'w_' + Date.now(), type: type });
            hasUnsavedChanges = true; renderAll(); closeModal();
        }
        async function saveSettingsData() {
            const pwd = document.getElementById('admin-pass').value; if(!pwd) return alert('请输入密码');
            config.bgType = document.getElementById('bg-type').value;
            if(config.bgType === 'url') config.bg = document.getElementById('bg-url').value;
            else if(config.bgType === 'upload') { const previewSrc = document.getElementById('bg-preview').src; if(previewSrc && previewSrc.startsWith('data:')) config.bg = previewSrc; }
            const btn = document.querySelector('#settings-form .btn-primary'); btn.innerText='保存中...';
            try {
                const res = await fetch('/api/save', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({password:pwd, config, weatherCity:document.getElementById('weather-city').value, oldCity:config.geo.name})});
                const result = await res.json();
                if(result.success) {
                    alert('保存成功'); 
                    location.reload();
                } else {
                    alert('保存失败：' + (result.msg || '未知错误'));
                }
            } catch(e) { alert('网络错误或请求失败'); }
            btn.innerText='保存配置';
        }

        function initSearchEngine() { 
            document.querySelectorAll('.c-engine-dropdown').forEach(dd => {
                dd.innerHTML = '';
                Object.keys(engines).forEach(k => { 
                    const d = document.createElement('div'); d.className = 'engine-option'; d.innerHTML = \`<img src="\${engines[k].icon}">\${engines[k].name}\`; 
                    d.onclick = (e) => { e.stopPropagation(); setEngine(k); dd.classList.remove('show'); }; dd.appendChild(d); 
                });
            }); setEngine(currentEngineKey);
        }
        function setEngine(k) { currentEngineKey = k; localStorage.setItem('myTab_engine', k); document.querySelectorAll('.search-form-class').forEach(el => el.action = engines[k].url); document.querySelectorAll('.search-input-class').forEach(el => { el.name = engines[k].param; el.placeholder = engines[k].placeholder; }); document.querySelectorAll('.c-engine-icon').forEach(el => el.src = engines[k].icon); }
        function toggleEngineDropdown(e, el) { e.stopPropagation(); el.querySelector('.c-engine-dropdown').classList.toggle('show'); }
        function updateClock() { 
            const now = new Date(); const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
            document.querySelectorAll('.c-time').forEach(el => el.innerText = timeStr);
            document.querySelectorAll('.w-tz-time').forEach(el => { try { el.innerText = now.toLocaleTimeString('zh-CN', { timeZone: el.getAttribute('data-tz'), hour12: false, hour: '2-digit', minute: '2-digit' }); } catch(e){} });
        }

        init();
    </script>
</body>
</html>
  `;
}