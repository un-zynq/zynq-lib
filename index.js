class ZYNQGames {
  constructor() {
    this.config = {
      src: "https://cdn.jsdelivr.net/gh/un-zynq/zynq-lib@1.1.4/games.json",
      cdn: "https://cdn.jsdelivr.net/gh/un-zynq/thumbnails",
    };
    this.all = [];
    this.filtered = [];
    this.favorites = this._initStorage();
    this.deviceType = 2;
    this.history = this._initHistory();
  }

  async init(options = {}) {
    const { 
      mode = "all", 
      search = "", 
      sort = "name", 
      version = null, // De nieuwe parameter voor de commit hash
      src = this.config.src, 
      cdn = this.config.cdn 
    } = options;

    // Als er een versie/hash is meegegeven, passen we de bronaanvraag aan
    if (version) {
      this.config.src = `https://cdn.jsdelivr.net/gh/un-zynq/zynq-lib@${version}/games.json`;
    } else {
      this.config.src = src;
    }
    
    this.config.cdn = cdn;

    this._detectDevice();
    await this._loadData(sort);

    if (search) this.search(search);
    if (mode === "supported") this.filterSupported();
    if (mode === "favs") this.filterFavorites();

    return this;
  }

  _detectDevice() {
    const n = navigator;
    const ua = n.userAgent;
    const touchPoints = n.maxTouchPoints || 0;
    const hasFinePointer = window.matchMedia("(pointer: fine)").matches;
    const hasHover = window.matchMedia("(hover: hover)").matches;
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "";
    
    let scores = { desktop: 0, mobile: 0 };
    if (/Win|Mac|Linux/i.test(ua)) scores.desktop += 15;
    if (ua.includes("x64") || ua.includes("wow64")) scores.desktop += 10;
    if (hasFinePointer && hasHover) scores.desktop += 20;
    if (/Intel|Nvidia|AMD|Direct3D|GeForce/i.test(renderer)) scores.desktop += 25;
    if (/Android|iPhone|iPad|iPod/i.test(ua)) scores.mobile += 20;
    if (/Adreno|Mali|PowerVR|Apple GPU/i.test(renderer)) scores.mobile += 25;

    if (scores.desktop > scores.mobile) {
      this.deviceType = touchPoints > 0 ? 1 : 2;
    } else if (/Macintosh/i.test(ua) && touchPoints > 1) {
      this.deviceType = 4;
    } else {
      const isLarge = window.screen.width >= 1024 || (window.screen.width >= 768 && touchPoints > 1);
      this.deviceType = isLarge ? 4 : 3;
    }
    window.ZYNQ.deviceType = this.deviceType;
  }

  async _loadData(sortKey) {
    try {
      const response = await fetch(this.config.src);
      const data = await response.json();
      const library = [];

      data.forEach((category) => {
        Object.entries(category).forEach(([base, games]) => {
          Object.entries(games).forEach(([alias, meta]) => {
            library.push({
              name: meta.name || alias,
              category: meta.category || undefined,
              alias: alias,
              url: `${base}/${alias}`,
              thumb: `${this.config.cdn}/${base}/${alias}.webp`,
              devices: meta.devices ? String(meta.devices).split(",").map(Number) : [],
              get isSupported() {
                return window.ZYNQ.deviceType === null || (this.devices?.includes(window.ZYNQ.deviceType) ?? true);
              },
              get isFavorite() {
                return window.ZYNQ.games.isFavorite(this.alias);
              }
            });
          });
        });
      });

      this.all = library.sort((a, b) => (a[sortKey] || "").localeCompare(b[sortKey] || ""));
      this.filtered = [...this.all];
    } catch (err) {
      console.error("ZYNQ Core Load Error:", err);
    }
  }

  search(query) {
    const q = query?.toLowerCase().trim();
    this.filtered = q ? this.all.filter(g => g.name.toLowerCase().includes(q) || g.alias.toLowerCase().includes(q)) : [...this.all];
    return this;
  }

  random(limit = 1) {
    const source = this.filtered.length > 0 ? this.filtered : this.all;
    this.filtered = [...source].sort(() => Math.random() - 0.5).slice(0, limit);
    return this;
  }

  getRandomOne() {
    const source = this.filtered.length > 0 ? this.filtered : this.all;
    return source[Math.floor(Math.random() * source.length)];
  }

  shuffle() {
    const arr = this.filtered.length > 0 ? this.filtered : this.all;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    this.filtered = arr;
    return this;
  }

  sortBy(key = "name") {
    this.filtered.sort((a, b) => (a[key] || "").localeCompare(b[key] || ""));
    return this;
  }

  sortByPopularity() {
    this.filtered.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    return this;
  }

  getByAlias(alias) {
    return this.all.find(game => game.alias === alias) || null;
  }

  getByCategory(category) {
    this.filtered = this.all.filter(game => game.category === category);
    return this;
  }

  filterSupported() {
    this.filtered = this.filtered.filter(g => g.isSupported);
    return this;
  }

  filterFavorites() {
    this.filtered = this.filtered.filter(g => g.isFavorite);
    return this;
  }

  addToHistory(alias) {
    this.history = [alias, ...this.history.filter(a => a !== alias)].slice(0, 50);
    localStorage.setItem("ZYNQ_history", JSON.stringify(this.history));
    return this;
  }

  getHistory() {
    return this.history.map(alias => this.getByAlias(alias)).filter(Boolean);
  }

  clearHistory() {
    this.history = [];
    localStorage.removeItem("ZYNQ_history");
    return this;
  }

  reset() {
    this.filtered = [...this.all];
    return this;
  }

  isFavorite(alias) {
    return this.favorites.has(alias);
  }

  toggleFavorite(alias) {
    this.favorites.has(alias) ? this.favorites.delete(alias) : this.favorites.add(alias);
    localStorage.setItem("ZYNQ_favs", JSON.stringify([...this.favorites]));
    return this;
  }

  get list() {
    return this.filtered;
  }

  get total() {
    return this.all.length;
  }

  get filteredCount() {
    return this.filtered.length;
  }

  _initStorage() {
    try {
      const data = localStorage.getItem("ZYNQ_favs");
      return new Set(data ? JSON.parse(data) : []);
    } catch {
      return new Set();
    }
  }

  _initHistory() {
    try {
      const data = localStorage.getItem("ZYNQ_history");
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }
}

const ZYNQ = {
  games: new ZYNQGames(),
  deviceType: null
};

window.ZYNQ = ZYNQ;
