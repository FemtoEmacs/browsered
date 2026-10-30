// irene-dixe-pre.js -- the page's side of src/web-sdl.c: irene-dixe's
// window (a canvas in a box over the editor), its pictures (canvases off
// the page) and its events.  Each run of irene-dixe is a module of its
// own (createIreneDixe), started by web/browsered.js.

Module.sdl = (function () {
  "use strict";
  var surfaces = {}, next = 1, queue = [], waiting = null, measure = null;
  var family = "Helvetica, Arial, 'DejaVu Sans', sans-serif";

  function font(px, bold) { return (bold ? "bold " : "") + px + "px " + family; }
  function push(ev) {
    if (waiting) { var w = waiting; waiting = null; w(ev); } else queue.push(ev);
  }
  var keys = { q: 113, Q: 113, s: 115, S: 115, " ": 32, Escape: 27,
    ArrowRight: (1 << 30) | 79, ArrowLeft: (1 << 30) | 80, ArrowDown: (1 << 30) | 81,
    ArrowUp: (1 << 30) | 82, Home: (1 << 30) | 74, PageUp: (1 << 30) | 75,
    End: (1 << 30) | 77, PageDown: (1 << 30) | 78 };

  function openWindow(title, w, h) {
    var ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
    var box = document.createElement("div");
    box.className = "irene-dixe";
    box.tabIndex = 0;
    box.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5;" +
      "background:#f4f4f4;border:1px solid #888;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.5);" +
      "max-width:96vw;max-height:94vh;overflow:hidden;outline:none";
    var bar = document.createElement("div");
    bar.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:16px;" +
      "padding:6px 10px;font:13px -apple-system,'Segoe UI',sans-serif;color:#333;background:#ddd";
    var name = document.createElement("span");
    name.textContent = title + "   (s saves the picture, q closes)";
    var close = document.createElement("button");
    close.textContent = "×";
    close.style.cssText = "border:0;background:none;font-size:18px;cursor:pointer";
    close.onclick = function () { push({ type: 0x100 }); };
    bar.appendChild(name); bar.appendChild(close);
    var canvas = document.createElement("canvas");
    canvas.width = w * ratio; canvas.height = h * ratio;
    // shown smaller when the browser window is smaller (the picture keeps its size)
    var fit = Math.min(1, (window.innerWidth * 0.94) / w, (window.innerHeight * 0.94 - 34) / h);
    canvas.style.cssText = "display:block;width:" + Math.floor(w * fit) + "px;height:" +
      Math.floor(h * fit) + "px";
    box.appendChild(bar); box.appendChild(canvas);
    document.body.appendChild(box);
    box.addEventListener("keydown", function (e) {
      e.stopPropagation();            // the editor does not see irene-dixe's keys
      var k = keys[e.key];
      if (k !== undefined) { e.preventDefault(); push({ type: 0x300, a: k }); }
    });
    box.addEventListener("wheel", function (e) {
      e.preventDefault();
      push({ type: 0x403, a: e.deltaX ? (e.deltaX < 0 ? 1 : -1) : 0, b: e.deltaY ? (e.deltaY < 0 ? 1 : -1) : 0 });
    }, { passive: false });
    box.focus();
    var id = next++;
    surfaces[id] = { canvas: canvas, ctx: canvas.getContext("2d"), box: box, clipped: false, color: "#000" };
    return id;
  }

  function offscreen(w, h) {
    var canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    var id = next++;
    surfaces[id] = { canvas: canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }),
                     clipped: false, color: "#000" };
    return id;
  }

  function closeWindow(id) {
    var s = surfaces[id];
    if (!s) return;
    if (s.box) {
      s.box.remove();
      var keys = document.getElementById("keys");
      if (keys) keys.focus();
    }
    delete surfaces[id];
  }

  return {
    openWindow: openWindow,
    offscreen: offscreen,
    closeWindow: closeWindow,
    color: function (id, r, g, b, a) {
      var s = surfaces[id];
      s.color = "rgba(" + r + "," + g + "," + b + "," + (a / 255) + ")";
      s.ctx.fillStyle = s.ctx.strokeStyle = s.color;
    },
    clear: function (id) {
      var s = surfaces[id];
      s.ctx.fillRect(0, 0, s.canvas.width, s.canvas.height);
    },
    fill: function (id, x, y, w, h, all) {
      var s = surfaces[id];
      if (all) s.ctx.fillRect(0, 0, s.canvas.width, s.canvas.height);
      else s.ctx.fillRect(x, y, w, h);
    },
    line: function (id, x1, y1, x2, y2) {
      var c = surfaces[id].ctx;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x1 + 0.5, y1 + 0.5);
      c.lineTo(x2 + 0.5, y2 + 0.5);
      c.stroke();
    },
    clip: function (id, x, y, w, h, on) {
      var s = surfaces[id], c = s.ctx;
      if (s.clipped) { c.restore(); s.clipped = false; c.fillStyle = c.strokeStyle = s.color; }
      if (on) {
        c.save();
        c.beginPath(); c.rect(x, y, w, h); c.clip();
        s.clipped = true;
      }
    },
    text: function (id, text, px, bold, r, g, b, a, x, y) {
      var s = surfaces[id], c = s.ctx;
      c.font = font(px, bold);
      c.textBaseline = "top";
      c.fillStyle = "rgba(" + r + "," + g + "," + b + "," + (a / 255) + ")";
      c.fillText(text, x, y + Math.round(px * 0.1));
      c.fillStyle = s.color;
    },
    textWidth: function (text, px, bold) {
      if (!measure) measure = document.createElement("canvas").getContext("2d");
      measure.font = font(px, bold);
      return Math.ceil(measure.measureText(text).width);
    },
    readPixels: function (id, ptr, w, h) {
      var d = surfaces[id].ctx.getImageData(0, 0, w, h).data, base = ptr >> 2;
      for (var i = 0, n = w * h; i < n; i++)
        HEAPU32[base + i] = ((255 << 24) | (d[4 * i] << 16) | (d[4 * i + 1] << 8) | d[4 * i + 2]) >>> 0;
    },
    present: function () { },
    nextEvent: function (ptr, wait) {
      var write = function (ev) {
        HEAP32[ptr >> 2] = ev.type;
        HEAP32[(ptr + 4) >> 2] = ev.a || 0;
        HEAP32[(ptr + 8) >> 2] = ev.b || 0;
        return 1;
      };
      if (queue.length) return Promise.resolve(write(queue.shift()));
      if (!wait) return Promise.resolve(0);
      return new Promise(function (resolve) { waiting = function (ev) { resolve(write(ev)); }; });
    }
  };
})();
