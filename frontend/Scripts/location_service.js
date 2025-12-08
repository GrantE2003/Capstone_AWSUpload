/**
 * Location Service
 * Handles geolocation detection and country code management
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'app:selectedCountry';
  const STORAGE_KEY_AUTO_DETECTED = 'app:autoDetectedCountry';
  const STORAGE_KEY_DETECTION_ATTEMPTED = 'app:locationDetectionAttempted';

  /**
   * Get country code from coordinates using reverse geocoding
   * Uses a free reverse geocoding API
   */
  async function getCountryFromCoordinates(lat, lon) {
    try {
      // Using a free reverse geocoding service
      const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      const data = await response.json();
      
      if (data && data.countryCode) {
        return data.countryCode.toUpperCase();
      }
      
      // Fallback: try another service
      const response2 = await fetch(`https://geocode.xyz/${lat},${lon}?json=1&geoit=json`);
      const data2 = await response2.json();
      
      if (data2 && data2.prov) {
        // This service returns country name, we need to map it
        // For now, return null and let the dropdown handle it
        return null;
      }
      
      return null;
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      return null;
    }
  }

  /**
   * Detect user's country using browser geolocation
   */
  function detectCountry() {
    return new Promise((resolve) => {
      // Check if geolocation is supported
      if (!navigator.geolocation) {
        console.log('Geolocation is not supported by this browser');
        resolve(null);
        return;
      }

      // Check if we've already attempted detection and user has manually selected
      const manuallySelected = localStorage.getItem(STORAGE_KEY);
      const detectionAttempted = localStorage.getItem(STORAGE_KEY_DETECTION_ATTEMPTED);
      
      // If user has manually selected a country, don't auto-detect
      if (manuallySelected && detectionAttempted === 'true') {
        resolve(manuallySelected);
        return;
      }

      // Show loading state
      const event = new CustomEvent('locationDetecting', { detail: { detecting: true } });
      document.dispatchEvent(event);

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          const countryCode = await getCountryFromCoordinates(latitude, longitude);
          
          if (countryCode) {
            // Store as auto-detected
            localStorage.setItem(STORAGE_KEY, countryCode);
            localStorage.setItem(STORAGE_KEY_AUTO_DETECTED, 'true');
            localStorage.setItem(STORAGE_KEY_DETECTION_ATTEMPTED, 'true');
            
            const event = new CustomEvent('locationDetected', { 
              detail: { countryCode, autoDetected: true } 
            });
            document.dispatchEvent(event);
            
            resolve(countryCode);
          } else {
            // Failed to get country from coordinates
            localStorage.setItem(STORAGE_KEY_DETECTION_ATTEMPTED, 'true');
            const event = new CustomEvent('locationDetected', { 
              detail: { countryCode: null, autoDetected: false } 
            });
            document.dispatchEvent(event);
            resolve(null);
          }
        },
        (error) => {
          console.log('Geolocation error:', error.message);
          localStorage.setItem(STORAGE_KEY_DETECTION_ATTEMPTED, 'true');
          
          const event = new CustomEvent('locationDetected', { 
            detail: { countryCode: null, autoDetected: false, error: error.message } 
          });
          document.dispatchEvent(event);
          
          resolve(null);
        },
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 3600000 // Cache for 1 hour
        }
      );
    });
  }

  /**
   * Get the currently selected country code
   */
  function getSelectedCountry() {
    return localStorage.getItem(STORAGE_KEY) || null;
  }

  /**
   * Set the selected country code (manual selection)
   */
  function setSelectedCountry(countryCode) {
    if (countryCode) {
      localStorage.setItem(STORAGE_KEY, countryCode);
      localStorage.setItem(STORAGE_KEY_AUTO_DETECTED, 'false');
      
      // Dispatch event to notify other components
      const event = new CustomEvent('countryChanged', { 
        detail: { countryCode, autoDetected: false } 
      });
      document.dispatchEvent(event);
    }
  }

  /**
   * Check if country was auto-detected
   */
  function isAutoDetected() {
    return localStorage.getItem(STORAGE_KEY_AUTO_DETECTED) === 'true';
  }

  /**
   * Clear stored country selection
   */
  function clearCountry() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY_AUTO_DETECTED);
    localStorage.removeItem(STORAGE_KEY_DETECTION_ATTEMPTED);
  }

  // Initialize on page load
  function init() {
    // Only auto-detect if we haven't attempted before
    const detectionAttempted = localStorage.getItem(STORAGE_KEY_DETECTION_ATTEMPTED);
    if (detectionAttempted !== 'true') {
      detectCountry();
    }
  }

  // Export public API
  window.LocationService = {
    detectCountry,
    getSelectedCountry,
    setSelectedCountry,
    isAutoDetected,
    clearCountry,
    init
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

