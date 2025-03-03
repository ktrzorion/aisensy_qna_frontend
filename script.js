// Global state
let isProcessing = false;
let hasScrapedContent = false;
let userId = localStorage.getItem('userId') || null;
let scrapedUrls = [];

// API base URL - change this to match your FastAPI server
const API_BASE_URL = 'http://13.126.153.100:8000';

// DOM Elements
document.addEventListener('DOMContentLoaded', () => {
    // Tab Navigation
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Skip if already active or processing a request
            if (tab.classList.contains('active') || isProcessing) return;
            
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Update active content
            const targetId = tab.getAttribute('data-target');
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === targetId) {
                    content.classList.add('active');
                }
            });

            // Load URLs list when switching to manage tab
            if (targetId === 'manageTab') {
                loadScrapedUrls();
            }
        });
    });
    
    // URL Input Management
    const urlContainer = document.getElementById('urlInputContainer');
    const addUrlBtn = document.getElementById('addUrlBtn');
    
    // Add initial URL input
    addUrlInput();
    
    // Add URL input button
    addUrlBtn.addEventListener('click', addUrlInput);
    
    // Scrape Form Submission
    const scrapeForm = document.getElementById('scrapeForm');
    scrapeForm.addEventListener('submit', handleScrapeSubmit);
    
    // Ask Form Submission
    const askForm = document.getElementById('askForm');
    askForm.addEventListener('submit', handleAskSubmit);

    // Check if we have user data
    checkUserData();
});

// Check if we have existing user data
async function checkUserData() {
    if (userId) {
        try {
            const response = await fetch(`${API_BASE_URL}/urls`, {
                headers: {
                    'X-User-ID': userId
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                scrapedUrls = data.urls;
                hasScrapedContent = scrapedUrls.length > 0;
                
                if (hasScrapedContent) {
                    showNotification('Loaded your existing scraped content', 'success');
                }
            }
        } catch (error) {
            console.error('Error checking user data:', error);
        }
    }
}

// Load scraped URLs for management
async function loadScrapedUrls() {
    if (!userId) return;
    
    const urlsContainer = document.getElementById('scrapedUrlsContainer');
    urlsContainer.innerHTML = '<div class="loader show"><div class="spinner"></div></div>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/urls`, {
            headers: {
                'X-User-ID': userId
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            scrapedUrls = data.urls;
            
            urlsContainer.innerHTML = '';
            
            if (scrapedUrls.length === 0) {
                urlsContainer.innerHTML = '<p class="no-urls">No URLs have been scraped yet.</p>';
                return;
            }
            
            scrapedUrls.forEach(url => {
                const urlItem = document.createElement('div');
                urlItem.className = 'url-item';
                
                const urlText = document.createElement('span');
                urlText.className = 'url-text';
                urlText.textContent = url;
                
                const removeBtn = document.createElement('button');
                removeBtn.className = 'button small danger';
                removeBtn.innerHTML = '<i class="fas fa-trash"></i> Remove';
                removeBtn.addEventListener('click', () => removeUrl(url));
                
                urlItem.appendChild(urlText);
                urlItem.appendChild(removeBtn);
                urlsContainer.appendChild(urlItem);
            });
        } else {
            urlsContainer.innerHTML = '<p class="error">Failed to load URLs</p>';
        }
    } catch (error) {
        console.error('Error loading URLs:', error);
        urlsContainer.innerHTML = '<p class="error">Failed to load URLs</p>';
    }
}

// Remove a URL
async function removeUrl(url) {
    if (isProcessing) return;
    
    isProcessing = true;
    
    try {
        const response = await fetch(`${API_BASE_URL}/remove-url`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-User-ID': userId
            },
            body: JSON.stringify({
                url: url
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification(data.message, 'success');
            // Reload URLs list
            loadScrapedUrls();
            
            // Check if we still have content
            const urlsResponse = await fetch(`${API_BASE_URL}/urls`, {
                headers: {
                    'X-User-ID': userId
                }
            });
            
            if (urlsResponse.ok) {
                const urlsData = await urlsResponse.json();
                hasScrapedContent = urlsData.urls.length > 0;
            }
        } else {
            showNotification(data.detail || 'Failed to remove URL', 'error');
        }
    } catch (error) {
        console.error('Error removing URL:', error);
        showNotification('Failed to remove URL', 'error');
    } finally {
        isProcessing = false;
    }
}

// Add URL input field
function addUrlInput() {
    const urlContainer = document.getElementById('urlInputContainer');
    const urlInputRow = document.createElement('div');
    urlInputRow.className = 'url-input-row';
    
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'url-input';
    urlInput.placeholder = 'Enter URL to scrape (e.g. https://example.com)';
    urlInput.required = true;
    
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'button secondary icon-only';
    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
    removeBtn.addEventListener('click', () => {
        // Don't remove if it's the only input
        const inputs = urlContainer.querySelectorAll('.url-input-row');
        if (inputs.length > 1) {
            urlInputRow.remove();
        }
    });
    
    urlInputRow.appendChild(urlInput);
    urlInputRow.appendChild(removeBtn);
    urlContainer.appendChild(urlInputRow);
}

// Handle scrape form submission
async function handleScrapeSubmit(e) {
    e.preventDefault();
    
    if (isProcessing) return;
    
    const urlInputs = document.querySelectorAll('.url-input');
    const usePlaywright = document.getElementById('usePlaywright').checked;
    
    // Collect URLs
    const urls = [];
    urlInputs.forEach(input => {
        if (input.value.trim()) {
            urls.push(input.value.trim());
        }
    });
    
    if (urls.length === 0) {
        showNotification('Please enter at least one URL', 'error');
        return;
    }
    
    // Start processing
    isProcessing = true;
    showLoader('scrapeLoader');
    
    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // Add user ID if we have one
        if (userId) {
            headers['X-User-ID'] = userId;
        }
        
        const response = await fetch(`${API_BASE_URL}/scrape`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                urls: urls,
                use_playwright: usePlaywright
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.detail || 'Failed to scrape URLs');
        }
        
        // Save user ID if we got a new one
        if (data.user_id) {
            userId = data.user_id;
            localStorage.setItem('userId', userId);
        }
        
        hasScrapedContent = true;
        showNotification(data.message, 'success');
        
        // Switch to Ask tab
        document.querySelector('[data-target="askTab"]').click();
        
    } catch (error) {
        console.error('Error:', error);
        showNotification(error.message, 'error');
    } finally {
        isProcessing = false;
        hideLoader('scrapeLoader');
    }
}

// Handle ask form submission
async function handleAskSubmit(e) {
    e.preventDefault();
    
    if (isProcessing) return;
    
    const questionInput = document.getElementById('questionInput');
    const question = questionInput.value.trim();
    
    if (!question) {
        showNotification('Please enter a question', 'error');
        return;
    }
    
    if (!hasScrapedContent) {
        showNotification('Please scrape content first', 'error');
        // Switch to Scrape tab
        document.querySelector('[data-target="scrapeTab"]').click();
        return;
    }
    
    // Start processing
    isProcessing = true;
    showLoader('askLoader');
    hideAnswerContainer();
    
    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // Add user ID if we have one
        if (userId) {
            headers['X-User-ID'] = userId;
        }
        
        const response = await fetch(`${API_BASE_URL}/ask`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                question: question
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.detail || 'Failed to get answer');
        }
        
        displayAnswer(data.answer, data.source_documents);
        
    } catch (error) {
        console.error('Error:', error);
        showNotification(error.message, 'error');
    } finally {
        isProcessing = false;
        hideLoader('askLoader');
    }
}

// Display answer and sources
function displayAnswer(answer, sources) {
    const answerContainer = document.getElementById('answerContainer');
    const answerText = document.getElementById('answerText');
    const sourcesContainer = document.getElementById('sourcesContainer');
    
    // Set answer text
    answerText.textContent = answer;
    
    // Clear previous sources
    sourcesContainer.innerHTML = '';
    
    // Add sources if available
    if (sources && sources.length > 0) {
        document.getElementById('sourcesTitle').style.display = 'block';
        
        sources.forEach(source => {
            const sourceItem = document.createElement('div');
            sourceItem.className = 'source-item';
            sourceItem.textContent = source;
            sourcesContainer.appendChild(sourceItem);
        });
    } else {
        document.getElementById('sourcesTitle').style.display = 'none';
    }
    
    // Show answer container
    answerContainer.classList.add('show');
}

// Hide answer container
function hideAnswerContainer() {
    const answerContainer = document.getElementById('answerContainer');
    answerContainer.classList.remove('show');
}

// Show loader
function showLoader(id) {
    const loader = document.getElementById(id);
    loader.classList.add('show');
}

// Hide loader
function hideLoader(id) {
    const loader = document.getElementById(id);
    loader.classList.remove('show');
}

// Show notification
function showNotification(message, type) {
    const notification = document.getElementById('notification');
    const notificationText = document.getElementById('notificationText');
    const notificationIcon = document.getElementById('notificationIcon');
    
    // Set notification content
    notificationText.textContent = message;
    
    // Set notification type
    notification.className = 'notification';
    notification.classList.add(type);
    
    // Set icon
    if (type === 'success') {
        notificationIcon.className = 'fas fa-check-circle';
    } else {
        notificationIcon.className = 'fas fa-exclamation-circle';
    }
    
    // Show notification
    notification.classList.add('show');
    
    // Auto hide after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
    }, 5000);
}