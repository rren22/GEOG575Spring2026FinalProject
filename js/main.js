// Map Initialization & Configuration
// Create Leaflet map instance
const map = L.map('map', {
    zoomControl: false, // Disable default zoom control (make it to top right corner)
    scrollWheelZoom: true,
    dragging: true,
    doubleClickZoom: true,
    boxZoom: true,
    keyboard: true
}).setView([43.073, -89.4], 16); // Center: Madison, Zoom level: 16

// Add zoom control to top-right
L.control.zoom({ position: 'topright' }).addTo(map);

// Add base map layer (Carto Light - clean light-colored map)
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
}).addTo(map);

// configuration 
const state = {
    spots: [],                           // All study spot data
    markers: L.markerClusterGroup({      // Leaflet marker cluster group
        maxClusterRadius: 50,             // Clustering radius (pixels)
        disableClusteringAtZoom: 18       // Disable clustering at zoom 18
    }).addTo(map),
    search: '',                          // Search keyword
    hourRange: { start: 0, end: 23 },   // Selected time range
    noise: new Set(),                    // Selected noise levels Set
    occupancy: new Set()                 // Selected occupancy Set
};

// Noise level options definition
const NOISE_OPTIONS = [
    { value: 'low', label: 'Quiet', color: '#8a97a6' },
    { value: 'moderate', label: 'Moderate', color: '#8a97a6' },
    { value: 'high', label: 'Busy', color: '#8a97a6' }
];

// Occupancy options definition 
const OCCUPANCY_OPTIONS = [
    { value: 'low', label: 'Open', color: '#2e9d57' },      // Green
    { value: 'medium', label: 'Medium', color: '#f4b400' },  // Yellow
    { value: 'high', label: 'Full', color: '#d64545' }       // Red
];

// optional data processing: Handle missing/null values in the dataset
// Assign default values to null fields
// Only fills hours (null -> 'Full day'), noise and occupancy stay null (display gray)
function buildDummyMetadata(spots) {
    spots.forEach((spot) => {
        if (!spot.hours) {
            spot.hours = 'Full day';
        }
    });
}

// HTML escaping
function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// label and color helper functions for noise and occupancy levels
// Get noise level color
function getNoiseColor(level) {
    const option = NOISE_OPTIONS.find(item => item.value === level);
    return option ? option.color : '#6b7c8f';
}

// Get noise level display label
// If level is null, return 'Unknown' (displayed in gray)
function getNoiseLabel(level) {
    if (!level) return 'Unknown';
    const option = NOISE_OPTIONS.find(item => item.value === level);
    return option ? option.label : 'Unknown';
}

// Get occupancy display label
function getOccupancyLabel(level) {
    if (!level) return 'Unknown';
    const option = OCCUPANCY_OPTIONS.find(item => item.value === level);
    return option ? option.label : 'Unknown';
}

// Get occupancy color (used for map markers)
// If level is null, return gray
function getOccupancyColor(level) {
    if (!level) return '#c5cad1';
    const option = OCCUPANCY_OPTIONS.find(item => item.value === level);
    return option ? option.color : '#c5cad1';
}

// time parsing and formatting functions
// Convert 0-23 hours to 12-hour format label (12:00 AM - 11:00 PM)
function formatHourLabel(hour) {
    const normalizedHour = ((hour % 24) + 24) % 24;
    const suffix = normalizedHour >= 12 ? 'PM' : 'AM';
    const displayHour = normalizedHour % 12 === 0 ? 12 : normalizedHour % 12;
    return `${displayHour}:00 ${suffix}`;
}

// Parse time range string
// Supports: "Full day" -> {start: 0, end: 23}
//           "6:00 - 20:00" -> {start: 6, end: 20}
//           "8:00 AM - 5:00 PM" -> {start: 8, end: 17}
function parseHoursRange(hoursText) {
    if (!hoursText) {
        return null;
    }

    const normalized = String(hoursText).trim().toLowerCase();
    if (normalized === 'full day') {
        return { start: 0, end: 23 };
    }

    // Regex pattern matches time: 1-2 digit hour + optional :minutes + optional AM/PM
    const timePattern = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g;
    const matches = [...normalized.matchAll(timePattern)];

    if (matches.length < 2) {
        return null;
    }

    // Convert time string to 24-hour format number
    const toHour = match => {
        let hour = Number(match[1]);
        const meridiem = match[3];

        if (meridiem === 'pm' && hour !== 12) {
            hour += 12;
        }
        if (meridiem === 'am' && hour === 12) {
            hour = 0;
        }

        return hour;
    };

    return {
        start: toHour(matches[0]),
        end: toHour(matches[1])
    };
}

// Check if a spot's operating hours overlap with user's selected time range
// Return true means show, false means hide
function spotMatchesHourRange(spotHours, selectedStart, selectedEnd) {
    const spotRange = parseHoursRange(spotHours);
    if (!spotRange) {
        return false; // If spot has no time data, don't show
    }
    // Check if two ranges overlap (spotRange and selected range)
    return !(spotRange.end < selectedStart || spotRange.start > selectedEnd);
}

// data parsing function
// Convert GeoJSON feature to application spot object
function parseSpot(feature) {
    const [lng, lat] = feature.geometry.coordinates;
    const props = feature.properties || {};
    
    // Normalize noise level: JSON might be 'medium', convert to 'moderate'
    let noiseLevel = props.noise_level || null;
    if (noiseLevel === 'medium') {
        noiseLevel = 'moderate';
    }

    return {
        id: props.id,
        name: props.name || 'Unnamed spot',
        building: props.building || 'Unknown building',
        description: props.description || '',
        rating: props.rating || 'N/A',
        photo: props.photo || '',
        lat,
        lng,
        hours: props.hours || null,
        noise: noiseLevel,
        occupancy: props.occupancy || null
    };
}

// popup generation function
// Generate detailed info popup HTML shown on marker click
function makePopup(spot) {
    const imageSrc = spot.photo ? encodeURI(spot.photo) : '';
    const imageBlock = imageSrc ? `
        <img class="popup-photo" src="${imageSrc}" alt="${escapeHtml(spot.name)}" onerror="this.style.display='none'">
    ` : '';
    const ratingLabel = escapeHtml(spot.rating || 'N/A');
    const hoursLabel = escapeHtml(spot.hours || 'Full day');
    const noiseLabel = escapeHtml(getNoiseLabel(spot.noise));
    const occupancyLabel = escapeHtml(getOccupancyLabel(spot.occupancy));
    const occupancyColor = getOccupancyColor(spot.occupancy);

    return `
        <div class="popup-card">
            <div class="popup-header">
                <div>
                    <p class="popup-kicker">Study spot</p>
                    <h3>${escapeHtml(spot.name)}</h3>
                </div>
                <span class="rating-pill">${ratingLabel}</span>
            </div>
            ${imageBlock}
            <p class="popup-building">${escapeHtml(spot.building)}</p>
            <p class="popup-description"><strong>Reviewer&apos;s note:</strong> ${escapeHtml(spot.description || 'No description yet.')}</p>

            <div class="popup-meta-grid">
                <div class="popup-meta-item">
                    <span class="popup-meta-label">Hours</span>
                    <span class="popup-meta-value">${hoursLabel}</span>
                </div>
                <div class="popup-meta-item">
                    <span class="popup-meta-label">Noise</span>
                    <span class="popup-meta-value">${noiseLabel}</span>
                </div>
                <div class="popup-meta-item">
                    <span class="popup-meta-label">Occupancy</span>
                    <span class="popup-meta-value">
                        <span class="meta-dot meta-dot-occupancy" style="background:${occupancyColor}"></span>
                        ${occupancyLabel}
                    </span>
                </div>
            </div>
        </div>
    `;
}

// UI Rendering Functions
// Render checkbox list in filter panel (Noise level, Occupancy)
function renderFilters() {
    const noiseContainer = document.getElementById('noise-filters');
    const occupancyContainer = document.getElementById('occupancy-filters');

    // Generate noise level checkboxes
    noiseContainer.innerHTML = NOISE_OPTIONS.map(option => `
        <label class="checkbox-chip noise-chip">
            <input type="checkbox" value="${option.value}" data-filter="noise">
            <span class="chip-label">${option.label}</span>
        </label>
    `).join('');

    // Generate occupancy checkboxes (with color swatches)
    occupancyContainer.innerHTML = OCCUPANCY_OPTIONS.map(option => `
        <label class="checkbox-chip occupancy-chip">
            <input type="checkbox" value="${option.value}" data-filter="occupancy">
            <span class="chip-swatch" style="background:${option.color}"></span>
            <span class="chip-label">${option.label}</span>
        </label>
    `).join('');
}

// Collect all checked checkbox values into a Set
function collectCheckedValues(selector) {
    return new Set(Array.from(document.querySelectorAll(selector))
        .filter(input => input.checked)
        .map(input => input.value));
}

// Read all user inputs from control panel, update state
function syncStateFromControls() {
    state.search = document.getElementById('search-input').value.trim().toLowerCase();
    const startVal = Number(document.getElementById('hours-start').value);
    const endVal = Number(document.getElementById('hours-end').value);
    state.hourRange.start = Math.min(startVal, endVal);
    state.hourRange.end = Math.max(startVal, endVal);
    state.noise = collectCheckedValues('input[data-filter="noise"]');
    state.occupancy = collectCheckedValues('input[data-filter="occupancy"]');
}

// filter function
// Check if a spot matches all current filter conditions
// Return true means show, false means hide
function matchesSpot(spot) {
    const searchText = `${spot.name} ${spot.building} ${spot.description} ${spot.rating}`.toLowerCase();

    // Search filter
    if (state.search && !searchText.includes(state.search)) {
        return false;
    }

    // Time range filter
    if (!spotMatchesHourRange(spot.hours, state.hourRange.start, state.hourRange.end)) {
        return false;
    }

    // Noise level filter (if noise options are selected)
    if (state.noise.size && !state.noise.has(spot.noise)) {
        return false;
    }

    // Occupancy filter (if occupancy options are selected)
    if (state.occupancy.size && !state.occupancy.has(spot.occupancy)) {
        return false;
    }

    return true;
}

// Update "X spots" count display
function updateCount(filtered) {
    document.getElementById('results-count').textContent = 
        `${filtered.length} spot${filtered.length === 1 ? '' : 's'}`;
}

// map rendering function
// Main map rendering function
// Show/hide markers on map based on filter conditions
function renderMap(options = {}) {
    const { fitToData = false } = options;
    state.markers.clearLayers(); // Clear all existing markers

    // Apply all filter conditions
    const filtered = state.spots.filter(matchesSpot);
    const bounds = [];

    // Create marker for each filtered spot
    filtered.forEach(spot => {
        // Create a circle marker, color based on occupancy
        const marker = L.circleMarker([spot.lat, spot.lng], {
            radius: 9,
            color: '#ffffff',              // Border color
            weight: 2,                     // Border width
            fillColor: getOccupancyColor(spot.occupancy), // Fill color (green/yellow/red or gray)
            fillOpacity: 0.92,
            className: 'spot-marker'
        });

        // Bind popup shown on click
        marker.bindPopup(makePopup(spot), {
            closeButton: true,
            className: 'study-popup',
            maxWidth: 340,
            minWidth: 280,
            autoPan: true,
            autoPanPaddingTopLeft: L.point(380, 80),
            autoPanPaddingBottomRight: L.point(40, 40)
        });

        // Click marker event handler
        marker.on('click', function () {
            this.openPopup();
            // Pan map to show popup (avoid left panel occlusion)
            map.panInside([spot.lat, spot.lng], {
                paddingTopLeft: [380, 100],
                paddingBottomRight: [40, 40],
                animate: true
            });
        });

        marker.addTo(state.markers);
        bounds.push([spot.lat, spot.lng]);
    });

    updateCount(filtered);

    // Auto-adjust map view to fit all markers if bounds exist
    if (fitToData && bounds.length) {
        map.fitBounds(bounds, { padding: [40, 40] });
    }
}

// add event listeners for all controls
function attachEvents() {
    // Search box: Real-time filtering on input
    document.getElementById('search-input').addEventListener('input', () => {
        syncStateFromControls();
        renderMap();
    });

    // Start time slider
    document.getElementById('hours-start').addEventListener('input', event => {
        const startVal = Number(event.target.value);
        const endVal = Number(document.getElementById('hours-end').value);
        // If start time > end time, auto-propagate end time
        if (startVal > endVal) {
            document.getElementById('hours-end').value = startVal;
        }
        document.getElementById('hours-start-label').textContent = 
            formatHourLabel(Math.min(startVal, endVal));
        syncStateFromControls();
        renderMap();
    });

    // End time slider
    document.getElementById('hours-end').addEventListener('input', event => {
        const endVal = Number(event.target.value);
        const startVal = Number(document.getElementById('hours-start').value);
        // If end time < start time, auto-propagate start time
        if (endVal < startVal) {
            document.getElementById('hours-start').value = endVal;
        }
        document.getElementById('hours-end-label').textContent = 
            formatHourLabel(Math.max(startVal, endVal));
        syncStateFromControls();
        renderMap();
    });

    // All filter checkboxes: Real-time filtering on change
    document.querySelectorAll('input[data-filter]').forEach(input => {
        input.addEventListener('change', () => {
            syncStateFromControls();
            renderMap();
        });
    });

    // Reset button: Clear all filters
    document.getElementById('reset-filters').addEventListener('click', () => {
        document.getElementById('search-input').value = '';
        document.getElementById('hours-start').value = '0';
        document.getElementById('hours-end').value = '23';
        document.getElementById('hours-start-label').textContent = formatHourLabel(0);
        document.getElementById('hours-end-label').textContent = formatHourLabel(23);
        document.querySelectorAll('input[data-filter]').forEach(input => {
            input.checked = false;
        });
        syncStateFromControls();
        renderMap({ fitToData: true });
    });
}

// Main execution flow
// Load all study spot data from JSON file
fetch('data/study_spots_template.json')
    .then(response => response.json())
    .then(data => {
        // Parse GeoJSON features
        state.spots = (data.features || [])
            .filter(feature => feature.geometry && Array.isArray(feature.geometry.coordinates))
            .map(parseSpot);

        // Assign default values to null fields
        buildDummyMetadata(state.spots);
        
        // Initialize UI
        renderFilters();
        attachEvents();
        document.getElementById('hours-start-label').textContent = formatHourLabel(0);
        document.getElementById('hours-end-label').textContent = formatHourLabel(23);
        syncStateFromControls();
        
        // First map render and auto-fit view
        renderMap({ fitToData: true });
    })
    .catch(error => {
        console.error('Error loading GeoJSON:', error);
        document.getElementById('results-count').textContent = 'Failed to load data';
    });
