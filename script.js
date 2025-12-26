// Check for file protocol on load
document.addEventListener('DOMContentLoaded', () => {
    if (window.location.protocol === 'file:') {
        const warning = document.getElementById('protocolWarning');
        if (warning) warning.style.display = 'block';
    }
});

function updateStatus(msg, type = '') {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    statusEl.innerText = msg;
    statusEl.className = '';
    if (type) statusEl.classList.add(`status-${type}`);
}

async function fetchWithProxy(url) {
    const proxies = [
        { url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, type: 'allorigins' },
        { url: `https://corsproxy.io/?${encodeURIComponent(url)}`, type: 'text' }
    ];

    let lastError = null;

    for (const proxy of proxies) {
        try {
            console.log(`Attempting fetch via: ${proxy.type}`);
            const response = await fetch(proxy.url);

            if (!response.ok) {
                console.warn(`Proxy ${proxy.type} returned status ${response.status}`);
                continue;
            }

            if (proxy.type === 'allorigins') {
                const data = await response.json();
                if (data && data.contents) return data.contents;
            } else {
                const text = await response.text();
                if (text && !text.includes('Error')) return text;
            }
        } catch (e) {
            console.warn(`Proxy ${proxy.type} failed:`, e);
            lastError = e;
        }
    }

    throw lastError || new Error('Network error or CORS block. Running from a web server is recommended.');
}

async function handleExtraction() {
    const btn = document.getElementById('extractBtn');
    const urlInput = document.getElementById('youtubeUrl');
    const box = document.getElementById('transcriptBox');
    const content = document.getElementById('transcriptContent');

    if (!btn || !urlInput || !box || !content) return;

    const url = urlInput.value.trim();
    const videoId = extractVideoId(url);

    if (!videoId) {
        updateStatus('Please enter a valid YouTube URL', 'error');
        return;
    }

    // UI Feedback
    btn.disabled = true;
    const originalBtnText = btn.innerText;
    btn.innerText = 'Extracting...';
    updateStatus('Connecting to YouTube...', 'loading');
    box.style.display = 'none';
    content.innerText = '';

    try {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const html = await fetchWithProxy(videoUrl);

        // Find ytInitialPlayerResponse in the page source
        // We look for the JSON object assigned to this variable (handles var, window., or bare)
        const regexBody = /ytInitialPlayerResponse\s*=\s*({[\s\S]+?});/;
        const match = html.match(regexBody);

        if (!match) {
            throw new Error('Could not find player data. The video might be private, age-restricted, or transcript-disabled.');
        }

        const data = JSON.parse(match[1]);
        const captions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;

        if (!captions || captions.length === 0) {
            throw new Error('No transcripts found for this video. Captions might be disabled.');
        }

        // Selection priority: English (manual) > English (auto) > Any first track
        const track = captions.find(t => t.languageCode === 'en' && !t.kind) ||
            captions.find(t => t.languageCode === 'en' || t.languageCode === 'a.en') ||
            captions[0];

        updateStatus(`Found ${track.name.simpleText || 'English'} transcript. Fetching segments...`, 'loading');

        const transcriptRaw = await fetchWithProxy(track.baseUrl + '&fmt=json3');
        const transcriptData = typeof transcriptRaw === 'string' ? JSON.parse(transcriptRaw) : transcriptRaw;

        if (!transcriptData.events) {
            throw new Error('Failed to parse transcript segments.');
        }

        // Merge segments into a single clean text
        const fullText = transcriptData.events
            .filter(event => event.segs)
            .map(event => event.segs.map(seg => seg.utf8).join(''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (fullText.length < 10) {
            throw new Error('Transcript seems to be empty or too short.');
        }

        updateStatus('Done! Transcript extracted successfully.', 'success');
        box.style.display = 'block';
        typeWriterEffect(content, fullText);

    } catch (error) {
        updateStatus(error.message, 'error');
        console.error('Extraction Error:', error);
    } finally {
        btn.disabled = false;
        btn.innerText = originalBtnText;
    }
}

function extractVideoId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

function typeWriterEffect(element, text) {
    let i = 0;
    element.innerText = '';
    const speed = 1; // High speed for better UX on long texts

    function type() {
        if (i < text.length) {
            // Type in small chunks for performance on long transcripts
            const chunk = text.substr(i, 5);
            element.innerText += chunk;
            i += 5;

            // Auto-scroll logic
            if (i % 50 === 0) {
                element.scrollTop = element.scrollHeight;
            }

            setTimeout(type, speed);
        } else {
            element.innerText = text; // Ensure final text is exact
            element.scrollTop = element.scrollHeight;
        }
    }
    type();
}

function copyToClipboard() {
    const text = document.getElementById('transcriptContent').innerText;
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copyBtn');
        const originalText = btn.innerText;
        btn.innerText = 'Copied! ✓';
        btn.style.borderColor = 'var(--success)';
        btn.style.color = 'var(--success)';

        setTimeout(() => {
            btn.innerText = originalText;
            btn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            btn.style.color = 'var(--text-main)';
        }, 2000);
    }).catch(err => {
        console.error('Copy failed:', err);
        updateStatus('Copy failed. Please select and copy manually.', 'error');
    });
}

// Support for "Enter" key
document.getElementById('youtubeUrl')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleExtraction();
});
