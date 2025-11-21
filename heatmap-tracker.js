(function (window, document) {
    "use strict";
  
    /**
     * Config layer - override via window.HeatmapConfig BEFORE loading this script.
     */
    var defaults = {
      trackUrl: "/track",
      heatmapDataUrl: "/heatmap-data",
      heatmapParam: "heatmap",
      enabled: true,
      enableHeatmapOverlay: true,
      sessionKey: "pl_session_id",
      debug: true,
      heatmapJsUrl: "https://cdn.jsdelivr.net/npm/heatmap.js@2.0.5/build/heatmap.min.js"
    };
  
    var cfg = window.HeatmapConfig || {};
    for (var k in defaults) {
      if (!Object.prototype.hasOwnProperty.call(cfg, k)) {
        cfg[k] = defaults[k];
      }
    }
  
    if (!cfg.enabled) return;
  
    // ---------------------- TRACKING (pageview / leave / click) ----------------------
  
    var TRACK_URL = cfg.trackUrl;
    var PAGE = window.location.pathname || "/";
    var START_TIME = Date.now();
    var hasLeftSent = false;
  
    function getSessionId() {
      try {
        var KEY = cfg.sessionKey || "pl_session_id";
        var id = window.localStorage.getItem(KEY);
        if (!id) {
          id = "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
          window.localStorage.setItem(KEY, id);
        }
        return id;
      } catch (e) {
        return "sess_" + Math.random().toString(36).slice(2);
      }
    }
  
    var SESSION_ID = getSessionId();
  
    function send(payload) {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(TRACK_URL, blob);
      } else {
        fetch(TRACK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body
        }).catch(function () {});
      }
    }
  
    // pageview
    send({
      sessionId: SESSION_ID,
      eventType: "pageview",
      page: PAGE
    });
  
    // leave / time on page - ONLY SEND ONCE
    function sendLeave() {
      if (hasLeftSent) return;
      hasLeftSent = true;
  
      send({
        sessionId: SESSION_ID,
        eventType: "leave",
        page: PAGE,
        durationMs: Date.now() - START_TIME
      });
    }
  
    window.addEventListener("beforeunload", sendLeave);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") sendLeave();
    });
  
    // click - WITH SCROLL OFFSET
    document.addEventListener("click", function (e) {
      send({
        sessionId: SESSION_ID,
        eventType: "click",
        page: PAGE,
        x: e.clientX + window.scrollX,  // INCLUDES SCROLL OFFSET
        y: e.clientY + window.scrollY,  // INCLUDES SCROLL OFFSET
        viewportW: window.innerWidth,
        viewportH: window.innerHeight
      });
    });
  
    console.log("[analytics] tracker initialized for", PAGE);
  
    // ---------------------- HEATMAP OVERLAY ( ?heatmap=1 ) ----------------------
  
    function loadHeatmapJs(callback) {
      // Check if already loaded
      if (window.h337) {
        callback();
        return;
      }
  
      var script = document.createElement("script");
      script.src = cfg.heatmapJsUrl;
      script.onload = callback;
      script.onerror = function () {
        console.error("[heatmap] Failed to load heatmap.js from", cfg.heatmapJsUrl);
      };
      document.head.appendChild(script);
    }
  
    function initHeatmapOverlay() {
      if (!cfg.enableHeatmapOverlay) return;
  
      // Check ?heatmap=1
      var urlParams;
      try {
        urlParams = new URLSearchParams(window.location.search);
      } catch (e) {
        return;
      }
      
      if (urlParams.get(cfg.heatmapParam) !== "1") return;
  
      console.log("[heatmap] Loading heatmap data...");
  
      // Load heatmap.js first, then initialize
      loadHeatmapJs(function () {
        if (!window.h337) {
          console.error("[heatmap] h337 not available after loading");
          return;
        }
  
        // Wrapper that doesn't affect layout
        var wrapper = document.createElement("div");
        wrapper.id = "heatmap-wrapper";
        wrapper.style.cssText = 
          "position: fixed !important;" +
          "top: 0 !important;" +
          "left: 0 !important;" +
          "width: 100% !important;" +
          "height: 100% !important;" +
          "pointer-events: none !important;" +
          "z-index: 999999 !important;" +
          "overflow: hidden !important;";
  
        // Inner container that can be larger than viewport
        var container = document.createElement("div");
        container.id = "heatmap-container";
        container.style.cssText = 
          "position: absolute !important;" +
          "top: 0 !important;" +
          "left: 0 !important;" +
          "width: 100vw !important;" +
          "height: " + document.body.scrollHeight + "px !important;" +
          "pointer-events: none !important;" +
          "transform-origin: top left !important;";
  
        wrapper.appendChild(container);
        document.body.appendChild(wrapper);
  
        var heatmapInstance = window.h337.create({
          container: container,
          radius: 30,
          maxOpacity: 0.6,
          minOpacity: 0,
          blur: 0.75,
          gradient: {
            "0.0": "blue",
            "0.5": "cyan",
            "0.7": "lime",
            "0.9": "yellow",
            "1.0": "red"
          }
        });
  
        // Update container position based on scroll
        function updatePosition() {
          var scrollY = -(window.scrollY || window.pageYOffset);
          container.style.transform = "translateY(" + scrollY + "px)";
          container.style.height = document.body.scrollHeight + "px";
        }
  
        window.addEventListener("scroll", updatePosition, { passive: true });
        window.addEventListener("resize", updatePosition);
  
        var page = window.location.pathname || "/";
  
        // 🔐 Load heatmap data, handling "not logged in" -> redirect to admin login
        (function loadHeatmapData() {
          fetch(cfg.heatmapDataUrl + "?page=" + encodeURIComponent(page), {
            headers: { "Accept": "application/json" }
          })
            .then(function (res) {
              // If not logged in, backend returns 401 + JSON with redirect URL
              if (res.status === 401) {
                return res.json()
                  .catch(function () {
                    return {};
                  })
                  .then(function (data) {
                    if (data && data.redirect) {
                      window.location = data.redirect;
                    } else {
                      // Fallback if redirect not present for some reason
                      window.location = "/admin/login?next=" +
                        encodeURIComponent(window.location.pathname + window.location.search);
                    }
                    throw new Error("Unauthorized");
                  });
              }
              return res.json();
            })
            .then(function (data) {
              console.log("[heatmap] Loaded " + data.count + " points");
  
              if (data.count === 0) {
                var msg = document.createElement("div");
                msg.style.cssText = 
                  "position: fixed;" +
                  "top: 50%;" +
                  "left: 50%;" +
                  "transform: translate(-50%, -50%);" +
                  "background: rgba(0,0,0,0.8);" +
                  "color: white;" +
                  "padding: 20px 40px;" +
                  "border-radius: 8px;" +
                  "z-index: 1000000;" +
                  "pointer-events: all;" +
                  "font-family: 'Inter', sans-serif;";
                msg.textContent = "No click data yet for this page. Click around and check back!";
                document.body.appendChild(msg);
                setTimeout(function () {
                  msg.remove();
                }, 3000);
                return;
              }
  
              // Convert ALL points at once (no filtering)
              var points = data.points.map(function (p) {
                var currentW = window.innerWidth;
                var x = p.vw ? (p.x / p.vw) * currentW : p.x;
                var y = p.y;
  
                return {
                  x: Math.round(x),
                  y: Math.round(y),
                  value: 1
                };
              });
  
              // Set all data at once
              heatmapInstance.setData({
                max: 10,
                data: points
              });
  
              // Initial position
              updatePosition();
  
              // Add toggle button
              var toggleBtn = document.createElement("button");
              toggleBtn.textContent = "Hide Heatmap";
              toggleBtn.style.cssText = 
                "position: fixed !important;" +
                "top: 80px !important;" +
                "right: 20px !important;" +
                "z-index: 1000000 !important;" +
                "padding: 12px 24px;" +
                "background: #10b981;" +
                "color: white;" +
                "border: none;" +
                "border-radius: 6px;" +
                "cursor: pointer;" +
                "font-family: 'Inter', sans-serif;" +
                "font-weight: 600;" +
                "box-shadow: 0 4px 20px rgba(16, 185, 129, 0.4);" +
                "pointer-events: all !important;";
  
              var visible = true;
              toggleBtn.addEventListener("click", function () {
                visible = !visible;
                wrapper.style.display = visible ? "block" : "none";
                toggleBtn.textContent = visible ? "Hide Heatmap" : "Show Heatmap";
              });
  
              document.body.appendChild(toggleBtn);
            })
            .catch(function (err) {
              console.error("[heatmap] Error loading data:", err);
            });
        })();
      });
    }
  
    // Initialize when DOM is ready
    if (document.readyState === "complete" || document.readyState === "interactive") {
      initHeatmapOverlay();
    } else {
      document.addEventListener("DOMContentLoaded", initHeatmapOverlay);
    }
  })(window, document);