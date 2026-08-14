(function () {
  var INTERVAL_MS = 10000;
  var MAX_MS = 30 * 60 * 1000;
  var path = location.pathname;
  var id = readCookie("pv");
  var timer = null;
  var duration = 0;
  var sent = -1;
  var startAt = 0;

  function readCookie(name) {
    var match = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)")
    );
    return match ? match[1] : "";
  }

  function visible() {
    return document.visibilityState === "visible";
  }

  function pageviewId() {
    if (!id) {
      id = readCookie("pv");
    }
    return id;
  }

  function begin() {
    if (!startAt && visible()) {
      startAt = Date.now();
    }
  }

  function pause() {
    if (startAt) {
      duration += Date.now() - startAt;
      startAt = 0;
    }
  }

  function ping(force) {
    var pageviewIdValue = pageviewId();
    if (!pageviewIdValue || (!force && !visible())) {
      return;
    }
    pause();
    var ms = Math.min(Math.round(duration), MAX_MS);
    if (visible()) {
      begin();
    }
    if (!force && ms === sent) {
      return;
    }
    sent = ms;
    var body = JSON.stringify({
      id: pageviewIdValue,
      path: path,
      duration_ms: ms,
    });
    var url =
      "/_ping?id=" +
      encodeURIComponent(pageviewIdValue) +
      "&path=" +
      encodeURIComponent(path) +
      "&duration_ms=" +
      ms;
    var blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon || !navigator.sendBeacon(url, blob)) {
      fetch(url, {
        method: "POST",
        body: body,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      });
    }
  }

  function start() {
    if (timer || !visible() || !pageviewId()) {
      return;
    }
    begin();
    ping();
    timer = setInterval(ping, INTERVAL_MS);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    ping(true);
  }

  document.addEventListener("visibilitychange", function () {
    if (visible()) {
      start();
    } else {
      stop();
    }
  });
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", start);
  start();
})();
