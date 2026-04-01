const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());

// dont only use security by obscurity
const allowedFiles = ['/', '/index.html', '/settings.html', '/style.css', '/ticker.js'];
app.get(allowedFiles, (req, res, next) => {
    let filePath = req.path === '/' ? 'index.html' : req.path.slice(1);
    res.sendFile(path.join(__dirname, filePath));
});

/**
 * Proxy endpoint to bypass CORS
 * Usage: /proxy?url=HTTPS_ENCODED_URL
 */
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('No URL provided in query parameter "url".');
    }

    try {
        const parsedUrl = new URL(targetUrl);
        
        // Only allow HTTPS and restricted to Matchplay domain (address SSRF risk)
        if (parsedUrl.protocol !== 'https:') {
            return res.status(403).send('Only HTTPS URLs are allowed.');
        }

        const allowedHosts = ['app.matchplay.events'];
        if (!allowedHosts.includes(parsedUrl.hostname)) {
            return res.status(403).send(`Restricted domain: ${parsedUrl.hostname} is not allowed.`);
        }

        console.log(`Proxying request to: ${targetUrl}`);
        
        const response = await axios.get(targetUrl, {
            responseType: 'text',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            validateStatus: () => true 
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'text/plain');
        res.status(response.status).send(response.data);
    } catch (error) {
        console.error('Error proxying request:', error.message);
        res.status(500).send(`Failed to fetch URL: ${error.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`- Overlay: http://localhost:${PORT}`);
    console.log(`- Proxy Example: http://localhost:${PORT}/proxy?url=https://www.google.com`);
});
