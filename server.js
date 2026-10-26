const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const http = require('http');
const https = require('https');
const { pipeline } = require('stream');

const app = express();
app.use(cors());

// --- BELLEK DOSTU BAĞLANTI HAVUZU (Keep-Alive) ---
// Her .ts parçası için yeni soket açıp RAM şişirmesini engeller
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 30, maxFreeSockets: 5 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 30, maxFreeSockets: 5 });

const axiosInstance = axios.create({
    httpAgent,
    httpsAgent,
    timeout: 10000 // 10 saniyede yanıt vermeyen asılı bağlantıları öldür
});

// --- ORTAK FONKSİYONLAR ---

function rewriteM3u8(m3u8Content, baseUrl) {
    return m3u8Content.split('\n').map(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            const absoluteUrl = trimmedLine.startsWith('http') ? trimmedLine : baseUrl + trimmedLine;
            return `https://yayin-pn82.onrender.com/ts-proxy?url=${encodeURIComponent(absoluteUrl)}`;
        }
        return line;
    }).join('\n');
}

// Ana dizin
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- YAYIN AYARLARI (BATUTEST) ---
const STREAM_URL = 'https://andro.evrenesoglu101.click/checklist/batutest.m3u8';
const BASE_URL = 'https://andro.evrenesoglu101.click/checklist/';

const batutestHeaders = {
    'accept': '*/*',
    'origin': 'https://8602741.xyz',
    'referer': 'https://8602741.xyz/',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
};

// M3U8 için 1.5 saniyelik mini RAM önbelleği (Aynı anda birden fazla istek gelirse sunucuyu yormaz)
let m3u8Cache = { data: null, timestamp: 0 };

async function handleStreamRequest(req, res) {
    try {
        const now = Date.now();
        if (m3u8Cache.data && (now - m3u8Cache.timestamp < 1500)) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(m3u8Cache.data);
        }

        const response = await axiosInstance.get(STREAM_URL, {
            headers: batutestHeaders,
            responseType: 'text'
        });

        const rewrittenM3u8 = rewriteM3u8(response.data, BASE_URL);
        m3u8Cache = { data: rewrittenM3u8, timestamp: now };

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewrittenM3u8);
    } catch (error) {
        console.error("M3U8 hatası:", error.message);
        res.status(500).send('M3U8 yayını alınamadı.');
    }
}

app.get('/stream/batutest.m3u8', handleStreamRequest);
app.get('/stream/yeni-kanal', handleStreamRequest);

// --- BELLEK SIZINTISI KORUMALI TS PROXY ---
app.get('/ts-proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL eksik.');

    const headersToUse = targetUrl.includes('evrenesoglu101.click') 
        ? batutestHeaders 
        : { 'User-Agent': 'Mozilla/5.0' };

    // İstemci bağlantıyı koparırsa Axios isteğini anında iptal etmek için
    const controller = new AbortController();

    req.on('close', () => {
        if (!res.writableEnded) {
            controller.abort();
        }
    });

    try {
        const response = await axiosInstance.get(targetUrl, {
            headers: headersToUse,
            responseType: 'stream',
            signal: controller.signal,
            decompress: false // Video verisini sıkıştırma/açma ile RAM harcama
        });

        res.setHeader('Content-Type', 'video/MP2T');
        res.setHeader('Cache-Control', 'public, max-age=60');

        // pipeline() hata veya kopma durumunda stream'leri otomatik yok eder (destroy) ve RAM'i temizler
        pipeline(response.data, res, (err) => {
            if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
                // İstemci ayrıldığında oluşan normal kapanmaları loglayıp şişirme
            }
            if (response.data && !response.data.destroyed) {
                response.data.destroy();
            }
        });
    } catch (error) {
        if (!axios.isCancel(error) && !res.headersSent) {
            res.status(500).send('TS dosyası alınamadı.');
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Proxy sunucusu çalışıyor: port ${PORT}`);
});
