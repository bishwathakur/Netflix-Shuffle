(function () {
  const BUTTON_ID = "nf-shuffle-btn";
  const PANEL_ID = "nf-shuffle-panel";

  let injected = false;
  let isShuffling = false;

  function log(...args) {
    console.log("[Netflix Shuffle]", ...args);
  }

  function injectStyles() {
    if (document.getElementById('nf-shuffle-styles')) return;
    const style = document.createElement('style');
    style.id = 'nf-shuffle-styles';
    style.textContent = `
      @keyframes nf-spin { 100% { transform: rotate(360deg); } }
      .nf-spinner { display: inline-block; animation: nf-spin 1s linear infinite; margin-right: 5px; }
    `;
    document.head.appendChild(style);
  }

  function setButtonState(isLoading) {
    isShuffling = isLoading;  
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;

    if (isLoading) {
      btn.innerHTML = '<span class="nf-spinner">↻</span> Shuffling...';
      btn.style.opacity = '0.7';
      btn.style.cursor = 'wait';
      btn.disabled = true;
    } else {
      btn.textContent = "🔀 Shuffle Episode";
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.disabled = false;
    }
  }

  function getActiveContainer() {
    return document.querySelector('.previewModal--container') || 
           document.querySelector('.jawBoneContainer') || 
           document;
  }

  function updateButtonVisibility() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;

    if (window.location.pathname.includes('/watch')) {
      btn.style.display = 'none';
      return;
    }

    const activeContainer = getActiveContainer();
    const isDetailsView = document.querySelector('.previewModal--container') || 
                          document.querySelector('.jawBoneContainer') || 
                          window.location.pathname.includes('/title/');
                          
    if (!isDetailsView) {
      btn.style.display = 'none';
      return;
    }

    const hasSeasons = 
      activeContainer.querySelector('[data-uia*="episode-item"], [data-uia*="season-selector"], [data-uia*="episodes-tab"]') ||
      Array.from(activeContainer.querySelectorAll('button, [role="tab"], h2, h3, a')).some(el => /^episodes$/i.test((el.textContent || "").trim())) ||
      Array.from(activeContainer.querySelectorAll('span, div')).some(el => /^\d+\s+seasons?$/i.test((el.textContent || "").trim()));

    if (!hasSeasons) {
      btn.style.display = 'none';
      return;
    }

    if (btn.style.display === 'none') {
        btn.style.display = 'block';
    }
  }

  function findEpisodeElements() {
    const activeContainer = getActiveContainer();

    let candidates = Array.from(activeContainer.querySelectorAll(
        '[data-uia*="episode-item"], [class*="episode-item"], [class*="episodeWrapper"], [class*="titleCard-list"]'
    ));
    
    if (!candidates.length) {
      const allWatchLinks = Array.from(activeContainer.querySelectorAll('a[href*="/watch/"]'));
      candidates = allWatchLinks.filter((el) => {
        if (el.closest('[data-uia*="play-button"], [class*="playButton"], .billboard, [class*="hero"]')) return false;
        if (el.closest('[data-uia*="similar"], [data-uia*="more-like"], [class*="similar"], [class*="moreLike"], [class*="trailers"], [id*="more-like"]')) return false;
        return true;
      });
    }

    const uniqueUrls = new Set();
    const finalCandidates = [];
    
    candidates.forEach(el => {
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

  function getClickableFromEpisodeEl(el) {
    if (el.tagName === 'A' && (el.href || '').includes('/watch/')) return el;
    
    const childLink = el.querySelector('a[href*="/watch/"]');
    if (childLink) return childLink;
    
    const parentLink = el.closest('a[href*="/watch/"]');
    if (parentLink) return parentLink;

    const playBtn = el.querySelector('[data-uia*="play-button"], .play-icon, svg[data-icon="PlayMedium"]');
    if (playBtn) {
        return playBtn.closest('button, [role="button"]') || playBtn;
    }

    return el;
  }

  function getSeasonDropdown(container) {
    let btn = container.querySelector('[data-uia*="season-selector"], button.titleCard-dropdown, [class*="season-select"]');
    if (btn) return btn;

    const buttons = Array.from(container.querySelectorAll('button, [role="button"], .dropdown-toggle'));
    btn = buttons.find(el => {
        const text = (el.textContent || "").trim();
        return /^(Season|Series|Part|Volume)\s+\d+/i.test(text);
    });
    
    return btn;
  }

  function shuffleEpisode() {
    log("Starting shuffle sequence...");
    setButtonState(true); 
    
    const activeContainer = getActiveContainer();
    
    const epTab = Array.from(activeContainer.querySelectorAll('button, [role="tab"], li')).find(el => /^episodes$/i.test((el.textContent || "").trim()));
    
    if (epTab && epTab.getAttribute('aria-selected') !== 'true') {
      log("Switching to Episodes tab...");
      epTab.click();
      setTimeout(jumpToRandomSeason, 1000);
    } else {
      jumpToRandomSeason();
    }
  }

  function jumpToRandomSeason() {
    const activeContainer = getActiveContainer();
    const seasonBtn = getSeasonDropdown(activeContainer);

    if (!seasonBtn) {
      log("No season dropdown found. Skipping to episode shuffle.");
      finalizeShuffle();
      return;
    }

    log("Opening Season Dropdown...");
    seasonBtn.click();

    setTimeout(() => {
      let options = Array.from(document.querySelectorAll('.titleCard-dropdown-menu li, ul[role="listbox"] li, .sub-menu li, [data-uia*="season-item"], [role="option"]'));
      
      if (!options.length) {
          options = Array.from(document.querySelectorAll('li, [role="menuitem"]')).filter(el => /^(Season|Part|Volume|Series)\s+\d+/i.test(el.textContent.trim()));
      }
      
      if (options.length > 0) {
        const index = Math.floor(Math.random() * options.length);
        options[index].click();
        
        setTimeout(finalizeShuffle, 1500);
      } else {
        log("Couldn't read season list, clicking button to close it and shuffling current.");
        seasonBtn.click();
        finalizeShuffle();
      }
    }, 800);
  }

  function finalizeShuffle() {
    const episodes = findEpisodeElements();

    if (!episodes.length) {
      showManualPanel();
      setButtonState(false); 
      return;
    }

    const pool = episodes.filter((el) => el.offsetParent !== null || el.closest('[aria-hidden="true"]'));
    const activePool = pool.length ? pool : episodes;

    const index = Math.floor(Math.random() * activePool.length);
    const choice = activePool[index];
    const clickable = getClickableFromEpisodeEl(choice);
    setButtonState(false);
    
    if (clickable && clickable.href && clickable.href.includes('/watch/')) {
        let navUrl = new URL(clickable.href, window.location.origin);
        navUrl.searchParams.set('preventIntent', 'true');
        window.location.assign(navUrl.toString());
    } else if (clickable) {
        if (typeof clickable.click === 'function') {
            clickable.click();
        } else {
            clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        }
    }
    
    hideManualPanel();
  }

  function showManualPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.style.display = "block";
      return;
    }
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = "position:fixed; bottom:80px; right:20px; background:#141414; color:white; padding:15px; border:1px solid #333; z-index:9999; border-radius:5px; max-width: 300px;";
    panel.innerHTML = `
      <div class="nf-shuffle-panel-inner">
        <p style="margin-top:0;"><strong>Couldn't auto-detect episodes.</strong></p>
        <p style="font-size: 14px;">Open Netflix's own "Episodes" tab for this show so they load on the screen, then click Shuffle again.</p>
        <button id="nf-shuffle-panel-close" style="background:#e50914; color:white; border:none; padding:8px 12px; cursor:pointer; border-radius:3px; font-weight: bold;">Got it</button>
      </div>
    `;
    document.body.appendChild(panel);
    document.getElementById("nf-shuffle-panel-close").addEventListener("click", hideManualPanel);
  }

  function hideManualPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.style.display = "none";
  }

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) { 
        if (isShuffling) setButtonState(true);  
        return;
    }

    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.style.cssText = "display:none; position:fixed; bottom:20px; left:20px; z-index:9999; background:#e50914; color:white; border:none; padding:10px 15px; font-size:16px; font-weight:bold; border-radius:5px; cursor:pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: all 0.2s;";
    
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      shuffleEpisode();
    });
    
    document.body.appendChild(btn);
    
    // Check state immediately upon creation so it renders as a loader if needed
    if (isShuffling) {
        setButtonState(true);
    } else {
        setButtonState(false);
    }
    
    injected = true;
    log("Shuffle button injected");
  }

  function init() {
    injectStyles(); 
    injectButton();

    const observer = new MutationObserver(() => {
      if (!document.getElementById(BUTTON_ID)) injectButton();
      updateButtonVisibility();
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('pageshow', () => {
      setButtonState(false);
    });

  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();