/**
 * Cloudflare Worker: LX Music API Adapter
 * =============================================================
 * 对外暴露标准 LX Music API 协议，对内反代多家音乐 API，并加 KV 缓存。
 *
 * 部署步骤：
 *   1. Cloudflare 控制台 → Workers & Pages → Create → 粘贴本文件
 *   2. Settings → Variables → KV Namespace Bindings → 变量名填 LX_CACHE → 关联一个新建的 KV
 *   3. （可选）绑定自定义域名（推荐，避免 workers.dev 域名被墙），如果作为mytab项目的音乐API，直接使用workers.dev域名即可
 *   4. 把这个 Worker 的访问地址填到 mytab项目的设置面板「洛雪 API 地址」里
 *
 * 对外协议（LX Music 兼容）：
 *   GET /search?source={kw|tx|wy|mg}&keyword=&count=
 *        返回 { code:0, data:[{ songId, songName, singer, picUrl, albumName }] }
 *   GET /url?source=&id=&quality=320k
 *        返回 { code:0, data:{ url } }
 *   GET /pic?source=&id=
 *        返回 { code:0, data:{ url } }
 *   GET /ping
 *        健康检查，用于在 mytab 设置面板里点「测试连接」
 *
 * 内部多源 fallback 顺序：
 *   gdstudio → injahow meting → i-meto meting → 网易云官方搜索/直链
 *   全部失败时返回空，mytab 端会显示"加载失败"提示。
 *
 * 缓存策略（v1.1 优化）：
 *   - /search 缓存 1 分钟（命中后做随机洗牌，每次刷新都能看到不同顺序）
 *   - /url    缓存 3 分钟（缩短 TTL，避免缓存到已失效的 URL）
 *              + 命中后做 HEAD 健康检查，失效则跳过缓存重新取
 *              + 失败也缓存 30 秒（避免短时频繁敲打上游）
 *   - /pic    缓存 24 小时（封面几乎不变）
 *
 * 注意：LX 子源标识 kw/tx/wy/mg 在本适配器内部映射为：
 *   kw → kuwo (酷我)
 *   wy → netease (网易云)
 *   tx → netease (回退到网易云，因 gdstudio 不直接支持 tx)
 *   mg → netease (同上)
 */

// ============== 子源映射 ==============
// LX 源标识 → gdstudio 内部 source 名
const SOURCE_MAP = {
    'kw': 'kuwo',
    'wy': 'netease',
    'tx': 'netease',  // gdstudio 不直接支持 tx，回退到 netease
    'mg': 'netease'   // 同上
};
function mapSource(lxSource) {
    const s = (lxSource || 'kw').toLowerCase();
    return SOURCE_MAP[s] || 'netease';
}

// ============== 缓存工具 ==============
// 注意：缓存命中后会做洗牌，让每次刷新都能看到不同的歌单
async function cacheGet(env, key) {
    if (!env.LX_CACHE) return null;
    try {
        const v = await env.LX_CACHE.get('lx:' + key, { type: 'json' });
        return v;
    } catch (e) { return null; }
}
async function cacheSet(env, key, value, ttl) {
    if (!env.LX_CACHE) return;
    try {
        await env.LX_CACHE.put('lx:' + key, JSON.stringify(value), { expirationTtl: ttl });
    } catch (e) {}
}

// 简单数组洗牌（Fisher-Yates）
function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ============== 工具：超时 fetch ==============
async function fetchWithTimeout(url, opts = {}, timeout = 6000) {
    const res = await Promise.race([
        fetch(url, opts),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), timeout))
    ]);
    return res;
}

// ============== 统一 JSON 响应 ==============
function jsonOk(data) {
    return new Response(JSON.stringify({ code: 0, msg: 'success', data }), {
        headers: {
            'content-type': 'application/json;charset=UTF-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=30'
        }
    });
}
function jsonErr(msg, code = -1) {
    return new Response(JSON.stringify({ code, msg, data: null }), {
        headers: { 'content-type': 'application/json;charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
    });
}

// ============== /search 实现 ==============
async function handleSearch(url, env) {
    const lxSource = url.searchParams.get('source') || 'kw';
    const keyword  = url.searchParams.get('keyword') || '';
    const count    = parseInt(url.searchParams.get('count') || '18', 10);
    if (!keyword) return jsonErr('keyword required');

    const cacheKey = `search:${lxSource}:${keyword}:${count}`;
    const cached = await cacheGet(env, cacheKey);
    if (cached) {
        // 缓存命中后做随机洗牌，让每次刷新都能看到不同顺序
        return jsonOk(shuffleArray(cached));
    }

    const gdSource = mapSource(lxSource);
    let tracks = [];

    // ---- 链路 1: gdstudio ----
    try {
        const res = await fetchWithTimeout(
            `https://music-api.gdstudio.xyz/api.php?types=search&source=${gdSource}&name=${encodeURIComponent(keyword)}&count=${count}`,
            { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music-api.gdstudio.xyz/' } },
            6000
        );
        if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list) && list.length > 0) {
                tracks = list.map(item => ({
                    songId:    String(item.id || ''),
                    songName:  item.name || '未知',
                    singer:    Array.isArray(item.artist) ? item.artist.join(' / ')
                              : (typeof item.artist === 'string' ? item.artist : '未知'),
                    albumName: item.album || '',
                    picUrl:    item.pic_url || '',
                    picId:     String(item.pic_id || item.id || ''),
                    source:    lxSource
                })).filter(t => t.songId && t.songName);
            }
        }
    } catch (e) { /* 继续 fallback */ }

    // ---- 链路 2: 网易云官方 ----
    if (tracks.length === 0) {
        try {
            const fetchCount = Math.min(count * 3, 100);
            const fbRes = await fetch('https://music.163.com/api/cloudsearch/pc', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0',
                    'Referer': 'https://music.163.com/',
                    'Cookie': 'os=pc;'
                },
                body: `s=${encodeURIComponent(keyword)}&type=1&limit=${fetchCount}&offset=0`
            });
            const fbData = await fbRes.json();
            if (fbData && fbData.result && fbData.result.songs) {
                tracks = fbData.result.songs
                    .filter(song => song.fee === 0 || song.fee === 8)
                    .slice(0, count)
                    .map(song => ({
                        songId:    String(song.id),
                        songName:  song.name,
                        singer:    song.ar ? song.ar.map(a => a.name).join(' / ') : '未知',
                        albumName: song.al ? song.al.name : '',
                        picUrl:    song.al && song.al.picUrl ? song.al.picUrl : '',
                        picId:     song.al ? String(song.al.id) : String(song.id),
                        source:    'wy'
                    }));
            }
        } catch (e) { /* 忽略 */ }
    }

    if (tracks.length === 0) return jsonErr('no results');
    await cacheSet(env, cacheKey, tracks, 60); // 1 分钟，刷新后能看到新顺序
    return jsonOk(tracks);
}

// ============== /url 实现 ==============
async function handleUrl(url, env) {
    const lxSource = url.searchParams.get('source') || 'kw';
    const id       = url.searchParams.get('id');
    const quality  = url.searchParams.get('quality') || '320k';
    if (!id) return jsonErr('id required');

    const cacheKey = `url:${lxSource}:${id}:${quality}`;
    const cached = await cacheGet(env, cacheKey);

    // 缓存命中后做健康检查，确保 URL 还有效
    if (cached && cached.url) {
        const stillValid = await isUrlAlive(cached.url);
        if (stillValid) {
            return jsonOk(cached);
        }
        // URL 已失效，删掉旧缓存继续重新获取
        try { await env.LX_CACHE.delete('lx:' + cacheKey); } catch (e) {}
        console.log(`[lx-api-adapter] cached URL expired, refetching: ${id}`);
    }

    const gdSource = mapSource(lxSource);
    let finalUrl = '';
    const failReasons = [];

    // ---- 链路 1: gdstudio ----
    if (!finalUrl) {
        try {
            const res = await fetchWithTimeout(
                `https://music-api.gdstudio.xyz/api.php?types=url&source=${gdSource}&id=${id}`,
                { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music-api.gdstudio.xyz/' } },
                6000
            );
            if (res.ok) {
                const data = await res.json();
                if (data.url) finalUrl = data.url;
                else failReasons.push(`gdstudio: empty url`);
            } else failReasons.push(`gdstudio: HTTP ${res.status}`);
        } catch (e) { failReasons.push(`gdstudio: ${e.message}`); }
    }

    // ---- 链路 2: injahow meting ----
    if (!finalUrl) {
        try {
            const res = await fetchWithTimeout(
                `https://api.injahow.cn/meting/?server=${gdSource}&type=url&id=${id}`,
                { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://api.injahow.cn/' } },
                6000
            );
            if (res.ok) {
                const d = await res.json();
                const u = Array.isArray(d) ? (d[0] && d[0].url) : (d && d.url);
                if (u) finalUrl = u;
                else failReasons.push(`injahow: empty url`);
            } else failReasons.push(`injahow: HTTP ${res.status}`);
        } catch (e) { failReasons.push(`injahow: ${e.message}`); }
    }

    // ---- 链路 3: i-meto meting ----
    if (!finalUrl) {
        try {
            const res = await fetchWithTimeout(
                `https://api.i-meto.com/meting/api?server=${gdSource}&type=url&id=${id}`,
                { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://api.i-meto.com/' } },
                6000
            );
            if (res.ok) {
                const d = await res.json();
                const u = Array.isArray(d) ? (d[0] && d[0].url) : (d && d.url);
                if (u) finalUrl = u;
                else failReasons.push(`i-meto: empty url`);
            } else failReasons.push(`i-meto: HTTP ${res.status}`);
        } catch (e) { failReasons.push(`i-meto: ${e.message}`); }
    }

    // ---- 链路 4: 网易云直链 (仅当 source 是 netease 才兜底) ----
    if (!finalUrl && gdSource === 'netease' && /^\d+$/.test(id)) {
        const directUrl = `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
        // 健康检查网易云直链（避免返回已失效的 404 重定向）
        if (await isUrlAlive(directUrl)) {
            finalUrl = directUrl;
        } else {
            failReasons.push(`netease direct: 404 (song offline or VIP only)`);
        }
    }

    // 如果所有链路都失败，记录详细原因到日志
    if (!finalUrl) {
        console.warn(`[lx-api-adapter] /url failed for source=${lxSource} id=${id}: ${failReasons.join(' | ')}`);
        // 失败也缓存 30 秒，避免短时频繁重试敲打上游
        // 30 秒后自动过期，重新尝试
        await cacheSet(env, cacheKey, { url: '', source: lxSource, quality, _debug: failReasons }, 30);
        return jsonOk({ url: '', source: lxSource, quality, _debug: failReasons });
    }

    const payload = { url: finalUrl, source: lxSource, quality };
    await cacheSet(env, cacheKey, payload, 180); // 3 分钟（缩短 TTL，避开 URL 失效）
    return jsonOk(payload);
}

// ============== URL 健康检查 ==============
// 通过 HEAD 请求验证 URL 是否还能访问
// 处理 302 重定向到 404 的情况（网易云直链的常见失败模式）
async function isUrlAlive(url) {
    try {
        const res = await fetchWithTimeout(url,
            { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } },
            4000
        );
        // 200 = 直接可用
        if (res.status === 200) return true;
        // 302 = 看重定向到哪里
        if (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) {
            const location = res.headers.get('location') || '';
            // 重定向到 404 页面 = 失效
            if (location.includes('/404') || location.includes('error')) return false;
            // 重定向到其他 CDN = 可用
            return true;
        }
        // 其他状态码（403/404/5xx）= 不可用
        return false;
    } catch (e) {
        // 网络错误、超时 = 视为不可用
        return false;
    }
}

// ============== /pic 实现 ==============
async function handlePic(url, env) {
    const lxSource = url.searchParams.get('source') || 'kw';
    const id       = url.searchParams.get('id');
    if (!id) return jsonErr('id required');

    const cacheKey = `pic:${lxSource}:${id}`;
    const cached = await cacheGet(env, cacheKey);
    if (cached && cached.url) return jsonOk(cached);

    const gdSource = mapSource(lxSource);
    let finalUrl = '';

    // ---- 链路 1: gdstudio pic ----
    try {
        const res = await fetchWithTimeout(
            `https://music-api.gdstudio.xyz/api.php?types=pic&size=300&source=${gdSource}&id=${id}`,
            { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music-api.gdstudio.xyz/' } },
            6000
        );
        if (res.ok) {
            const data = await res.json();
            if (data.url) finalUrl = data.url;
        }
    } catch (e) { /* 继续 */ }

    // ---- 链路 2: 网易云封面（id 是数字时直接构造） ----
    if (!finalUrl && /^\d+$/.test(id)) {
        finalUrl = `https://p1.music.126.net/?id=${id}&size=300x300.jpg`;
    }

    const payload = { url: finalUrl };
    await cacheSet(env, cacheKey, payload, 86400); // 24 小时
    return jsonOk(payload);
}

// ============== /ping 实现 ==============
async function handlePing(env) {
    let cacheOk = false;
    try {
        if (env.LX_CACHE) {
            await env.LX_CACHE.put('lx:_ping_test', '1', { expirationTtl: 60 });
            const v = await env.LX_CACHE.get('lx:_ping_test');
            cacheOk = v === '1';
        }
    } catch (e) {}
    return jsonOk({
        ok: true,
        service: 'lx-api-adapter',
        time: Date.now(),
        cache_bound: !!env.LX_CACHE,
        cache_writable: cacheOk
    });
}

// ============== 主入口 ==============
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // CORS 预检
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': '*'
                }
            });
        }

        try {
            if (url.pathname === '/ping')   return await handlePing(env);
            if (url.pathname === '/search') return await handleSearch(url, env);
            if (url.pathname === '/url')    return await handleUrl(url, env);
            if (url.pathname === '/pic')    return await handlePic(url, env);

            // 兜底：根路径返回服务信息
            if (url.pathname === '/' || url.pathname === '') {
                return new Response(JSON.stringify({
                    service: 'LX Music API Adapter (Cloudflare Worker)',
                    endpoints: ['/search', '/url', '/pic', '/ping'],
                    note: 'For mytab.js music engine = lx mode'
                }), { headers: { 'content-type': 'application/json;charset=UTF-8' } });
            }

            return jsonErr('not found', 404);
        } catch (e) {
            return jsonErr('internal error: ' + e.message, 500);
        }
    }
};
