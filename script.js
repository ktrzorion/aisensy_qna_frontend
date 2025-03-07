// Global state
let isProcessing = false;
let hasScrapedContent = false;
let userId = localStorage.getItem('userId') || null;
let scrapedUrls = [];
let wsConnection = null;
let processingTimer = null;
let pendingRequests = {}; // Track pending API requests

// API base URL - change this to match your FastAPI server
const API_BASE_URL = 'http://13.232.135.114:8000';

// DOM Elements
document.addEventListener('DOMContentLoaded', () => {
    // Tab Navigation
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {

            if (tab.classList.contains('active') || isProcessing) return;
        
            // Clear any existing processing timers when switching tabs
            if (processingTimer) {
                clearTimeout(processingTimer);
                processingTimer = null;
            }
            
            // Hide any visible processing messages
            document.getElementById('scrapeProcessingMessage').style.display = 'none';
            document.getElementById('askProcessingMessage').style.display = 'none';

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
    
    // Initialize progress bar as hidden
    hideProgressBar();

    // Setup request state checker
    setupRequestStateChecker();
});

// Setup a periodic checker for request states
function setupRequestStateChecker() {
    setInterval(() => {
        const requestIds = Object.keys(pendingRequests);
        if (requestIds.length > 0) {
            console.log(`Currently ${requestIds.length} pending requests`);
            
            // Check if any requests have been pending for too long (more than 2 minutes)
            const now = Date.now();
            requestIds.forEach(id => {
                const request = pendingRequests[id];
                if (now - request.startTime > 20000) { // 20 minutes
                    console.warn(`Request ${id} has been pending for more than 2 minutes`);
                    showNotification('Minimum time per request is 2 Minutes due to LOW BUDGET SERVER.', 'warning');
                }
            });
        }
    }, 20000); // Check every 30 seconds
}

// Create a new API request with tracking
function createApiRequest(endpoint, options, requestType) {
    // Generate a unique ID for this request
    const requestId = `${requestType}-${Date.now()}`;
    
    // Create AbortController to allow cancellation
    const controller = new AbortController();
    options.signal = controller.signal;
    
    // Store request in pending requests
    pendingRequests[requestId] = {
        type: requestType,
        endpoint,
        startTime: Date.now(),
        controller,
        isPending: true
    };
    
    // Create the fetch promise
    const fetchPromise = fetch(`${API_BASE_URL}${endpoint}`, options)
        .then(response => {
            // Remove from pending requests
            if (pendingRequests[requestId]) {
                delete pendingRequests[requestId];
            }
            return response;
        })
        .catch(error => {
            // Remove from pending requests
            if (pendingRequests[requestId]) {
                delete pendingRequests[requestId];
            }
            throw error;
        });
    
    // Add ability to check if request is pending
    fetchPromise.isPending = () => {
        return pendingRequests[requestId] && pendingRequests[requestId].isPending;
    };
    
    // Add ability to abort the request
    fetchPromise.abort = () => {
        if (pendingRequests[requestId]) {
            pendingRequests[requestId].controller.abort();
            delete pendingRequests[requestId];
        }
    };
    
    return fetchPromise;
}

// Setup WebSocket connection
function setupWebSocketConnection() {
    if (!userId) return;
    
    // Close existing connection if any
    if (wsConnection) {
        wsConnection.close();
    }
    
    const wsUrl = API_BASE_URL.replace('http', 'ws') + `/ws/${userId}`;
    wsConnection = new WebSocket(wsUrl);
    
    wsConnection.onopen = () => {
        console.log('WebSocket connection established');
    };
    
    wsConnection.onmessage = (event) => {
        const data = JSON.parse(event.data);
        updateProgressBar(data);
        
        // Clear timer since we received an update
        if (processingTimer) {
            clearTimeout(processingTimer);
            processingTimer = null;
        }
    };
    
    wsConnection.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
    
    wsConnection.onclose = () => {
        console.log('WebSocket connection closed');
        // Try to reconnect after 5 seconds if processing
        if (isProcessing) {
            setTimeout(setupWebSocketConnection, 5000);
        }
    };
}

// Update progress bar based on websocket data
function updateProgressBar(data) {
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressStatus = document.getElementById('progressStatus');
    const progressCounter = document.getElementById('progressCounter');
    const progressUrl = document.getElementById('progressUrl');
    
    // Show progress container
    progressContainer.classList.add('show');
    
    // Update progress bar
    const percentage = (data.current / data.total) * 100;
    progressBar.style.width = `${percentage}%`;
    
    // Set counter text
    progressCounter.textContent = `${data.current}/${data.total}`;
    
    // Set status text
    let statusText = 'Processing...';
    
    switch (data.status) {
        case 'starting':
            statusText = 'Starting...';
            break;
        case 'fetching':
            statusText = 'Fetching content...';
            break;
        case 'processing':
            statusText = 'Processing content...';
            break;
        case 'complete':
            statusText = 'Complete!';
            break;
        case 'error':
            statusText = 'Error!';
            progressBar.classList.add('error');
            break;
    }
    
    progressStatus.textContent = statusText;
    
    // Set URL text if available
    if (data.url) {
        progressUrl.textContent = data.url;
    } else {
        progressUrl.textContent = '';
    }
    
    // If process is complete or errored, hide after a delay
    if (data.status === 'complete' || data.status === 'error') {
        if (data.status === 'error') {
            showNotification(data.url || 'An error occurred', 'error');
        }
        
        // Keep showing for 3 seconds before hiding
        setTimeout(() => {
            if (!isProcessing) {
                hideProgressBar();
            }
        }, 3000);
    }
}

// Hide progress bar
function hideProgressBar() {
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    
    progressContainer.classList.remove('show');
    progressBar.classList.remove('error');
    progressBar.style.width = '0%';
}

// Check if we have existing user data
async function checkUserData() {
    if (userId) {
        try {
            const options = {
                headers: {
                    'X-User-ID': userId
                }
            };
            
            const response = await createApiRequest('/urls', options, 'checkUserData');
            
            if (response.ok) {
                const data = await response.json();
                scrapedUrls = data.urls;
                hasScrapedContent = scrapedUrls.length > 0;
                
                if (hasScrapedContent) {
                    showNotification('Loaded your existing scraped content', 'success');
                }
                
                // Setup WebSocket connection
                setupWebSocketConnection();
            }
        } catch (error) {
            console.error('Error checking user data:', error);
        }
    }
}

// Check if any request for a specific type is pending
function isRequestPending(requestType) {
    const pendingIds = Object.keys(pendingRequests);
    return pendingIds.some(id => pendingRequests[id].type === requestType);
}

// Load scraped URLs for management
async function loadScrapedUrls() {
    if (!userId) return;
    
    // Check if a loadUrls request is already pending
    if (isRequestPending('loadUrls')) {
        console.log('A load URLs request is already pending');
        return;
    }
    
    const urlsContainer = document.getElementById('scrapedUrlsContainer');
    urlsContainer.innerHTML = '<div class="loader show"><div class="spinner"></div></div>';
    
    try {
        const options = {
            headers: {
                'X-User-ID': userId
            }
        };
        
        const response = await createApiRequest('/urls', options, 'loadUrls');
        
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
    
    // Check if a removeUrl request for this URL is already pending
    if (isRequestPending(`removeUrl-${url}`)) {
        console.log(`A remove URL request for ${url} is already pending`);
        return;
    }
    
    isProcessing = true;
    
    try {
        const options = {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-User-ID': userId
            },
            body: JSON.stringify({
                url: url
            })
        };
        
        const response = await createApiRequest('/remove-url', options, `removeUrl-${url}`);
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification(data.message, 'success');
            // Reload URLs list
            loadScrapedUrls();
            
            // Check if we still have content
            const urlsOptions = {
                headers: {
                    'X-User-ID': userId
                }
            };
            
            const urlsResponse = await createApiRequest('/urls', urlsOptions, 'checkRemainingUrls');
            
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

// Update processing status based on active requests
function updateProcessingStatus() {
    // Check if there are any pending requests
    const hasPendingRequests = Object.keys(pendingRequests).length > 0;
    
    // Update status based on pending requests
    if (hasPendingRequests) {
        const requestTypes = Object.values(pendingRequests).map(req => req.type);
        console.log(`Active requests: ${requestTypes.join(', ')}`);
        
        // Update processing state if we have pending requests but isProcessing is false
        if (!isProcessing) {
            isProcessing = true;
            console.log('Setting isProcessing to true due to pending requests');
        }
    } else if (isProcessing) {
        // No pending requests but isProcessing is true - may need to reset
        console.log('No pending requests but isProcessing is true - considering reset');
        
        // Could add a delay here before setting isProcessing to false
        // setTimeout(() => {
        //    isProcessing = false;
        // }, 1000);
    }
}

// Handle scrape form submission
async function handleScrapeSubmit(e) {
    e.preventDefault();
    
    if (isProcessing) return;
    
    // Check if a scrape request is already pending
    if (isRequestPending('scrape')) {
        console.log('A scrape request is already pending');
        return;
    }
    
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
    
    // Show processing message immediately
    const processingMessage = document.getElementById('scrapeProcessingMessage');
    processingMessage.textContent = 'Processing URLs...';
    processingMessage.style.display = 'block';

    // Update message if it takes longer
    processingTimer = setTimeout(() => {
        processingMessage.textContent = 'Processing URLs may take some time, especially for complex websites. Please be patient.';
        // Still show notification to ensure user sees it
        showNotification('Processing URLs may take some time, especially for complex websites. Please be patient.', 'info');
    }, 20000); // 20 seconds
    
    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // Add user ID if we have one
        if (userId) {
            headers['X-User-ID'] = userId;
        }
        
        const options = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                urls: urls,
                use_playwright: usePlaywright
            })
        };
        
        const response = await createApiRequest('/scrape', options, 'scrape');
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.detail || 'Failed to scrape URLs');
        }
        
        // Save user ID if we got a new one
        if (data.user_id) {
            userId = data.user_id;
            localStorage.setItem('userId', userId);
            
            // Setup WebSocket connection with new user ID
            setupWebSocketConnection();
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
        
        // Clear the processing timer if it exists
        if (processingTimer) {
            clearTimeout(processingTimer);
            processingTimer = null;
        }
        
        // Hide processing message
        document.getElementById('scrapeProcessingMessage').style.display = 'none';
        
        // Update processing status based on pending requests
        updateProcessingStatus();
    }
}

// Handle ask form submission
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
    
    // Show processing message immediately
    const processingMessage = document.getElementById('askProcessingMessage');
    processingMessage.textContent = 'Processing your question...';
    processingMessage.style.display = 'block';
    
    // Update message if it takes longer
    processingTimer = setTimeout(() => {
        processingMessage.textContent = 'Processing your question may take some time. Please be patient.';
        // Still show notification to ensure user sees it
        showNotification('Processing your question may take some time. Please be patient.', 'info');
    }, 20000); // 20 seconds
    
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
        
        // Clear the processing timer if it exists
        if (processingTimer) {
            clearTimeout(processingTimer);
            processingTimer = null;
        }
        
        // Hide processing message
        document.getElementById('askProcessingMessage').style.display = 'none';
    }
}

// Check status of API requests
function checkRequestStatus() {
    // If no pending requests, return
    if (Object.keys(pendingRequests).length === 0) {
        // Update UI to indicate all requests are complete if needed
        if (document.getElementById('apiStatusIndicator')) {
            document.getElementById('apiStatusIndicator').textContent = 'All API requests complete';
            document.getElementById('apiStatusIndicator').className = 'status-complete';
        }
        return;
    }
    
    // Get all pending requests
    const pendingIds = Object.keys(pendingRequests);
    const requestTypes = [];
    
    pendingIds.forEach(id => {
        requestTypes.push(pendingRequests[id].type);
    });
    
    console.log(`Pending requests: ${requestTypes.join(', ')}`);
    
    // Update UI to show pending requests if needed
    if (document.getElementById('apiStatusIndicator')) {
        document.getElementById('apiStatusIndicator').textContent = `API requests pending: ${requestTypes.join(', ')}`;
        document.getElementById('apiStatusIndicator').className = 'status-pending';
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
    } else if (type === 'error') {
        notificationIcon.className = 'fas fa-exclamation-circle';
    } else if (type === 'info') {
        notificationIcon.className = 'fas fa-info-circle';
    } else {
        notificationIcon.className = 'fas fa-info-circle';
    }
    
    // Show notification
    notification.classList.add('show');
    
    // Auto hide after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
    }, 5000);
}

// Set up interval to check API status regularly
setInterval(checkRequestStatus, 2000); // Check every 2 seconds