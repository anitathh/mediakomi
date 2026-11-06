/* Медиакоми — игра «Угадай цену квартиры» */
(function () {
  "use strict";

  var ROUNDS = 10;

  // ===== Утилиты =====
  function $(id) { return document.getElementById(id); }
  function fmt(n) { return n.toLocaleString("ru-RU") + " ₽"; }
  function plural(p) {
    var m10 = p % 10, m100 = p % 100;
    if (m10 === 1 && m100 !== 11) return "балл";
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "балла";
    return "баллов";
  }
  function fmtShort(n) {
    if (n >= 1000000) {
      var m = n / 1000000;
      return (m % 1 ? m.toFixed(1) : m) + " млн";
    }
    return Math.round(n / 1000) + " тыс.";
  }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ===== Балльная система =====
  // Точность: 0 отклонения = 100 баллов, отклонение ≥ 100% = 0 баллов.
  function roundPoints(guess, real) {
    var err = Math.abs(guess - real) / real;
    return Math.max(0, Math.round(100 * (1 - err)));
  }
  function pointsLabel(p) {
    if (p >= 90) return "Глаз — алмаз";
    if (p >= 70) return "Хороший глазомер";
    if (p >= 40) return "Есть куда расти";
    return "Совсем мимо";
  }

  // Смешная подпись по направлению и величине ошибки
  function funnyVerdict(guess, real, points) {
    var err = (guess - real) / real; // <0 занизил, >0 завысил
    if (points >= 100) return "В яблочко! 🎯";
    if (points >= 90) {
      return err < 0 ? "Глаз — алмаз, но жадничаешь 😏" : "Глаз — алмаз, но переплатил бы 😏";
    }
    if (err < 0) {
      if (Math.abs(err) < 0.3) return "Жадина-говядина 🐄";
      if (Math.abs(err) < 0.6) return "Хотел халявы? Телефон продавца не дождётся 📞🙂";
      return "Это Коми, а не барахолка 🙃";
    }
    if (err < 0.3) return "Размахнул кошелёк 💸";
    if (err < 0.6) return "Богатенький Буратино 🤑";
    return "Олигарх зашёл без охраны 👑";
  }

  // ===== Типаж игрока =====
  // Среднее относительное отклонение оценки от реальной цены:
  //  ≤ -10% — занижал (жадный студент), ≥ +10% — завышал (транжира), иначе — адекватный квартирант.
  function playerType(results) {
    var bias = results.reduce(function (s, r) { return s + (r.guess - r.real) / r.real; }, 0) / results.length;
    if (bias <= -0.10) {
      return {
        emoji: "🧑‍🎓",
        type: "Жадный студент",
        desc: "Вы стабильно называли цену ниже реальной. Квартиры в Коми дешевле, чем вы думали, — но продавцы так не считают!",
        bias: bias
      };
    }
    if (bias >= 0.10) {
      return {
        emoji: "💸",
        type: "Транжира",
        desc: "Вы систематически завышали цену. Возможно, вы привыкли к ценам большого города — в Коми всё скромнее.",
        bias: bias
      };
    }
    return {
      emoji: "🤝",
      type: "Адекватный квартирант",
      desc: "Ваши оценки почти совпали с реальными ценами. Чувство рынка вас не подводит!",
      bias: bias
    };
  }

  // ===== Состояние =====
  var state = {
    deck: [],        // 10 лотов на игру
    round: 0,        // текущий раунд (0-based)
    total: 0,        // накопленные баллы
    results: [],     // {guess, real, points}
    lastPoints: 0
  };

  // ===== Экраны =====
  function showScreen(id) {
    ["screen-start", "screen-game", "screen-result", "screen-final"].forEach(function (s) {
      $(s).classList.toggle("hidden", s !== id);
    });
    window.scrollTo(0, 0);
  }

  // ===== Прогресс-бар =====
  function updateProgress(pctOverride) {
    var pct = typeof pctOverride === "number"
      ? Math.round(pctOverride * 100)
      : Math.round((state.round / ROUNDS) * 100);
    var chip = state.total + " б.";
    $("progress-fill").style.width = $("progress-fill2").style.width = pct + "%";
    $("round-num").textContent = $("round-num2").textContent = Math.min(state.round + 1, ROUNDS);
    $("score-chip").textContent = $("score-chip2").textContent = chip;
  }

  // ===== Галерея (многоразовая: игровой экран и экран результата) =====
  var galleryTimer = null;

  function buildGallery(galId, navId, prevId, nextId, photos) {
    var gal = $(galId);
    var nav = $(navId);
    gal.innerHTML = "";
    nav.innerHTML = "";

    photos.forEach(function (src, i) {
      var img = document.createElement("img");
      img.src = src;
      img.alt = "Фотография квартиры " + (i + 1);
      img.loading = i === 0 ? "eager" : "lazy";
      img.decoding = "async";
      img.draggable = false;
      img.onerror = function () { img.style.display = "none"; };
      gal.appendChild(img);

      var dot = document.createElement("span");
      dot.className = "gallery-dot" + (i === 0 ? " gallery-dot--active" : "");
      dot.addEventListener("click", function () {
        gal.scrollTo({ left: i * gal.clientWidth, behavior: "smooth" });
      });
      nav.appendChild(dot);
    });

    var curIdx = 0; // отслеживаем индекс сами: scrollLeft во время анимации врёт

    function activeIdx() {
      return Math.round(gal.scrollLeft / Math.max(1, gal.clientWidth));
    }
    function paintDots() {
      var dots = nav.children;
      for (var k = 0; k < dots.length; k++) {
        dots[k].classList.toggle("gallery-dot--active", k === curIdx);
      }
    }
    function slide(dir) {
      curIdx = Math.min(photos.length - 1, Math.max(0, curIdx + dir));
      gal.scrollTo({ left: curIdx * gal.clientWidth, behavior: "smooth" });
      paintDots();
    }

    gal.scrollLeft = 0;
    gal.onscroll = function () {
      if (galleryTimer) return;
      galleryTimer = setTimeout(function () {
        galleryTimer = null;
        curIdx = activeIdx(); // свайп/прокрутка руками — доверяем scrollLeft
        paintDots();
      }, 80);
    };
    $(prevId).onclick = function () { slide(-1); };
    $(nextId).onclick = function () { slide(1); };
  }

  // ===== Бегунок =====
  function initSlider(deck) {
    var min = Math.floor(deck.reduce(function (m, l) { return Math.min(m, l.price); }, Infinity) / 50000) * 50000;
    var max = Math.ceil(deck.reduce(function (m, l) { return Math.max(m, l.price); }, -Infinity) / 100000) * 100000;
    min = Math.max(50000, min - 50000);
    max = Math.min(5000000, max + 100000);

    var slider = $("price-slider");
    slider.min = min;
    slider.max = max;
    slider.step = 5000;
    slider.value = Math.round((min + max) / 2 / 5000) * 5000;

    $("slider-min").textContent = fmtShort(min);
    $("slider-max").textContent = fmtShort(max);
    paintSlider();
  }

  function paintSlider() {
    var slider = $("price-slider");
    var min = +slider.min, max = +slider.max, val = +slider.value;
    var pct = ((val - min) / (max - min)) * 100;
    slider.style.setProperty("--fill", pct + "%");
    $("guess-value").textContent = fmt(val);
  }

  // ===== Раунд =====
  function showRound() {
    var lot = state.deck[state.round];
    updateProgress();
    buildGallery("gallery", "gallery-nav", "gal-prev", "gal-next", lot.photos);
    $("flat-desc").textContent = lot.desc || "Квартира в Республике Коми";
    $("flat-street").textContent = lot.street ? "📍 " + lot.street : "";
    initSlider(state.deck);
    showScreen("screen-game");
  }

  function answer() {
    var lot = state.deck[state.round];
    var guess = +$("price-slider").value;
    var points = roundPoints(guess, lot.price);
    state.lastPoints = points;
    state.total += points;
    state.results.push({ guess: guess, real: lot.price, points: points });

    updateProgress((state.round + 1) / ROUNDS);
    $("result-verdict-round").textContent = funnyVerdict(guess, lot.price, points);
    $("result-subtitle").textContent = pointsLabel(points) + " · +" + points + " " + plural(points);
    buildGallery("gallery2", "gallery2-nav", "gal2-prev", "gal2-next", lot.photos);
    $("result-guess").textContent = fmt(guess);
    $("result-real").textContent = fmt(lot.price);

    var diff = guess - lot.price;
    var diffEl = $("result-diff");
    if (diff === 0) {
      diffEl.textContent = "точно!";
      diffEl.style.color = "var(--good)";
    } else {
      var pctDiff = Math.round(Math.abs(diff) / lot.price * 100);
      diffEl.textContent = (diff > 0 ? "+" : "−") + Math.abs(diff).toLocaleString("ru-RU") + " ₽ (" + pctDiff + "%)";
      diffEl.style.color = diff > 0 ? "var(--bad)" : "var(--accent)";
    }
    $("result-points").textContent = "+" + points;

    var link = $("result-link");
    link.href = lot.url;
    link.style.display = "";

    $("btn-next").textContent = state.round + 1 >= ROUNDS ? "Итоги игры" : "Следующая квартира";
    showScreen("screen-result");
  }

  function next() {
    state.round++;
    if (state.round >= ROUNDS) { finish(); } else { showRound(); }
  }

  // ===== Итоги =====
  function finish() {
    $("final-points").textContent = state.total;
    var t = playerType(state.results);
    $("final-emoji").textContent = t.emoji;
    $("final-type").textContent = t.type;
    $("final-desc").textContent = t.desc;

    var avgPoints = Math.round(state.total / ROUNDS);
    var best = state.results.reduce(function (m, r) { return Math.max(m, r.points); }, 0);
    var stats = $("final-stats");
    stats.innerHTML =
      statRow("Средний балл за квартиру", avgPoints) +
      statRow("Лучший раунд", best) +
      statRow("Ваше среднее отклонение", (t.bias > 0 ? "+" : "−") + Math.round(Math.abs(t.bias) * 100) + "%") +
      statRow("Реальный средний чек", fmt(Math.round(state.results.reduce(function (s, r) { return s + r.real; }, 0) / ROUNDS)));

    updateProgress();
    showScreen("screen-final");
  }

  function statRow(label, value) {
    return '<div class="final-stat"><span>' + label + "</span><b>" + value + "</b></div>";
  }

  // ===== Старт =====
  function startGame() {
    state.deck = shuffle(LISTINGS.slice()).slice(0, ROUNDS);
    state.round = 0;
    state.total = 0;
    state.results = [];
    showRound();
  }

  $("btn-start").addEventListener("click", startGame);
  $("btn-answer").addEventListener("click", answer);
  $("btn-next").addEventListener("click", next);
  $("btn-again").addEventListener("click", startGame);
  $("price-slider").addEventListener("input", paintSlider);

  updateProgress();

  // отладочный доступ (используется автотестами)
  window.__MK_DEBUG = { state: state, startGame: startGame };
})();
