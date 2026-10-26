const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// --- ORTAK FONKSİYONLAR ---

// M3U8 dosyasının içindeki .ts linklerini bizim proxy'e yönlendiren fonksiyon
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

// Ortak yayın çekme fonksiyonu (Her iki endpoint de aynı yayını verir)
async function handleStreamRequest(req, res) {
    try {
        const response = await axios.get(STREAM_URL, {
            headers: batutestHeaders,
            responseType: 'text'
        });
        const rewrittenM3u8 = rewriteM3u8(response.data, BASE_URL);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewrittenM3u8);
    } catch (error) {
        console.error("M3U8 hatası:", error.message);
        res.status(500).send('M3U8 yayını alınamadı.');
    }
}

// Her iki adresten de aynı yayına erişebilirsiniz (index.html bozulmasın diye ikisi de aktif)
app.get('/stream/batutest.m3u8', handleStreamRequest);
app.get('/stream/yeni-kanal', handleStreamRequest);

// --- ORTAK TS PROXY (Video Parçacıkları İçin) ---
app.get('/ts-proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL eksik.');

    const headersToUse = targetUrl.includes('evrenesoglu101.click') 
        ? batutestHeaders 
        : { 'User-Agent': 'Mozilla/5.0' };

    try {
        const response = await axios.get(targetUrl, {
            headers: headersToUse,
            responseType: 'stream'
        });
        res.setHeader('Content-Type', 'video/MP2T');
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('TS dosyası alınamadı.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Proxy sunucusu çalışıyor: port ${PORT}`);
});
