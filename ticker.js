// ticker.js

// ==== Configuration ====
const POLL_INTERVAL_MS = 15000; // Check for new games every 15 seconds
const MAX_QUEUE_SIZE = 50; 

// ==== State ====
let seenGameIds = new Set();
let resultQueue = [];
let isDisplaying = false;

// List of public CORS proxies to try if one fails
const PROXIES = [
    (window.location.protocol === 'file:') ? 'http://localhost:8080/proxy?url=' : '/proxy?url=',
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://thingproxy.freeboard.io/fetch/'
];
let currentProxyIndex = 0;

// Mapping to ensure Round IDs translate to sequential Round numbers (1, 2, 3...)
let roundIdToNumber = new Map();

// Attempt to parse parameters from the query string
const urlParams = new URLSearchParams(window.location.search);
const tournamentId = urlParams.get('tournament');
const customDisplayDuration = parseInt(urlParams.get('speed')) || 6; // seconds
const DISPLAY_DURATION_MS = customDisplayDuration * 1000;
const customTitle = urlParams.get('title') || 'LATEST RESULTS';
const customBgColor = urlParams.get('bgColor');
const customAccentColor = urlParams.get('accentColor');
const customGameNameColor = urlParams.get('gameNameColor');
const layoutStyle = urlParams.get('layout') || 'horizontal';
const anchorPos = urlParams.get('anchor') || 'bottom-left';
const boxWidth = urlParams.get('width');

// Metadata from extra API calls to handle sparse CSV data
let roundIdToNameMap = new Map();
let arenaIdToNameMap = new Map();
let gamesPerRound = 1;

const tickerContainer = document.getElementById('ticker-container');
const tickerContent = document.getElementById('ticker-content');
const tickerLabel = document.querySelector('.ticker-label');

// Apply custom title
if (tickerLabel && customTitle) {
    tickerLabel.textContent = customTitle.toUpperCase();
}

// Apply layout styles
if (layoutStyle === 'vertical') {
    document.body.classList.add('layout-vertical');
    if (boxWidth) {
        document.documentElement.style.setProperty('--box-width', `${boxWidth}px`);
    }
    tickerContainer.classList.add(`anchor-${anchorPos}`);
}

// Apply custom colors to CSS variables
if (customBgColor) {
    // Add opacity roughly equivalent to the original 0.85
    document.documentElement.style.setProperty('--bg-color', `#${customBgColor}d9`);
}
if (customAccentColor) {
    document.documentElement.style.setProperty('--accent-color', `#${customAccentColor}`);
    
    // Specifically override the ticker label gradient to use variations of the accent color
    if (tickerLabel) {
        tickerLabel.style.background = `linear-gradient(135deg, #${customAccentColor}, #${customAccentColor}dd)`;
    }
}

if (customGameNameColor) {
    document.documentElement.style.setProperty('--game-name-color', `#${customGameNameColor}`);
}

/**
 * Fetch tournament settings and round names to handle sparse CSV data
 */
async function fetchTournamentMetadata(id) {
    const tournamentUrl = `https://app.matchplay.events/api/tournaments/${id}`;
    const roundsUrl = `https://app.matchplay.events/api/tournaments/${id}/rounds`;

    for (let proxyIndex = 0; proxyIndex < PROXIES.length; proxyIndex++) {
        const proxyBase = PROXIES[proxyIndex];
        try {
            // 1. Fetch Tournament Info (for games per round)
            const tResponse = await fetch(proxyBase + encodeURIComponent(tournamentUrl));
            if (tResponse.ok) {
                const tJson = await tResponse.json();
                const tData = tJson.data || tJson;
                gamesPerRound = parseInt(tData.gamesPerRound) || 1;
            }

            // 2. Fetch Rounds Info (for name mapping)
            const rResponse = await fetch(proxyBase + encodeURIComponent(roundsUrl));
            if (rResponse.ok) {
                const rJson = await rResponse.json();
                const rData = rJson.data || rJson;
                if (Array.isArray(rData)) {
                    rData.forEach(r => {
                        roundIdToNameMap.set(String(r.roundId), r.name);
                    });
                }
            }

            // 3. Fetch Arena Info (for machine names)
            // Using the main tournament endpoint with includeArenas
            const aUrl = `${tournamentUrl}?includeArenas=true`;
            const aResponse = await fetch(proxyBase + encodeURIComponent(aUrl));
            if (aResponse.ok) {
                const aJson = await aResponse.json();
                const arenas = aJson.data?.arenas || aJson.arenas;
                if (Array.isArray(arenas)) {
                    arenas.forEach(a => {
                        arenaIdToNameMap.set(String(a.arenaId), a.name);
                    });
                }
            }
            return; // Success!
        } catch (err) {
            console.warn(`Proxy ${proxyBase} failed for metadata:`, err);
        }
    }
}

// Require a tournament ID
if (!tournamentId) {
    showDebug('Error: No "tournament" ID provided in URL parameters.');
} else {
    // Start with metadata fetch, then poll CSV
    const setup = async () => {
        await fetchTournamentMetadata(tournamentId);
        
        const csvUrl = `https://app.matchplay.events/api/tournaments/${tournamentId}/games/csv`;
        // Fire immediate initial poll
        fetchAndParseCSV(csvUrl);
        // Poll periodically
        setInterval(() => fetchAndParseCSV(csvUrl), POLL_INTERVAL_MS);
    };
    setup();
}

function showDebug(msg) {
    tickerContainer.classList.remove('hidden');
    const item = document.createElement('div');
    item.className = 'ticker-item active';
    item.style.cssText = 'color: #ef4444; font-size: 16px; white-space: normal;';
    item.textContent = msg;
    tickerContent.innerHTML = '';
    tickerContent.appendChild(item);
}

/**
 * Fetch the latest CSV from matchplay and pass it to PapaParse
 */
async function fetchAndParseCSV(url) {
    let lastError = null;

    // Try each proxy until one works
    for (let i = 0; i < PROXIES.length; i++) {
        const proxyIndex = (currentProxyIndex + i) % PROXIES.length;
        const proxyBase = PROXIES[proxyIndex];
        const proxyUrl = proxyBase + encodeURIComponent(url);

        try {
            const response = await fetch(proxyUrl);
            if (!response.ok) {
                // If the proxy correctly forwarded a 4xx error (e.g., 404 not found, 429 rate limit),
                // it means the proxy is working, but Matchplay has an issue or no data yet.
                // We should not cycle proxies.
                if (response.status >= 400 && response.status < 500) {
                    console.warn(`Upstream API returned ${response.status} via ${proxyBase}. Retrying next poll.`);
                    currentProxyIndex = proxyIndex;
                    return;
                }
                throw new Error(`Proxy error: ${response.status}`);
            }

            const csvText = await response.text();

            // If we got here, it worked!
            currentProxyIndex = proxyIndex;
            Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                complete: function(results) {
                    processMatchplayResults(results.data);
                },
                error: function(err) {
                    console.error("PapaParse failed to parse CSV:", err);
                    showDebug(`JSON Parse Error: ${err}`);
                }
            });
            return; // Success!

        } catch (err) {
            console.warn(`Proxy ${proxyBase} failed:`, err);
            lastError = err;
        }
    }

    // If we get here, all proxies failed
    console.error("All proxies failed to fetch Matchplay data.", lastError);
    showDebug(`Fetch Error: ${lastError ? lastError.message : 'All proxies failed'}. Retrying in ${POLL_INTERVAL_MS/1000}s...`);
}

/**
 * Helper to get a value from a row using multiple possible keys (case-insensitive)
 */
function getFieldValue(row, variants) {
    if (!row) return { value: '', key: '' };
    const keys = Object.keys(row);
    for (const variant of variants) {
        // Try exact match first
        if (row[variant] !== undefined) return { value: row[variant], key: variant };
        
        // Try case-insensitive match
        const lowerVariant = variant.toLowerCase().replace(/[\s_-]/g, '');
        const foundKey = keys.find(k => k.toLowerCase().replace(/[\s_-]/g, '') === lowerVariant);
        if (foundKey) return { value: row[foundKey], key: foundKey };
    }
    return { value: '', key: '' };
}

/**
 * Group CSV rows by Game ID, discover new games, and enqueue them
 */
function processMatchplayResults(rows) {
    if (!rows || rows.length === 0) return;

    // First, find all unique Round IDs/indices and sort them to assign sequential round numbers
    const uniqueRoundIds = [...new Set(rows.map(r => {
        return getFieldValue(r, ['Round ID', 'Round index', 'round_id', 'round_index']).value;
    }).filter(id => id))]
    .sort((a, b) => parseInt(a) - parseInt(b));
    
    uniqueRoundIds.forEach((id, index) => {
        if (!roundIdToNumber.has(id)) {
            roundIdToNumber.set(id, index + 1);
        }
    });

    const games = {};
    
    // Group all rows by "Game ID"
    rows.forEach(row => {
        const gameId = getFieldValue(row, ['Game ID', 'Game index', 'game_id', 'game_index']).value;
        const roundId = getFieldValue(row, ['Round ID', 'Round index', 'round_id', 'round_index']).value;
        
        if (!gameId) return;
        
        if (!games[gameId]) {
            // Try CSV first, then fall back to ID mapping
            let roundName = getFieldValue(row, ['Round name', 'round_name', 'Round Name']).value;
            if (!roundName && roundId) {
                roundName = roundIdToNameMap.get(String(roundId)) || '';
            }

            const gameRes = getFieldValue(row, ['Game', 'game_index', 'Game index', 'Set']);
            let gameNumber = gameRes.value;
            
            // Matchplay data often starts at 0 for these columns.
            // If the column name is 'Game', 'Set', or any 'index' field, 
            // and the value is numeric, we shift the entire series to be 1-based.
            if (gameNumber !== '' && !isNaN(gameNumber)) {
                let num = parseInt(gameNumber);
                const k = gameRes.key.toLowerCase();
                if (k.includes('index') || k === 'game' || k === 'set') {
                    gameNumber = num + 1;
                }
            }
            
            const arenaRes = getFieldValue(row, ['Arena name', 'arena_name', 'Arena Name']);
            let arenaName = arenaRes.value;
            if (!arenaName) {
                const arenaId = getFieldValue(row, ['Arena ID', 'arena_id', 'Arena ID']).value;
                arenaName = arenaIdToNameMap.get(String(arenaId)) || '';
            }

            games[gameId] = {
                players: [],
                round: roundIdToNumber.get(roundId) || 1,
                roundName: roundName || '',
                gameNumber: gameNumber || '',
                totalGames: gamesPerRound,
                arenaName: arenaName || ''
            };
        }
        
        games[gameId].players.push({
            playerName: getFieldValue(row, ['Player name', 'player_name', 'Player Name']).value || 'Unknown Player',
            points: parseFloat(getFieldValue(row, ['Points', 'points']).value) || 0,
            score: parseFloat(getFieldValue(row, ['Score', 'score']).value) || 0
        });
    });

    let newGamesAdded = false;
    const isFirstPoll = seenGameIds.size === 0;
    const recentGamesToQueue = [];
    
    // Sort game IDs ascending to process them chronologically
    const gameIds = Object.keys(games).sort((a,b) => parseInt(a) - parseInt(b));

    for (const gameId of gameIds) {
        const gameData = games[gameId];
        const players = gameData.players;
        
        // We assume a game is "done" if anyone has points or a non-zero score recorded
        const isCompleted = players.some(p => p.points > 0 || p.score > 0);

        if (isCompleted && !seenGameIds.has(gameId)) {
            seenGameIds.add(gameId);
            
            // Sort players internally: highest points first, then highest score
            players.sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                return b.score - a.score;
            });

            recentGamesToQueue.push({ 
                gameId, 
                players, 
                round: gameData.round,
                roundName: gameData.roundName,
                gameNumber: gameData.gameNumber,
                totalGames: gameData.totalGames,
                arenaName: gameData.arenaName
            });
        }
    }

    if (isFirstPoll) {
        // On the very first load, we don't want to spam 50+ past matches.
        // We only grab the 3 most recently finished matches to put into the ticker.
        const toAdd = recentGamesToQueue.slice(-3);
        if (toAdd.length > 0) {
            resultQueue.push(...toAdd);
            newGamesAdded = true;
        }
    } else {
        if (recentGamesToQueue.length > 0) {
            resultQueue.push(...recentGamesToQueue);
            newGamesAdded = true;
        }
    }

    // Keep the queue size bounded just in case there's an influx of game data
    if (resultQueue.length > MAX_QUEUE_SIZE) {
        resultQueue = resultQueue.slice(resultQueue.length - MAX_QUEUE_SIZE);
    }

    // If we're not running the animation loop and we have new matches, start it
    if (newGamesAdded && !isDisplaying) {
        startDisplayQueue();
    }
}

function startDisplayQueue() {
    if (resultQueue.length === 0) {
        tickerContainer.classList.add('hidden');
        isDisplaying = false;
        return;
    }

    isDisplaying = true;
    tickerContainer.classList.remove('hidden');
    
    displayNextResult();
}

function displayNextResult() {
    if (resultQueue.length === 0) {
        // Queue empty, gracefully hide the ticker
        setTimeout(() => {
            if (resultQueue.length === 0) {
                tickerContainer.classList.add('hidden');
                isDisplaying = false;
                
                // Clear out DOM elements except the one exiting
                setTimeout(() => {
                    tickerContent.innerHTML = ''; 
                }, 600); // Wait for transition out
            } else {
                displayNextResult();
            }
        }, 1200);
        return;
    }

    const game = resultQueue.shift();
    
    const itemEl = document.createElement('div');
    itemEl.className = 'ticker-item';
    
    // Determine the label: if it's a special round name, use it. 
    // Otherwise use the sequential round number.
    let roundLabelText = `ROUND ${game.round}`;
    let isSpecial = false;
    
    if (game.roundName) {
        const name = game.roundName.trim();
        // Regex to check if it's a "normal" round (e.g. "Round 1", "Round 10")
        const isNormalRound = /^round\s+\d+$/i.test(name);
        
        if (!isNormalRound && name.length > 0) {
            roundLabelText = name.toUpperCase();
            isSpecial = true;
        }
    }

    // Append Game number if it's a multi-game series
    if (game.gameNumber && game.totalGames > 1) {
        roundLabelText += ` - GAME ${game.gameNumber}/${game.totalGames}`;
    } else if (game.gameNumber) {
        // Fallback for single game but index exists (e.g. "GAME 1")
        roundLabelText += ` - GAME ${game.gameNumber}`;
    }

    let htmlContent = `<div class="round-label ${isSpecial ? 'special-round' : ''}">${roundLabelText}</div>`;
    
    if (game.arenaName) {
        htmlContent += `<div class="arena-label">${game.arenaName.toUpperCase()}</div>`;
    }
    
    const escapeHTML = (str) => String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);

    // Build the string representation of all players in this single game
    game.players.forEach((p, index) => {
        const posClass = `pos-${index + 1}`;
        htmlContent += `
            <div class="player-entry">
                <span class="position-badge ${posClass}">${index + 1}</span>
                <span class="player-name">${escapeHTML(p.playerName)}</span>
            </div>
        `;
    });
    itemEl.innerHTML = htmlContent;
    
    tickerContent.appendChild(itemEl);
    
    // Force a browser reflow, so that the .active class triggers a CSS transition
    void itemEl.offsetWidth; 
    itemEl.classList.add('active');

    // Dynamically adjust height for vertical layout so the box hugs the content perfectly
    if (layoutStyle === 'vertical') {
        tickerContent.style.height = `${itemEl.offsetHeight + 40}px`; // 40px accounts for top/bottom padding
    }

    // Retrieve old active items and trigger their exit animations
    const oldItems = tickerContent.querySelectorAll('.ticker-item.active:not(:last-child)');
    oldItems.forEach(oldItem => {
        oldItem.classList.remove('active');
        oldItem.classList.add('exit');
        
        // Remove from DOM when animation finishes
        setTimeout(() => {
            if (oldItem.parentNode) {
                oldItem.parentNode.removeChild(oldItem);
            }
        }, 600); 
    });

    // Schedule the next swap
    setTimeout(() => {
        displayNextResult();
    }, DISPLAY_DURATION_MS);
}
