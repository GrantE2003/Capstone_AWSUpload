document.addEventListener('DOMContentLoaded', () => {
  // Check if we're on mobile (matches the CSS breakpoint)
  const isMobile = () => window.innerWidth < 768;

  // Header collapse (pills + search)
  const toggleBtn = document.getElementById('navToggle');
  const collapsible = document.getElementById('collapsableContent');

  if (toggleBtn && collapsible) {
    // Initialize state based on screen size
    const initializeState = () => {
      if (isMobile()) {
        // Mobile: Start with menu closed
        collapsible.hidden = true;
        toggleBtn.setAttribute('aria-expanded', 'false');
      } else {
        // Desktop: Start with menu open (but can be toggled)
        collapsible.hidden = false;
        toggleBtn.setAttribute('aria-expanded', 'true');
      }
    };

    // Initialize on load
    initializeState();

    // Update on window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (isMobile()) {
          // If resizing to mobile, ensure menu respects toggle state
          // Don't force open/closed, just respect current state
        } else {
          // If resizing to desktop, always show menu
          collapsible.hidden = false;
          toggleBtn.setAttribute('aria-expanded', 'true');
        }
      }, 100);
    });

    const toggle = () => {
      const open = toggleBtn.getAttribute('aria-expanded') === 'true';
      const newState = !open;
      
      toggleBtn.setAttribute('aria-expanded', String(newState));
      
      // Toggle the hidden attribute
      collapsible.hidden = !newState;
      
      if (newState) {
       toggleBtn.focus();
      }
    };

    toggleBtn.addEventListener('click', toggle);
    toggleBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });

    // Close menu on Escape key
    collapsible.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isMobile()) {
        toggleBtn.setAttribute('aria-expanded', 'false');
        collapsible.hidden = true;
        toggleBtn.focus();
      }
    });
  }

  // (Optional) Basic client-side search filter hook
  const form = document.getElementById('searchform');
  const input = document.getElementById('searchInput');
  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim().toLowerCase();
      console.log('Search query:', q);
    });
  }
});
