// Initialize map
const map = L.map('map').setView([43.073, -89.4], 16);

// Add OpenStreetMap tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Load and display GeoJSON data
fetch('data/study_spots_template.json')
    .then(response => response.json())
    .then(data => {
        data.features.forEach(feature => {
            const [lng, lat] = feature.geometry.coordinates;
            const props = feature.properties;
            
            // Create popup content
            const popupHTML = `
                <div class="popup-content">
                    <h3>${props.name}</h3>
                    <p><strong>Building:</strong> ${props.building}</p>
                    <p><strong>Rating:</strong> ${props.rating || 'N/A'}</p>
                    <p><strong>Description:</strong> ${props.description || 'N/A'}</p>
                    ${props.photo ? `<img src="${props.photo}" alt="${props.name}">` : ''}
                </div>
            `;
            
            // Create marker
            L.marker([lat, lng])
                .bindPopup(popupHTML)
                .addTo(map);
        });
    })
    .catch(error => console.error('Error loading GeoJSON:', error));
