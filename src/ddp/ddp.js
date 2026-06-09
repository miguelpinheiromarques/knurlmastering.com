/* ==========================================================================
   Knurl DDP Player
   A fully client-side Disc Description Protocol (DDP 2.00 / 1.01) player.
   Parses DDPID / DDPMS / PQDESCR / CD-TEXT, plays the raw CD-DA image,
   renders an overview waveform and a PQ tracklist. No data leaves the browser.

   Binary format reference: DDP 2.00 spec (DCA), cross-checked against the
   GPL ddpLib (Suntrip Records). CD-DA image data is 16-bit signed,
   little-endian, 44100 Hz, stereo, interleaved — i.e. WAV PCM byte order.
   ========================================================================== */
(function () {
  "use strict";

  // ---- localization (driven by <html lang>) -------------------------------
  var I18N = {
    en: {
      reading: "Reading files…", noFiles: "No files found.", building: "Building waveform…",
      readingDropped: "Reading dropped items…",
      noImage: "Couldn't find the audio image (.DAT). Make sure the whole DDP fileset is selected.",
      readError: "Could not read this DDP: ", audioError: "Audio playback error. The image may be incomplete.",
      zipUnsupported: "This browser cannot decompress ZIP files. Please unzip first.",
      zipInvalid: "Not a valid ZIP archive.",
      cFormat: "Format", cTracks: "Tracks", cTotal: "Total", cUpc: "UPC/EAN", cCdText: "CD-Text",
      yes: "Yes", cPQ: "PQ", notFound: "Not found", trackWord: "Track", play: "Play", pause: "Pause",
      pqHeading: "KNURL MASTERING — DDP PQ SHEET", pqGenerated: "Generated ",
      pqTitle: "Title", pqPerformer: "Performer", pqUpc: "UPC/EAN", pqFormat: "Format", pqTotal: "Total",
      pqTr: "TR", pqStart: "START", pqDur: "DURATION", pqIsrc: "ISRC", pqTrackTitle: "TITLE"
    },
    pt: {
      reading: "A ler ficheiros…", noFiles: "Nenhum ficheiro encontrado.", building: "A construir a forma de onda…",
      readingDropped: "A ler itens largados…",
      noImage: "Não foi encontrada a imagem de áudio (.DAT). Verifique que todo o conjunto DDP foi selecionado.",
      readError: "Não foi possível ler este DDP: ", audioError: "Erro de reprodução. A imagem pode estar incompleta.",
      zipUnsupported: "Este navegador não consegue descomprimir ficheiros ZIP. Descomprima primeiro.",
      zipInvalid: "Arquivo ZIP inválido.",
      cFormat: "Formato", cTracks: "Faixas", cTotal: "Total", cUpc: "UPC/EAN", cCdText: "CD-Text",
      yes: "Sim", cPQ: "PQ", notFound: "Ausente", trackWord: "Faixa", play: "Reproduzir", pause: "Pausa",
      pqHeading: "KNURL MASTERING — FOLHA PQ DDP", pqGenerated: "Gerado a ",
      pqTitle: "Título", pqPerformer: "Intérprete", pqUpc: "UPC/EAN", pqFormat: "Formato", pqTotal: "Total",
      pqTr: "FX", pqStart: "INÍCIO", pqDur: "DURAÇÃO", pqIsrc: "ISRC", pqTrackTitle: "TÍTULO"
    }
  };
  var T = I18N[(document.documentElement.lang || "en").slice(0, 2)] || I18N.en;
  var reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  var SAMPLE_RATE = 44100;
  var CHANNELS = 2;
  var BYTES_PER_SAMPLE = 2;
  var BYTES_PER_FRAME = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE; // 176400 bytes per second
  var SECTOR_BYTES = 2352; // CD-DA sector = 588 stereo samples

  // ---- small DOM helpers ---------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  // ---- ASCII / binary reading ---------------------------------------------
  function ascii(bytes, off, len) {
    var s = "";
    for (var i = 0; i < len; i++) {
      var c = bytes[off + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.replace(/\s+$/g, "").replace(/^\s+/g, "");
  }
  function asciiInt(bytes, off, len) {
    var s = ascii(bytes, off, len);
    if (s === "") return null;
    var n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  }
  function matches(bytes, off, str) {
    for (var i = 0; i < str.length; i++) {
      if (bytes[off + i] !== str.charCodeAt(i)) return false;
    }
    return true;
  }

  // ---- time helpers --------------------------------------------------------
  function msfToSeconds(h, m, s, f) {
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0) + (f || 0) / 75;
  }
  function fmtTime(sec) {
    if (sec == null || isNaN(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function fmtMSF(sec) {
    if (sec == null || isNaN(sec) || sec < 0) sec = 0;
    var totalFrames = Math.round(sec * 75);
    var m = Math.floor(totalFrames / (75 * 60));
    var s = Math.floor((totalFrames / 75) % 60);
    var f = totalFrames % 75;
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return pad(m) + ":" + pad(s) + ":" + pad(f);
  }

  /* ========================================================================
     ZIP reader (central directory + DecompressionStream for deflate)
     ======================================================================== */
  function findEOCD(view, bytes) {
    var max = Math.max(0, bytes.length - 22 - 65535);
    for (var i = bytes.length - 22; i >= max; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error(T.zipUnsupported);
    }
    var ds = new DecompressionStream("deflate-raw");
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZip(file) {
    var buf = new Uint8Array(await file.arrayBuffer());
    var view = new DataView(buf.buffer);
    var eocd = findEOCD(view, buf);
    if (eocd < 0) throw new Error(T.zipInvalid);
    var count = view.getUint16(eocd + 10, true);
    var cdOffset = view.getUint32(eocd + 16, true);
    var out = [];
    var p = cdOffset;
    for (var n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      var method = view.getUint16(p + 10, true);
      var compSize = view.getUint32(p + 20, true);
      var nameLen = view.getUint16(p + 28, true);
      var extraLen = view.getUint16(p + 30, true);
      var commentLen = view.getUint16(p + 32, true);
      var localOff = view.getUint32(p + 42, true);
      var name = ascii(buf, p + 46, nameLen);
      // jump to local header to find the true data start
      var lhNameLen = view.getUint16(localOff + 26, true);
      var lhExtraLen = view.getUint16(localOff + 28, true);
      var dataStart = localOff + 30 + lhNameLen + lhExtraLen;
      var comp = buf.subarray(dataStart, dataStart + compSize);
      if (!/\/$/.test(name)) {
        var data = method === 0 ? comp.slice() : await inflateRaw(comp);
        var base = name.split("/").pop();
        out.push(new File([data], base));
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  /* ========================================================================
     File ingestion: folder picker, file picker, drag & drop, zip
     ======================================================================== */
  async function entryToFiles(entry, out) {
    if (entry.isFile) {
      await new Promise(function (res) {
        entry.file(function (f) { out.push(f); res(); }, function () { res(); });
      });
    } else if (entry.isDirectory) {
      var reader = entry.createReader();
      await new Promise(function (res) {
        var readBatch = function () {
          reader.readEntries(async function (entries) {
            if (!entries.length) { res(); return; }
            for (var i = 0; i < entries.length; i++) await entryToFiles(entries[i], out);
            readBatch();
          }, function () { res(); });
        };
        readBatch();
      });
    }
  }

  async function gatherFromDataTransfer(dt) {
    var out = [];
    var items = dt.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      var entries = [];
      for (var i = 0; i < items.length; i++) {
        var e = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
        if (e) entries.push(e);
      }
      for (var j = 0; j < entries.length; j++) await entryToFiles(entries[j], out);
    }
    if (!out.length && dt.files) {
      for (var k = 0; k < dt.files.length; k++) out.push(dt.files[k]);
    }
    return out;
  }

  // Expand any .zip files into their contents
  async function expandZips(files) {
    var out = [];
    for (var i = 0; i < files.length; i++) {
      if (/\.zip$/i.test(files[i].name)) {
        try {
          var inner = await readZip(files[i]);
          for (var j = 0; j < inner.length; j++) out.push(inner[j]);
        } catch (e) { console.warn("zip", e); }
      } else {
        out.push(files[i]);
      }
    }
    return out;
  }

  /* ========================================================================
     DDP descriptor parsing
     ======================================================================== */
  function parseDDPID(bytes) {
    var id = {};
    id.level = ascii(bytes, 0, 8) || null;            // "DDP 2.00"
    id.upcEan = ascii(bytes, 8, 13) || null;
    id.masterId = ascii(bytes, 38, 48) || null;
    id.discType = ascii(bytes, 87, 2) || null;        // "CD"
    var utLen = asciiInt(bytes, 93, 2);
    if (utLen) id.userText = ascii(bytes, 95, utLen) || null;
    return id;
  }

  // 128-byte map packets, each starting "VVVM"
  function parseMapStream(bytes) {
    var packets = [];
    var pos = 0;
    while (pos + 4 <= bytes.length) {
      if (!matches(bytes, pos, "VVVM")) {
        // try to resync to the next VVVM
        var next = indexOfMarker(bytes, "VVVM", pos + 1);
        if (next < 0) break;
        pos = next;
        continue;
      }
      var p = {
        typeId: ascii(bytes, pos + 4, 2),
        dataStreamLength: asciiInt(bytes, pos + 14, 8),
        sourceStorageMode: asciiInt(bytes, pos + 40, 1),
        trackNumber: ascii(bytes, pos + 55, 2),
        indexNumber: asciiInt(bytes, pos + 57, 2),
        isrc: ascii(bytes, pos + 59, 12) || null,
        fileName: ascii(bytes, pos + 74, 17) || null
      };
      packets.push(p);
      pos += 128;
    }
    return packets;
  }

  function indexOfMarker(bytes, str, from) {
    for (var i = from; i + str.length <= bytes.length; i++) {
      if (matches(bytes, i, str)) return i;
    }
    return -1;
  }

  // 64-byte PQ descriptor packets, each starting "VVVS"
  function parsePQStream(bytes) {
    var packets = [];
    var pos = 0;
    while (pos + 4 <= bytes.length) {
      if (!matches(bytes, pos, "VVVS")) {
        var next = indexOfMarker(bytes, "VVVS", pos + 1);
        if (next < 0) break;
        pos = next;
        continue;
      }
      var p = {
        trackNumber: ascii(bytes, pos + 4, 2),
        indexNumber: asciiInt(bytes, pos + 6, 2),
        h: asciiInt(bytes, pos + 8, 2),
        m: asciiInt(bytes, pos + 10, 2),
        s: asciiInt(bytes, pos + 12, 2),
        f: asciiInt(bytes, pos + 14, 2),
        control1: ascii(bytes, pos + 16, 2),
        isrc: ascii(bytes, pos + 20, 12) || null,
        upcEan: ascii(bytes, pos + 32, 13) || null
      };
      packets.push(p);
      pos += 64;
    }
    return packets;
  }

  /* ========================================================================
     CD-TEXT parsing (18-byte lead-in packs)
     ======================================================================== */
  var CDT_TYPE = { 0x80: "title", 0x81: "performer", 0x82: "songwriter", 0x83: "composer", 0x84: "arranger", 0x85: "message" };

  function parseCDText(bytes) {
    var start = 0;
    if (bytes.length % 18 === 4 && (bytes.length - 4) % 18 === 0) start = 4; // size header
    var fields = {}; // type -> array of byte arrays per pack (block 0)
    for (var p = start; p + 18 <= bytes.length; p += 18) {
      var type = bytes[p];
      if (!CDT_TYPE[type]) continue;
      var trackBase = bytes[p + 1] & 0x7f;
      var blockPos = bytes[p + 3];
      var block = (blockPos & 0x70) >> 4;
      if (block !== 0) continue; // only the first (typically English) block
      var key = CDT_TYPE[type];
      if (!fields[key]) fields[key] = { base: trackBase, bytes: [] };
      for (var d = 0; d < 12; d++) fields[key].bytes.push(bytes[p + 4 + d]);
    }
    var result = {}; // key -> { trackNumber: text }
    Object.keys(fields).forEach(function (key) {
      var arr = fields[key].bytes;
      var base = fields[key].base;
      var segments = [];
      var cur = [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] === 0) { segments.push(cur); cur = []; }
        else cur.push(arr[i]);
      }
      // trailing without terminator (rare)
      if (cur.length) segments.push(cur);
      var map = {};
      var prev = "";
      for (var sidx = 0; sidx < segments.length; sidx++) {
        var seg = segments[sidx];
        var text;
        if (seg.length === 1 && seg[0] === 0x09) text = prev; // TAB = repeat previous
        else text = decodeLatin1(seg);
        // ignore the synthetic trailing empty segment after the final 0x00
        if (sidx === segments.length - 1 && text === "" && arr[arr.length - 1] === 0) continue;
        map[base + sidx] = text;
        prev = text;
      }
      result[key] = map;
    });
    return result;
  }

  function decodeLatin1(arr) {
    var s = "";
    for (var i = 0; i < arr.length; i++) if (arr[i] !== 0) s += String.fromCharCode(arr[i]);
    return s.trim();
  }

  /* ========================================================================
     Assemble the disc model from descriptors + image
     ======================================================================== */
  function buildModel(parsed, imageFile) {
    var imageBytes = imageFile ? imageFile.size : 0;
    var imageDuration = imageBytes / BYTES_PER_FRAME;

    var pq = parsed.pq || [];
    var cdt = parsed.cdtext || {};
    var tracks = [];
    var leadOutSec = null;
    var t0 = null;

    // index PQ entries by track
    var byTrack = {};
    pq.forEach(function (e) {
      var tn = e.trackNumber;
      if (tn === "AA") {
        leadOutSec = msfToSeconds(e.h, e.m, e.s, e.f);
        return;
      }
      var num = parseInt(tn, 10);
      if (isNaN(num) || num === 0) return; // skip lead-in / invalid
      if (!byTrack[num]) byTrack[num] = {};
      byTrack[num][e.indexNumber == null ? 1 : e.indexNumber] = e;
    });

    var nums = Object.keys(byTrack).map(Number).sort(function (a, b) { return a - b; });
    nums.forEach(function (num) {
      var entries = byTrack[num];
      var startEntry = entries[1] || entries[0] || entries[Object.keys(entries)[0]];
      var pregapEntry = entries[0];
      var startAbs = msfToSeconds(startEntry.h, startEntry.m, startEntry.s, startEntry.f);
      var pregapAbs = pregapEntry ? msfToSeconds(pregapEntry.h, pregapEntry.m, pregapEntry.s, pregapEntry.f) : startAbs;
      tracks.push({
        num: num,
        startAbs: startAbs,
        pregapAbs: pregapAbs,
        isrc: startEntry.isrc || null,
        title: (cdt.title && cdt.title[num]) || null,
        performer: (cdt.performer && cdt.performer[num]) || null
      });
    });

    if (!tracks.length) {
      // no usable PQ — present the whole image as one track
      tracks.push({ num: 1, startAbs: 0, pregapAbs: 0, isrc: null,
        title: (cdt.title && cdt.title[1]) || null,
        performer: (cdt.performer && cdt.performer[1]) || null });
      leadOutSec = imageDuration;
    }

    t0 = tracks[0].startAbs;
    var total = imageDuration > 0 ? imageDuration : (leadOutSec != null ? leadOutSec - t0 : 0);

    tracks.forEach(function (tk, i) {
      tk.start = Math.max(0, tk.startAbs - t0);
      tk.pregap = Math.max(0, tk.startAbs - tk.pregapAbs);
      var nextStart = (i + 1 < tracks.length) ? (tracks[i + 1].startAbs - t0) : total;
      tk.end = Math.max(tk.start, nextStart);
      tk.duration = tk.end - tk.start;
      tk.index = i;
    });

    return {
      tracks: tracks,
      total: total,
      imageFile: imageFile,
      imageDuration: imageDuration,
      upcEan: (parsed.id && parsed.id.upcEan) ||
        (pq[0] && pq[0].upcEan) ||
        (parsed.map && firstMapUpc(parsed.map)) || null,
      level: (parsed.id && parsed.id.level) || (parsed.levelGuess || null),
      discTitle: (cdt.title && cdt.title[0]) || (parsed.id && parsed.id.userText) || null,
      discPerformer: (cdt.performer && cdt.performer[0]) || null,
      masterId: (parsed.id && parsed.id.masterId) || null,
      hasCdText: !!(cdt.title || cdt.performer),
      hasPQ: pq.length > 0
    };
  }

  function firstMapUpc() { return null; }

  /* ========================================================================
     Locate the audio image among the provided files
     ======================================================================== */
  function pickImageFile(files, fileMap, map) {
    // 1. filenames referenced by main-data map packets (type starts with "D")
    if (map) {
      var candidates = map.filter(function (p) { return p.typeId && p.typeId.charAt(0) === "D" && p.fileName; });
      // prefer D0 (program), then longest
      candidates.sort(function (a, b) {
        var ad = a.typeId === "D0" ? 1 : 0, bd = b.typeId === "D0" ? 1 : 0;
        if (ad !== bd) return bd - ad;
        return (b.dataStreamLength || 0) - (a.dataStreamLength || 0);
      });
      for (var i = 0; i < candidates.length; i++) {
        var f = fileMap[candidates[i].fileName.toUpperCase()];
        if (f) return f;
      }
    }
    // 2. fall back to the largest non-descriptor file
    var descr = /^(DDPID|DDPMS|PQDESCR|CDTEXT\.BIN|.*\.TXT|.*\.XML|.*\.LOG|.*\.PDF|.*\.CUE)$/i;
    var best = null;
    files.forEach(function (f) {
      if (descr.test(f.name)) return;
      if (!best || f.size > best.size) best = f;
    });
    return best;
  }

  function findCdTextFile(files, fileMap, map) {
    if (map) {
      for (var i = 0; i < map.length; i++) {
        if (map[i].typeId && map[i].typeId.charAt(0) === "T" && map[i].fileName) {
          var f = fileMap[map[i].fileName.toUpperCase()];
          if (f) return f;
        }
      }
    }
    return fileMap["CDTEXT.BIN"] || null;
  }

  async function readBytes(file) {
    return new Uint8Array(await file.arrayBuffer());
  }

  /* ========================================================================
     Overview waveform — sparse peak sampling (constant cost, any file size)
     ======================================================================== */
  async function computePeaks(file, buckets) {
    var peaks = new Float32Array(buckets);
    var size = file.size;
    var win = 4096; // bytes sampled per bucket
    for (var b = 0; b < buckets; b++) {
      var center = Math.floor((b + 0.5) / buckets * size);
      var off = Math.max(0, Math.min(size - win, center - (win >> 1)));
      off = off - (off % 4); // align to a stereo sample frame
      var slice = new Int16Array(await file.slice(off, off + win).arrayBuffer());
      var max = 0;
      for (var i = 0; i < slice.length; i++) {
        var v = slice[i] < 0 ? -slice[i] : slice[i];
        if (v > max) max = v;
      }
      peaks[b] = max / 32768;
    }
    return peaks;
  }

  /* ========================================================================
     Player UI
     ======================================================================== */
  var state = {
    model: null,
    peaks: null,
    audioURL: null,
    currentTrack: 0,
    audio: null
  };

  function makeWav(file) {
    var dataLen = file.size;
    var header = new ArrayBuffer(44);
    var v = new DataView(header);
    var byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
    var blockAlign = CHANNELS * BYTES_PER_SAMPLE;
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, CHANNELS, true);
    v.setUint32(24, SAMPLE_RATE, true); v.setUint32(28, byteRate, true);
    v.setUint16(32, blockAlign, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, dataLen, true);
    return new Blob([header, file], { type: "audio/wav" });
  }

  function setStatus(msg, isError) {
    var s = $("ddp-status");
    s.textContent = msg || "";
    s.classList.toggle("error", !!isError);
    s.style.display = msg ? "block" : "none";
  }

  async function handleFiles(rawFiles) {
    try {
      setStatus(T.reading);
      var files = await expandZips(Array.prototype.slice.call(rawFiles));
      if (!files.length) { setStatus(T.noFiles, true); return; }

      var fileMap = {};
      files.forEach(function (f) { fileMap[f.name.toUpperCase()] = f; });

      var parsed = { id: null, map: null, pq: null, cdtext: null };

      if (fileMap["DDPID"]) {
        parsed.id = parseDDPID(await readBytes(fileMap["DDPID"]));
      }
      if (fileMap["DDPMS"]) {
        parsed.map = parseMapStream(await readBytes(fileMap["DDPMS"]));
      }
      if (fileMap["PQDESCR"]) {
        parsed.pq = parsePQStream(await readBytes(fileMap["PQDESCR"]));
      }

      var cdtFile = findCdTextFile(files, fileMap, parsed.map);
      if (cdtFile) {
        try { parsed.cdtext = parseCDText(await readBytes(cdtFile)); }
        catch (e) { console.warn("cdtext", e); }
      }

      var imageFile = pickImageFile(files, fileMap, parsed.map);
      if (!imageFile) {
        setStatus(T.noImage, true);
        return;
      }
      if (!parsed.level && parsed.pq) parsed.levelGuess = "DDP";

      var model = buildModel(parsed, imageFile);
      state.model = model;
      state.currentTrack = 0;

      setStatus(T.building);
      var peaks = await computePeaks(imageFile, 1400);
      state.peaks = peaks;

      // audio element from in-place WAV wrapper (no full read into memory)
      if (state.audioURL) URL.revokeObjectURL(state.audioURL);
      state.audioURL = URL.createObjectURL(makeWav(imageFile));
      var audio = state.audio || new Audio();
      audio.src = state.audioURL;
      audio.preload = "auto";
      state.audio = audio;
      wireAudio(audio);

      setStatus("");
      renderPlayer(model);
    } catch (err) {
      console.error(err);
      setStatus(T.readError + (err && err.message ? err.message : err), true);
    }
  }

  function wireAudio(audio) {
    audio.ontimeupdate = onTimeUpdate;
    audio.onplay = function () { updatePlayButton(true); };
    audio.onpause = function () { updatePlayButton(false); };
    audio.onended = function () { updatePlayButton(false); };
    audio.onerror = function () { setStatus(T.audioError, true); };
  }

  // ---- rendering -----------------------------------------------------------
  function renderPlayer(model) {
    $("ddp-dropzone").classList.add("loaded");
    $("ddp-player").hidden = false;

    var title = model.discTitle || (model.masterId) || "Untitled DDP";
    $("ddp-disc-title").textContent = title;
    $("ddp-disc-perf").textContent = model.discPerformer || "";
    $("ddp-disc-perf").style.display = model.discPerformer ? "" : "none";

    // meta chips
    var meta = $("ddp-meta");
    meta.innerHTML = "";
    var chips = [];
    if (model.level) chips.push([T.cFormat, model.level]);
    chips.push([T.cTracks, String(model.tracks.length)]);
    chips.push([T.cTotal, fmtMSF(model.total)]);
    if (model.upcEan) chips.push([T.cUpc, model.upcEan]);
    if (model.hasCdText) chips.push([T.cCdText, T.yes]);
    if (!model.hasPQ) chips.push([T.cPQ, T.notFound]);
    chips.forEach(function (c) {
      var chip = el("span", "ddp-chip");
      chip.appendChild(el("span", "k", c[0]));
      chip.appendChild(el("span", "v", c[1]));
      meta.appendChild(chip);
    });

    drawWaveform();
    renderTrackList(model);
    updateTransport();
    selectTrack(0, false);
    startAnimate();
  }

  function renderTrackList(model) {
    var tbody = $("ddp-tracklist");
    tbody.innerHTML = "";
    model.tracks.forEach(function (tk) {
      var tr = el("tr", "ddp-track");
      tr.dataset.index = tk.index;
      var num = el("td", "t-num", String(tk.num).padStart(2, "0"));
      var info = el("td", "t-info");
      var tt = el("div", "t-title", tk.title || (T.trackWord + " " + tk.num));
      info.appendChild(tt);
      if (tk.performer) info.appendChild(el("div", "t-perf", tk.performer));
      if (tk.isrc) {
        var isrc = el("div", "t-isrc", tk.isrc);
        info.appendChild(isrc);
      }
      var start = el("td", "t-start", fmtMSF(tk.start));
      var dur = el("td", "t-dur", fmtTime(tk.duration));
      tr.appendChild(num); tr.appendChild(info); tr.appendChild(start); tr.appendChild(dur);
      tr.addEventListener("click", function () { selectTrack(tk.index, true); });
      tbody.appendChild(tr);
    });
  }

  function trackAt(time) {
    var tks = state.model.tracks;
    for (var i = tks.length - 1; i >= 0; i--) {
      if (time + 1e-3 >= tks[i].start) return i;
    }
    return 0;
  }

  function selectTrack(index, play) {
    var model = state.model;
    if (!model) return;
    index = Math.max(0, Math.min(model.tracks.length - 1, index));
    state.currentTrack = index;
    var rows = $("ddp-tracklist").children;
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("active", i === index);
    if (state.audio) {
      state.audio.currentTime = model.tracks[index].start;
      if (play) state.audio.play();
    }
    updateNowPlaying();
    drawWaveform();
  }

  function updateNowPlaying() {
    var model = state.model;
    var tk = model.tracks[state.currentTrack];
    $("ddp-np-title").textContent = tk.title || (T.trackWord + " " + tk.num);
    $("ddp-np-sub").textContent = tk.performer || model.discPerformer || model.discTitle || "";
  }

  // ---- transport -----------------------------------------------------------
  function togglePlay() {
    if (!state.audio) return;
    if (state.audio.paused) state.audio.play();
    else state.audio.pause();
  }
  function updatePlayButton(playing) {
    $("ddp-play").classList.toggle("playing", playing);
    $("ddp-play").setAttribute("aria-label", playing ? T.pause : T.play);
  }
  function prevTrack() {
    var t = state.audio ? state.audio.currentTime : 0;
    var tk = state.model.tracks[state.currentTrack];
    // if more than 2s in, restart current; else go to previous
    if (t - tk.start > 2) selectTrack(state.currentTrack, !state.audio.paused);
    else selectTrack(state.currentTrack - 1, !state.audio.paused);
  }
  function nextTrack() {
    selectTrack(state.currentTrack + 1, state.audio && !state.audio.paused);
  }

  function onTimeUpdate() {
    var t = state.audio.currentTime;
    var idx = trackAt(t);
    if (idx !== state.currentTrack) {
      state.currentTrack = idx;
      var rows = $("ddp-tracklist").children;
      for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("active", i === idx);
      updateNowPlaying();
    }
    updateTransport();
  }

  function updateTransport() {
    var model = state.model;
    if (!model) return;
    var t = state.audio ? state.audio.currentTime : 0;
    $("ddp-cur").textContent = fmtMSF(t);
    $("ddp-tot").textContent = fmtMSF(model.total);
  }

  // ---- waveform canvas -----------------------------------------------------
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function drawWaveform() {
    var canvas = $("ddp-wave");
    var peaks = state.peaks;
    var model = state.model;
    if (!canvas || !peaks || !model) return;
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.floor(rect.width));
    var h = Math.max(1, Math.floor(rect.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var gold = "#EDA40E";
    var played = getComputedStyle(canvas).getPropertyValue("color").trim() || gold;
    var unplayed = cssVar("--wave-bg") || "#cfcfcf";
    var mid = h / 2;
    var n = peaks.length;
    var progress = state.audio ? (state.audio.currentTime / (model.total || 1)) : 0;
    var px = Math.floor(progress * w);

    for (var x = 0; x < w; x++) {
      var bi = Math.floor(x / w * n);
      var amp = Math.pow(peaks[bi] || 0, 0.7); // perceptual lift
      var bar = Math.max(1, amp * (h * 0.92));
      ctx.fillStyle = x <= px ? gold : unplayed;
      ctx.fillRect(x, mid - bar / 2, 1, bar);
    }

    // track boundary ticks
    ctx.fillStyle = cssVar("--wave-tick") || "rgba(120,120,120,0.55)";
    model.tracks.forEach(function (tk, i) {
      if (i === 0) return;
      var tx = Math.floor(tk.start / (model.total || 1) * w);
      ctx.fillRect(tx, 0, 1, h);
    });

    // blinking playhead showing the current playback position
    var blink = 1;
    if (!reducedMotion) blink = (Date.now() % 1100 < 620) ? 1 : 0.16;
    ctx.globalAlpha = blink;
    ctx.fillStyle = cssVar("--playhead") || "#181818";
    ctx.fillRect(Math.max(0, Math.min(w - 2, px - 1)), 0, 2, h);
    ctx.globalAlpha = 1;
  }

  // Continuous loop while a disc is loaded: redraws every frame during
  // playback, and twice a second when paused so the playhead keeps blinking.
  var lastPhase = -1;
  var animating = false;
  function animate() {
    if (!state.model) { animating = false; return; }
    var playing = state.audio && !state.audio.paused;
    var phase = reducedMotion ? 0 : (Date.now() % 1100 < 620 ? 1 : 0);
    if (playing || phase !== lastPhase) { lastPhase = phase; drawWaveform(); }
    requestAnimationFrame(animate);
  }
  function startAnimate() { if (!animating) { animating = true; requestAnimationFrame(animate); } }

  function seekFromEvent(e) {
    var canvas = $("ddp-wave");
    var rect = canvas.getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    var frac = Math.max(0, Math.min(1, x / rect.width));
    if (state.audio && state.model) {
      state.audio.currentTime = frac * state.model.total;
      drawWaveform();
    }
  }

  /* ========================================================================
     PQ sheet export
     ======================================================================== */
  function downloadPQSheet() {
    var model = state.model;
    if (!model) return;
    var lines = [];
    lines.push(T.pqHeading);
    lines.push(T.pqGenerated + new Date().toISOString().slice(0, 10));
    lines.push("");
    if (model.discTitle) lines.push((T.pqTitle + ":").padEnd(11) + model.discTitle);
    if (model.discPerformer) lines.push((T.pqPerformer + ":").padEnd(11) + model.discPerformer);
    if (model.upcEan) lines.push((T.pqUpc + ":").padEnd(11) + model.upcEan);
    if (model.level) lines.push((T.pqFormat + ":").padEnd(11) + model.level);
    lines.push((T.pqTotal + ":").padEnd(11) + fmtMSF(model.total));
    lines.push("");
    lines.push(T.pqTr.padEnd(4) + T.pqStart.padEnd(13) + T.pqDur.padEnd(11) + T.pqIsrc.padEnd(14) + T.pqTrackTitle);
    lines.push("--  -----------  ---------  ------------  -----------------------------");
    model.tracks.forEach(function (tk) {
      lines.push(
        String(tk.num).padStart(2, "0") + "  " +
        fmtMSF(tk.start).padEnd(11) + "  " +
        fmtMSF(tk.duration).padEnd(9) + "  " +
        (tk.isrc || "—").padEnd(12) + "  " +
        (tk.title || (T.trackWord + " " + tk.num))
      );
    });
    var blob = new Blob([lines.join("\n")], { type: "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (model.discTitle ? model.discTitle.replace(/[^\w\-]+/g, "_") : "ddp") + "_PQ.txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function reset() {
    if (state.audio) { state.audio.pause(); }
    if (state.audioURL) URL.revokeObjectURL(state.audioURL);
    state.model = null; state.peaks = null; state.audioURL = null; state.currentTrack = 0;
    $("ddp-player").hidden = true;
    $("ddp-dropzone").classList.remove("loaded");
    setStatus("");
  }

  /* ========================================================================
     Wire up the page
     ======================================================================== */
  function init() {
    var dz = $("ddp-dropzone");

    $("ddp-folder-input").addEventListener("change", function (e) {
      if (e.target.files.length) handleFiles(e.target.files);
      e.target.value = "";
    });
    $("ddp-file-input").addEventListener("change", function (e) {
      if (e.target.files.length) handleFiles(e.target.files);
      e.target.value = "";
    });

    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("dragover"); });
    });
    dz.addEventListener("drop", async function (e) {
      e.preventDefault();
      setStatus(T.readingDropped);
      var files = await gatherFromDataTransfer(e.dataTransfer);
      handleFiles(files);
    });

    $("ddp-play").addEventListener("click", togglePlay);
    $("ddp-prev").addEventListener("click", prevTrack);
    $("ddp-next").addEventListener("click", nextTrack);
    $("ddp-reset").addEventListener("click", reset);
    $("ddp-export").addEventListener("click", downloadPQSheet);

    var vol = $("ddp-vol");
    vol.addEventListener("input", function () { if (state.audio) state.audio.volume = parseFloat(vol.value); });

    var wave = $("ddp-wave");
    var dragging = false;
    wave.addEventListener("mousedown", function (e) { dragging = true; seekFromEvent(e); });
    window.addEventListener("mousemove", function (e) { if (dragging) seekFromEvent(e); });
    window.addEventListener("mouseup", function () { dragging = false; });
    wave.addEventListener("touchstart", function (e) { seekFromEvent(e); }, { passive: true });
    wave.addEventListener("touchmove", function (e) { seekFromEvent(e); }, { passive: true });

    window.addEventListener("resize", function () { if (state.model) drawWaveform(); });

    document.addEventListener("keydown", function (e) {
      if (!state.model) return;
      if (e.target.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.code === "ArrowRight") nextTrack();
      else if (e.code === "ArrowLeft") prevTrack();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
