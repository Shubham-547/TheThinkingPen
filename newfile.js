// Jab poora HTML document browser me load ho jayega, tab ye code chalega
document.addEventListener("DOMContentLoaded", () => {

  // ── 0. Hero Section + Featured Cards Load from Database ──
  const likeIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M692-172H302v-416l242-238 8 8q5 5 8.5 12.5T564-792v4l-40 200h284q23 0 41.5 18.5T868-528v40q0 5-1 11t-3 11L758-214q-8 18-27 30t-39 12Zm-362-28h362q11 0 22.5-6t17.5-20l108-254v-48q0-14-9-23t-23-9H490l44-218-204 202v376Zm0-376v376-376Zm-28-12v28H160v360h142v28H132v-416h170Z"/></svg>`;

  async function loadHeroSection() {
    try {
      const res = await fetch('/api/content/hero');
      const data = await res.json();
      if (data.success && data.data) {
        const h = data.data;
        const heroSection = document.getElementById('hero-section');
        const titleEl = document.getElementById('hero-title-text');
        const descEl = document.getElementById('hero-desc-text');
        const logoEl = document.getElementById('hero-logo-img');

        if (titleEl && h.hero_title) titleEl.innerText = h.hero_title;
        if (descEl && h.hero_desc) descEl.innerText = h.hero_desc;
        if (logoEl && h.hero_logo_url) logoEl.src = h.hero_logo_url;
        if (heroSection && h.hero_bg_url) {
          heroSection.style.backgroundImage = `url("${h.hero_bg_url}")`;
          heroSection.style.backgroundSize = "cover";
          heroSection.style.backgroundPosition = "center";
        }

        // Read Now button — admin ne jo "Current Content" set kiya hai wahi khulega
        const readBtn = document.getElementById('hero-read-now-btn');
        if (readBtn) {
          if (h.hero_read_target_card_id) {
            readBtn.href = `nnnt/index.html?id=${h.hero_read_target_card_id}`;
            readBtn.onclick = null;
          } else {
            readBtn.href = '#';
            readBtn.onclick = (e) => { e.preventDefault(); alert('Coming Soon'); };
          }
        }
      }
    } catch (e) { console.error("Hero load error", e); }
  }

  async function loadCardsIntoGrid(page, gridId) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    try {
      const res = await fetch('/api/content/cards?page=' + page);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        if (data.data.length === 0) {
          grid.innerHTML = '';
          return;
        }
        grid.innerHTML = data.data.map(card => {
          const isStory = (card.media_type === 'video') || (card.badge_text || "").toLowerCase() === "story";
          const mediaHtml = isStory
            ? `<div class="story-card-video-wrap">
                 <video class="story-video" src="${card.image_url}" muted loop playsinline></video>
                 <div class="story-play-overlay">
                   <svg width="44" height="44" fill="none" stroke="#c9a84c" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="rgba(13,13,13,.7)"/><polygon points="10,8 16,12 10,16" fill="#c9a84c" stroke="none"/></svg>
                 </div>
                 <span class="card-type-badge">${card.badge_text}</span>
               </div>`
            : `<div class="card-img-wrap">
                 <img src="${card.image_url}" alt="${card.badge_text}" loading="lazy" />
                 <span class="card-type-badge">${card.badge_text}</span>
               </div>`;

          return `<div class="card">
            <div style="cursor:pointer;" onclick="window.location.href='nnnt/index.html?id=${card.linked_target_card_id || card.card_id}'">
                ${mediaHtml}
                <div class="card-body">
                  <div class="card-title">${card.title}</div>
                  <div class="card-desc">${card.description}</div>
                  <div class="card-author">— ${card.author_name}</div>
                </div>
            </div>
            <div class="card-footer">
              <button class="like-btn" data-post-id="${card.card_id}">${likeIconSvg} Like</button>
              <div class="dot-wrap">
                <button class="dot-btn">&#8942;</button>
                <div class="dot-menu">
                <dir class="inside-dot-menu"><div class="comment-trigger" data-card-id="${card.card_id}" data-title="${card.title}"><dir class="comment_icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-square-text-icon lucide-message-square-text"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M7 11h10"/><path d="M7 15h6"/><path d="M7 7h8"/></dir></svg> Comments</div>
                <div class="save-trigger" data-card-id="${card.card_id}" data-title="${card.title}"><dir class="save_icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bookmark-icon lucide-bookmark"><path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/></svg></dir>save to playlist</div>
                <div class="report-trigger" data-card-id="${card.card_id}" data-title="${card.title}" data-author="${card.author_name}" data-thumb="${card.image_url}"><dir class="report_icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-icon lucide-flag"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg></dir>Report</div></div>
                </div>
              </div>
            </div>
          </div>`;
        }).join('');

        loadLikes();
        observeStoryVideos();
      }
    } catch (e) { console.error(`Cards load error (${page})`, e); }
  }

  async function loadFeaturedCards() {
    await loadCardsIntoGrid('home', 'featured-grid');
  }

  function loadAllPageCards() {
    loadCardsIntoGrid('home', 'featured-grid');
    loadCardsIntoGrid('article', 'article-grid');
    loadCardsIntoGrid('poem', 'poem-grid');
    loadCardsIntoGrid('story', 'story-grid');
  }

  loadHeroSection();
  loadAllPageCards();

  // ── Live Update Polling: bina reload kiye admin ke changes har page par dikhana ──
  let lastKnownVersion = null;
  async function checkForContentUpdates() {
    try {
      const res = await fetch('/api/content/version');
      const data = await res.json();
      if (data.success) {
        if (lastKnownVersion === null) {
          lastKnownVersion = data.version;
        } else if (data.version !== lastKnownVersion) {
          lastKnownVersion = data.version;
          loadHeroSection();
          loadAllPageCards();
        }
      }
    } catch (e) { /* silent fail, network hiccup ho sakti hai */ }
  }
  setInterval(checkForContentUpdates, 4000);

  // ── 1. Page Navigation Logic (Tabs Switch Karna) ──
  const navLinks = document.querySelectorAll(".nav-link");
  const pages = document.querySelectorAll(".page-section-container");

  navLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");

      // Agar link ka href "#" nahi hai (jaise Contact Us -> writeverse.html),
      // to use normal browser navigation karne do, JS intercept na kare.
      if (href && href !== "#") {
        return;
      }

      e.preventDefault();
      navLinks.forEach(l => l.classList.remove("active"));
      link.classList.add("active");

      const targetPageId = "page-" + link.getAttribute("data-page");
      pages.forEach(page => { page.style.display = "none"; });
      document.getElementById(targetPageId).style.display = "block";
      window.scrollTo(0, 0);
    });
  });

  // ── 2. Like Button & Formatter Logic (Event Delegation — dynamic cards ke liye bhi kaam karega) ──
  function formatLikes(num) {
      num = Number(num);
      if (num === 0) return "Like";
      if (num < 1000) return num.toString();
      if (num < 1000000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + "k";
      if (num < 100000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + "m";
      if (num < 1000000000) return (num / 100000000).toFixed(1).replace(/\.0$/, '') + " crore";
      return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + "b";
  }

  async function loadLikes() {
      try {
          const res = await fetch('/api/likes');
          const data = await res.json();
          if (data.success) {
              document.querySelectorAll(".like-btn").forEach(btn => {
                  const postId = btn.getAttribute("data-post-id");
                  if (!postId) return;

                  const postData = data.totals.find(t => t.post_id === postId);
                  const total = postData ? postData.total : 0;

                  const svgIcon = btn.querySelector("svg").outerHTML;
                  btn.innerHTML = svgIcon + " " + formatLikes(total);

                  if (data.userLikes.includes(postId)) {
                      btn.classList.add("liked");
                  }
              });
          }
      } catch (e) { console.error("Likes load error", e); }
  }
  loadLikes();

  // Event delegation: ye dynamically (database se) injected like buttons par bhi kaam karega
  document.addEventListener("click", async function(e) {
      const btn = e.target.closest(".like-btn");
      if (!btn) return;
      const postId = btn.getAttribute("data-post-id");
      if (!postId) return;

      const res = await fetch('/api/like/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: postId })
      });
      const data = await res.json();

      if (data.success) {
          btn.classList.toggle("liked", data.liked);
          const svgIcon = btn.querySelector("svg").outerHTML;
          btn.innerHTML = svgIcon + " " + formatLikes(data.newTotal);
      } else {
          alert(data.message);
      }
  });

  // ── 3. Dropdown Menu (3-dots Options) Logic — Event Delegation ──
  document.addEventListener("click", function(e) {
      const dotBtn = e.target.closest(".dot-btn");
      if (dotBtn) {
          e.stopPropagation();
          const menu = dotBtn.nextElementSibling;
          const isCurrentlyOpen = menu.style.display === "block";
          document.querySelectorAll(".dot-menu").forEach(m => m.style.display = "none");
          menu.style.display = isCurrentlyOpen ? "none" : "block";
          return;
      }
      // Bahar click hua to saare dot-menus band
      if (!e.target.closest(".dot-menu")) {
          document.querySelectorAll(".dot-menu").forEach(m => m.style.display = "none");
      }
  });

  // ── 4. Comment Trigger → comments.html redirect ──
  // Dynamic cards mein data-card-id hoga, static cards mein data-title se kaam chalega
  document.addEventListener("click", function(e) {
      const trigger = e.target.closest(".comment-trigger");
      if (!trigger) return;
      const cardId = trigger.getAttribute("data-card-id") || trigger.getAttribute("data-title");
      if (cardId) {
          document.querySelectorAll(".dot-menu").forEach(m => m.style.display = "none");
          window.location.href = `/comments.html?card_id=${encodeURIComponent(cardId)}`;
      }
  });

  // ── 5. Story Video Auto-Play Logic ──
  let videoObserver = null;
  const observedVideos = new Set();

  function observeStoryVideos() {
    if (!("IntersectionObserver" in window)) return;
    if (!videoObserver) {
      videoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          const vid = entry.target;
          if (entry.intersectionRatio >= 0.7) {
            vid.play().catch(() => {});
          } else {
            vid.pause();
          }
        });
      }, { threshold: [0, 0.3, 0.7, 1] });
    }
    document.querySelectorAll(".story-video").forEach(v => {
      if (observedVideos.has(v)) return;
      observedVideos.add(v);
      videoObserver.observe(v);
      v.addEventListener("click", () => {
        if (v.paused) v.play();
        else v.pause();
      });
    });
  }
  observeStoryVideos();

  // ── 7. Search Input Logic (Real search — /api/content/search) ──
  const searchInput = document.getElementById("search-input");
  const searchGrid = document.getElementById("search-grid");
  const searchSub = document.getElementById("search-result-sub");
  let searchDebounce = null;

  function cardHtmlFor(card) {
    const isStory = (card.media_type === 'video') || (card.badge_text || "").toLowerCase() === "story";
    const mediaHtml = isStory
      ? `<div class="story-card-video-wrap">
           <video class="story-video" src="${card.image_url}" muted loop playsinline></video>
           <div class="story-play-overlay">
             <svg width="44" height="44" fill="none" stroke="#c9a84c" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="rgba(13,13,13,.7)"/><polygon points="10,8 16,12 10,16" fill="#c9a84c" stroke="none"/></svg>
           </div>
           <span class="card-type-badge">${card.badge_text}</span>
         </div>`
      : `<div class="card-img-wrap">
           <img src="${card.image_url}" alt="${card.badge_text}" loading="lazy" />
           <span class="card-type-badge">${card.badge_text}</span>
         </div>`;
    return `<div class="card">
      <div style="cursor:pointer;" onclick="window.location.href='nnnt/index.html?id=${card.linked_target_card_id || card.card_id}'">
          ${mediaHtml}
          <div class="card-body">
            <div class="card-title">${card.title}</div>
            <div class="card-desc">${card.description}</div>
            <div class="card-author">— ${card.author_name}</div>
          </div>
      </div>
    </div>`;
  }

  function showSearchPage() {
    navLinks.forEach(l => l.classList.remove("active"));
    pages.forEach(page => { page.style.display = "none"; });
    document.getElementById("page-search").style.display = "block";
    window.scrollTo(0, 0);
  }

  async function runSearch(query) {
    query = query.trim();
    if (!query) return;
    showSearchPage();
    searchSub.textContent = `Searching for "${query}"…`;
    searchGrid.innerHTML = '';
    try {
      const res = await fetch('/api/content/search?q=' + encodeURIComponent(query));
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        if (data.data.length === 0) {
          searchSub.textContent = `No results found for "${query}".`;
          searchGrid.innerHTML = '';
        } else {
          searchSub.textContent = `${data.data.length} result${data.data.length > 1 ? 's' : ''} found for "${query}"`;
          searchGrid.innerHTML = data.data.map(cardHtmlFor).join('');
        }
      } else {
        searchSub.textContent = `Search failed. Please try again.`;
      }
    } catch (e) {
      searchSub.textContent = `Search failed. Please check your connection.`;
    }
  }

  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && searchInput.value.trim() !== "") {
        runSearch(searchInput.value);
      }
    });
    searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      const q = searchInput.value.trim();
      if (!q) return;
      searchDebounce = setTimeout(() => runSearch(q), 450);
    });
  }

});


// ── REPORT TRIGGER LOGIC ──
  document.addEventListener("click", function(e) {
      // 1. Open report.html with card info as URL params
      const trigger = e.target.closest(".report-trigger");
      if (trigger) {
          e.preventDefault();
          document.querySelectorAll(".dot-menu").forEach(m => m.style.display = "none");

          const cardId = trigger.getAttribute("data-card-id") || '';
          const title  = trigger.getAttribute("data-title")   || '';
          const author = trigger.getAttribute("data-author")  || '';
          const thumb  = trigger.getAttribute("data-thumb")   || '';

          const params = new URLSearchParams({ card_id: cardId, title, author, thumb });
          window.location.href = `/report.html?${params.toString()}`;
          return;
      }

      // 2. Close inline report modal if it was open (newfile.html mein jo modal hai)
      if (e.target.closest("#close-report-modal") || e.target.closest("#cancel-report-btn")) {
          const reportModal = document.getElementById("report-modal-backdrop");
          if (reportModal) {
              reportModal.style.display = "none";
              document.querySelectorAll('input[name="report_reason"]').forEach(r => r.checked = false);
              const nextBtn = document.getElementById("next-report-btn");
              if (nextBtn) { nextBtn.disabled = true; nextBtn.style.background = "#f2f2f2"; nextBtn.style.color = "#909090"; }
          }
      }
  });

  // 3. Enable NEXT button (inline modal — fallback)
  document.addEventListener("change", function(e) {
      if (e.target.name === "report_reason") {
          const nextBtn = document.getElementById("next-report-btn");
          if (nextBtn) {
              nextBtn.disabled = false;
              nextBtn.style.background = "#065fd4";
              nextBtn.style.color = "#ffffff";
              nextBtn.style.cursor = "pointer";
          }
      }
  });