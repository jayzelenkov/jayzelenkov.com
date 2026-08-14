(function () {
  var INTERVAL_MS = 10000;
  var path = location.pathname;
  var pageviewId = readCookie("pv");
  var timer = null;

  function readCookie(name) {
    var match = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)")
    );
    return match ? match[1] : "";
  }

  function visible() {
    return document.visibilityState === "visible";
  }

  function ping() {
    if (!pageviewId || !visible()) {
      return;
    }
    var body = JSON.stringify({ id: pageviewId, path: path });
    var blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon || !navigator.sendBeacon("/_ping", blob)) {
      fetch("/_ping", {
        method: "POST",
        body: body,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      });
    }
  }

  function start() {
    if (timer || !visible() || !pageviewId) {
      return;
    }
    ping();
    timer = setInterval(ping, INTERVAL_MS);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
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
