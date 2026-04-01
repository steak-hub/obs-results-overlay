const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());

// Serve static files (HTML, CSS, JS) from the current directory
app.use(express.static(__dirname));

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
        console.log(`Proxying request to: ${targetUrl}`);
        
        const response = await axios.get(targetUrl, {
            responseType: 'text',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            validateStatus: () => true // Allow all HTTP status codes without throwing
        });

        // Set the correct Content-Type from the original response (e.g. text/csv)
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
