/**
 * Netflix Episode Shuffle - Content Script
 * 
 * Injects a shuffle button into Netflix show pages and handles
 * random episode selection with intelligent DOM detection.
 */

(function () {
  // ========================================
  // Constants
  // ========================================
  
  const BUTTON_ID = "nf-shuffle-btn";
  const PANEL_ID = "nf-shuffle-panel";
  const PANEL_CLOSE_ID = "nf-shuffle-panel-close";
  const SPINNER_CLASS = "nf-spinner";
  const LOADING_CLASS = "loading";
  
  // ========================================
  // State Management
  // ========================================
  
  let isShuffling = false;
  let isInjected = false;
  
  // ========================================
  // Logging Utility
  // ========================================
  
  function log(...args) {
    console.log("[Netflix Shuffle]", ...args);
  }
  
  function warn(...args) {
    console.warn("[Netflix Shuffle]", ...args);
  }
  
  // ========================================
  // Styles Injection
  // ========================================
  
  function injectStyles() {
    if (document.getElementById('nf-shuffle-styles')) return;

    // Inject after Netflix's own CSS so our rules win (with !important in styles.css).
    const link = document.createElement('link');
    link.id = 'nf-shuffle-styles';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles.css');
    document.head.appendChild(link);
    log("Styles injected");
  }
  
  // ========================================
  // Button State Management
  // ========================================
  
  function setButtonState(isLoading) {
    isShuffling = isLoading;
    const btn = document.getElementById(BUTTON_ID);
    
    if (!btn) return;
    
    if (isLoading) {
      btn.innerHTML = `<span class="${SPINNER_CLASS}">↻</span>Shuffling...`;
      btn.disabled = true;
      btn.classList.add(LOADING_CLASS);
      btn.setAttribute('aria-busy', 'true');
      btn.setAttribute('aria-label', 'Shuffling episode, please wait');
    } else {
      btn.textContent = "🔀 Shuffle Episode";
      btn.disabled = false;
      btn.classList.remove(LOADING_CLASS);
      btn.setAttribute('aria-busy', 'false');
      btn.setAttribute('aria-label', 'Shuffle to a random episode');
    }
  }
  
  // ========================================
  // DOM Container Detection
  // ========================================
  
  function getActiveContainer() {
    return (
      document.querySelector('.previewModal--container') ||
      document.querySelector('.jawBoneContainer') ||
      document
    );
  }
  
  // ========================================
  // Button Visibility Logic
  // ========================================
  
  function updateButtonVisibility() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    
    // Hide button on watch/player pages
    if (window.location.pathname.includes('/watch')) {
      btn.style.display = 'none';
      return;
    }
    
    // Check if we're on a show details view
    const activeContainer = getActiveContainer();
    const isDetailsView =
      document.querySelector('.previewModal--container') ||
      document.querySelector('.jawBoneContainer') ||
      window.location.pathname.includes('/title/');
    
    if (!isDetailsView) {
      btn.style.display = 'none';
      return;
    }
    
    // Check if show has episodes/seasons
    const hasSeasons =
      activeContainer.querySelector(
        '[data-uia*="episode-item"], [data-uia*="season-selector"], [data-uia*="episodes-tab"]'
      ) ||
      Array.from(activeContainer.querySelectorAll('button, [role="tab"], h2, h3, a')).some(
        (el) => /^episodes$/i.test((el.textContent || "").trim())
      ) ||
      Array.from(activeContainer.querySelectorAll('span, div')).some(
        (el) => /^\d+\s+seasons?$/i.test((el.textContent || "").trim())
      );
    
    btn.style.display = hasSeasons ? 'block' : 'none';
  }
  
  // ========================================
  // Episode Detection
  // ========================================
  
  function findEpisodeElements() {
    const activeContainer = getActiveContainer();
    
    // Strategy 1: Look for Netflix's episode item elements
    let candidates = Array.from(
      activeContainer.querySelectorAll(
        '[data-uia*="episode-item"], [class*="episode-item"], [class*="episodeWrapper"], [class*="titleCard-list"]'
      )
    );
    
    // Strategy 2: Find all watch links and filter out noise
    if (!candidates.length) {
      const allWatchLinks = Array.from(activeContainer.querySelectorAll('a[href*="/watch/"]'));
      candidates = allWatchLinks.filter((el) => {
        // Exclude main play button and hero sections
        if (el.closest('[data-uia*="play-button"], [class*="playButton"], .billboard, [class*="hero"]')) {
          return false;
        }
        // Exclude recommendations and similar content
        if (el.closest(
          '[data-uia*="similar"], [data-uia*="more-like"], [class*="similar"], [class*="moreLike"], [class*="trailers"], [id*="more-like"]'
        )) {
          return false;
        }
        return true;
      });
    }
    
    // Deduplicate by watch URL
    const uniqueUrls = new Set();
    const finalCandidates = [];
    
    candidates.forEach((el) => {
      let targetHref = el.href;
      if (!targetHref) {
        const anchor = el.querySelector('a[href*="/watch/"]');
        if (anchor) targetHref = anchor.href;
      }
      
      if (targetHref) {
        const match = targetHref.match(/\/watch\/\d+/);
        const baseId = match ? match[0] : targetHref;
        
        if (!uniqueUrls.has(baseId)) {
          uniqueUrls.add(baseId);
          finalCandidates.push(el);
        }
      } else {
        finalCandidates.push(el);
      }
    });
    
    return finalCandidates.length ? finalCandidates : candidates;
  }
  
  // ========================================
  // Clickable Element Resolution
  // ========================================
  
  function getClickableFromEpisodeEl(el) {
    // If element itself is a link, use it
    if (el.tagName === 'A' && (el.href || '').includes('/watch/')) {
      return el;
    }
    
    // Look for child link
    const childLink = el.querySelector('a[href*="/watch/"]');
    if (childLink) return childLink;
    
    // Look for parent link
    const parentLink = el.closest('a[href*="/watch/"]');
    if (parentLink) return parentLink;
    
    // Try finding play button
    const playBtn = el.querySelector('[data-uia*="play-button"], .play-icon, svg[data-icon="PlayMedium"]');
    if (playBtn) {
      return playBtn.closest('button, [role="button"]') || playBtn;
    }
    
    return el;
  }
  
  // ========================================
  // Season Dropdown Detection
  // ========================================
  
  function getSeasonDropdown(container) {
    // Try common selectors first
    let btn = container.querySelector(
      '[data-uia*="season-selector"], button.titleCard-dropdown, [class*="season-select"]'
    );
    if (btn) return btn;
    
    // Search by text content
    const buttons = Array.from(container.querySelectorAll('button, [role="button"], .dropdown-toggle'));
    btn = buttons.find((el) => {
      const text = (el.textContent || "").trim();
      return /^(Season|Series|Part|Volume)\s+\d+/i.test(text);
    });
    
    return btn;
  }
  
  // ========================================
  // Shuffle Orchestration
  // ========================================
  
  function shuffleEpisode() {
    log("🎬 Starting shuffle sequence...");
    setButtonState(true);
    
    const activeContainer = getActiveContainer();
    
    // Try switching to Episodes tab if needed
    const epTab = Array.from(
      activeContainer.querySelectorAll('button, [role="tab"], li')
    ).find((el) => /^episodes$/i.test((el.textContent || "").trim()));
    
    if (epTab && epTab.getAttribute('aria-selected') !== 'true') {
      log("Switching to Episodes tab...");
      epTab.click();
      setTimeout(jumpToRandomSeason, 1000);
    } else {
      jumpToRandomSeason();
    }
  }
  
  // ========================================
  // Season Selection
  // ========================================
  
  function jumpToRandomSeason() {
    const activeContainer = getActiveContainer();
    const seasonBtn = getSeasonDropdown(activeContainer);
    
    if (!seasonBtn) {
      log("No season dropdown found, shuffling current season...");
      finalizeShuffle();
      return;
    }
    
    log("Opening season dropdown...");
    seasonBtn.click();
    
    setTimeout(() => {
      // Try to find season options
      let options = Array.from(
        document.querySelectorAll(
          '.titleCard-dropdown-menu li, ul[role="listbox"] li, .sub-menu li, [data-uia*="season-item"], [role="option"]'
        )
      );
      
      if (!options.length) {
        options = Array.from(document.querySelectorAll('li, [role="menuitem"]')).filter(
          (el) => /^(Season|Part|Volume|Series)\s+\d+/i.test(el.textContent.trim())
        );
      }
      
      if (options.length > 0) {
        const index = Math.floor(Math.random() * options.length);
        const selectedSeason = options[index];
        log(`Selected season: ${selectedSeason.textContent.trim()}`);
        selectedSeason.click();
        
        setTimeout(finalizeShuffle, 1500);
      } else {
        log("Couldn't find season options, closing dropdown and shuffling current...");
        seasonBtn.click();
        finalizeShuffle();
      }
    }, 800);
  }
  
  // ========================================
  // Final Episode Selection & Navigation
  // ========================================
  
  function finalizeShuffle() {
    const episodes = findEpisodeElements();
    
    if (!episodes.length) {
      warn("No episodes found, showing manual panel");
      showManualPanel();
      setButtonState(false);
      return;
    }
    
    // Filter to visible episodes
    const pool = episodes.filter(
      (el) => el.offsetParent !== null || el.closest('[aria-hidden="true"]')
    );
    const activePool = pool.length ? pool : episodes;
    
    // Pick random episode
    const index = Math.floor(Math.random() * activePool.length);
    const choice = activePool[index];
    const clickable = getClickableFromEpisodeEl(choice);
    
    // Reset button state before navigation
    setButtonState(false);
    
    // Navigate to episode
    if (clickable && clickable.href && clickable.href.includes('/watch/')) {
      const navUrl = new URL(clickable.href, window.location.origin);
      navUrl.searchParams.set('preventIntent', 'true');
      log(`🎯 Navigating to episode: ${navUrl.pathname}`);
      window.location.assign(navUrl.toString());
    } else if (clickable) {
      if (typeof clickable.click === 'function') {
        clickable.click();
      } else {
        clickable.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
        );
      }
    }
    
    hideManualPanel();
  }
  
  // ========================================
  // Fallback Panel (Manual Episode List)
  // ========================================
  
  function showManualPanel() {
    let panel = document.getElementById(PANEL_ID);
    
    if (panel) {
      panel.classList.remove('hide');
      panel.classList.add('show');
      return;
    }
    
    // Create panel
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'show';
    panel.role = 'dialog';
    panel.setAttribute('aria-labelledby', 'nf-panel-title');
    panel.setAttribute('aria-describedby', 'nf-panel-desc');
    
    panel.innerHTML = `
      <div class="nf-shuffle-panel-inner">
        <p id="nf-panel-title"><strong>Couldn't auto-detect episodes</strong></p>
        <p id="nf-panel-desc">Open Netflix's own "Episodes" tab for this show so they load on screen, then click Shuffle again.</p>
        <button 
          id="${PANEL_CLOSE_ID}" 
          type="button"
          aria-label="Close notification"
        >Got it</button>
      </div>
    `;
    
    document.body.appendChild(panel);
    log("Fallback panel shown");
    
    document.getElementById(PANEL_CLOSE_ID).addEventListener('click', hideManualPanel);
  }
  
  function hideManualPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.classList.remove('show');
      panel.classList.add('hide');
    }
  }
  
  // ========================================
  // Button Injection
  // ========================================
  
  function injectButton() {
    if (document.getElementById(BUTTON_ID)) {
      // Button already exists, just restore state if needed
      if (isShuffling) setButtonState(true);
      return;
    }
    
    // Create button element
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'nf-shuffle-button';
    btn.setAttribute('aria-label', 'Shuffle to a random episode');
    btn.textContent = "🔀 Shuffle Episode";
    
    // Add click handler
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      shuffleEpisode();
    });
    
    // Add keyboard support
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        shuffleEpisode();
      }
    });
    
    btn.style.display = 'none';
    document.body.appendChild(btn);
    isInjected = true;
    log("✅ Shuffle button injected");
    
    // Apply initial state
    setButtonState(false);
  }
  
  // ========================================
  // Initialization & Observers
  // ========================================
  
  function init() {
    log("🚀 Initializing Netflix Shuffle...");
    
    injectStyles();
    injectButton();
    updateButtonVisibility();
    
    // Watch for DOM changes (Netflix is a SPA)
    const observer = new MutationObserver(() => {
      if (!document.getElementById(BUTTON_ID)) {
        injectButton();
      }
      updateButtonVisibility();
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false,
    });
    
    // Handle browser back button (bfcache restoration)
    window.addEventListener('pageshow', () => {
      setButtonState(false);
    });
    
    // Keyboard shortcut: Ctrl+Shift+S to shuffle
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        const btn = document.getElementById(BUTTON_ID);
        if (btn && btn.style.display !== 'none') {
          shuffleEpisode();
        }
      }
    });
    
    log("✨ Netflix Shuffle ready!");
  }
  
  // ========================================
  // Start the extension
  // ========================================
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
