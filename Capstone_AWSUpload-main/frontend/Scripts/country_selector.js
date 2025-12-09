/**
 * Country Selector Component
 * Provides a dropdown UI for country selection
 */

(function() {
  'use strict';

  // List of countries with ISO codes
  const COUNTRIES = [
    { code: '', name: 'All Countries' },
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'CA', name: 'Canada' },
    { code: 'AU', name: 'Australia' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'IT', name: 'Italy' },
    { code: 'ES', name: 'Spain' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'BE', name: 'Belgium' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'AT', name: 'Austria' },
    { code: 'SE', name: 'Sweden' },
    { code: 'NO', name: 'Norway' },
    { code: 'DK', name: 'Denmark' },
    { code: 'FI', name: 'Finland' },
    { code: 'IE', name: 'Ireland' },
    { code: 'PT', name: 'Portugal' },
    { code: 'GR', name: 'Greece' },
    { code: 'PL', name: 'Poland' },
    { code: 'CZ', name: 'Czech Republic' },
    { code: 'HU', name: 'Hungary' },
    { code: 'RO', name: 'Romania' },
    { code: 'BG', name: 'Bulgaria' },
    { code: 'HR', name: 'Croatia' },
    { code: 'SI', name: 'Slovenia' },
    { code: 'SK', name: 'Slovakia' },
    { code: 'JP', name: 'Japan' },
    { code: 'CN', name: 'China' },
    { code: 'IN', name: 'India' },
    { code: 'KR', name: 'South Korea' },
    { code: 'SG', name: 'Singapore' },
    { code: 'MY', name: 'Malaysia' },
    { code: 'TH', name: 'Thailand' },
    { code: 'ID', name: 'Indonesia' },
    { code: 'PH', name: 'Philippines' },
    { code: 'VN', name: 'Vietnam' },
    { code: 'NZ', name: 'New Zealand' },
    { code: 'ZA', name: 'South Africa' },
    { code: 'EG', name: 'Egypt' },
    { code: 'KE', name: 'Kenya' },
    { code: 'NG', name: 'Nigeria' },
    { code: 'BR', name: 'Brazil' },
    { code: 'MX', name: 'Mexico' },
    { code: 'AR', name: 'Argentina' },
    { code: 'CL', name: 'Chile' },
    { code: 'CO', name: 'Colombia' },
    { code: 'PE', name: 'Peru' },
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'SA', name: 'Saudi Arabia' },
    { code: 'IL', name: 'Israel' },
    { code: 'TR', name: 'Turkey' },
    { code: 'RU', name: 'Russia' },
    { code: 'UA', name: 'Ukraine' }
  ];

  let countrySelector = null;
  let statusMessage = null;

  /**
   * Create the country selector HTML
   */
  function createCountrySelector() {
    const container = document.createElement('div');
    container.className = 'country-selector-container';
    container.innerHTML = `
      <div class="country-selector-wrapper">
        <label for="countrySelect" class="country-selector-label">
          <span class="country-label-text">Country:</span>
          <select id="countrySelect" class="country-select" aria-label="Select country for news">
            ${COUNTRIES.map(country => 
              `<option value="${country.code}">${country.name}</option>`
            ).join('')}
          </select>
        </label>
        <div id="countryStatus" class="country-status" role="status" aria-live="polite"></div>
      </div>
    `;
    return container;
  }

  /**
   * Get country name from code
   */
  function getCountryName(code) {
    const country = COUNTRIES.find(c => c.code === code);
    return country ? country.name : 'Unknown';
  }

  /**
   * Update the selector to show current selection
   */
  function updateSelector(countryCode) {
    if (countrySelector) {
      const select = countrySelector.querySelector('#countrySelect');
      if (select) {
        select.value = countryCode || '';
      }
    }
  }

  /**
   * Update status message
   */
  function updateStatus(message, type = 'info') {
    if (statusMessage) {
      statusMessage.textContent = message;
      statusMessage.className = `country-status ${type}`;
      
      // Clear status after 3 seconds for info messages
      if (type === 'info' || type === 'success') {
        setTimeout(() => {
          if (statusMessage) {
            statusMessage.textContent = '';
            statusMessage.className = 'country-status';
          }
        }, 3000);
      }
    }
  }

  /**
   * Initialize the country selector
   */
  function init() {
    // Find where to insert the selector (in the collapsable content, before search bar)
    const collapsableContent = document.getElementById('collapsableContent');
    if (!collapsableContent) {
      console.warn('Country selector: collapsableContent not found');
      return;
    }

    // Check if selector already exists
    if (document.getElementById('countrySelect')) {
      countrySelector = document.querySelector('.country-selector-container');
      statusMessage = document.getElementById('countryStatus');
      attachEventListeners();
      return;
    }

    // Create and insert selector
    countrySelector = createCountrySelector();
    statusMessage = countrySelector.querySelector('#countryStatus');
    
    // Insert before search bar
    const searchBar = collapsableContent.querySelector('.search_bar');
    if (searchBar) {
      collapsableContent.insertBefore(countrySelector, searchBar);
    } else {
      // If no search bar, append to collapsable content
      collapsableContent.appendChild(countrySelector);
    }

    // Set initial value from storage
    const currentCountry = window.LocationService?.getSelectedCountry() || '';
    updateSelector(currentCountry);

    // Attach event listeners
    attachEventListeners();

    // Listen for location detection events
    document.addEventListener('locationDetecting', (e) => {
      if (e.detail.detecting) {
        updateStatus('Detecting your location...', 'info');
      }
    });

    document.addEventListener('locationDetected', (e) => {
      const { countryCode, autoDetected, error } = e.detail;
      
      if (countryCode && autoDetected) {
        updateSelector(countryCode);
        updateStatus(`Location detected: ${getCountryName(countryCode)}`, 'success');
      } else if (error) {
        updateStatus('Location detection failed. Please select your country manually.', 'warning');
      } else {
        updateStatus('Please select your country to see localized news.', 'info');
      }
    });

    document.addEventListener('countryChanged', (e) => {
      const { countryCode } = e.detail;
      updateSelector(countryCode);
      if (countryCode) {
        updateStatus(`Showing news for: ${getCountryName(countryCode)}`, 'success');
      } else {
        updateStatus('Showing all news', 'info');
      }
    });
  }

  /**
   * Attach event listeners to the selector
   */
  function attachEventListeners() {
    const select = countrySelector?.querySelector('#countrySelect');
    if (!select) return;

    select.addEventListener('change', (e) => {
      const countryCode = e.target.value || null;
      
      if (window.LocationService) {
        if (countryCode) {
          window.LocationService.setSelectedCountry(countryCode);
        } else {
          window.LocationService.clearCountry();
        }
        
        // Trigger article refresh
        const event = new CustomEvent('countryChanged', { 
          detail: { countryCode, autoDetected: false } 
        });
        document.dispatchEvent(event);
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

