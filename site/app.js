/* PNDS 池谱 site shell. The page is staged as the App: an outer
   rail (brand + links) and a floating app window. Inside, the three
   content sections are stacked in one scroll; the sidebar cards
   track the scroll position (scroll-spy), and clicking a card
   scrolls to its section. Language switching drives the same
   .l-zh / .l-en pairs everywhere, including inside the SVGs. */

var ROUTES = ['structure', 'anatomy', 'network']
var DEFAULT_ROUTE = 'structure'
var LANG_KEY = 'pnds-site-lang'

var TITLES = {
  structure: {
    zh: '什么是 PNDS 演奏系统',
    en: 'What is the PNDS Performance System',
  },
  anatomy: {
    zh: '从 Template 开始',
    en: 'Start from the Template',
  },
  network: {
    zh: '一场 PNDS 演出的技术框架',
    en: 'The Technology Behind a PNDS Performance',
  },
}

var navEl = document.getElementById('site-nav')
var contentEl = document.getElementById('content')
var pillEl = navEl.querySelector('.nav-pill')
var cards = Array.prototype.slice.call(navEl.querySelectorAll('.nav-card'))
var sections = Array.prototype.slice.call(document.querySelectorAll('.view'))
var welcomePage = document.getElementById('page-welcome')
var langSeg = document.querySelector('.lang-seg')
var langThumb = langSeg.querySelector('.lang-thumb')
var langBtns = Array.prototype.slice.call(langSeg.querySelectorAll('.lang-btn'))

function currentLang() {
  return document.documentElement.lang === 'en' ? 'en' : 'zh'
}

function getRoute() {
  var hash = location.hash.replace(/^#\/?/, '')
  return ROUTES.indexOf(hash) !== -1 ? hash : DEFAULT_ROUTE
}

function setTitle(route, lang) {
  var base = lang === 'zh' ? 'PNDS 池谱' : 'PNDS'
  document.title = base + ' · ' + TITLES[route][lang]
}

/* The pill is absolutely positioned at the sidebar's top padding;
   each card slides it to its own offsetTop/height (the App's
   sliding selection pill, minus the imperative drag machinery). */
function movePill(route) {
  var card = cards.filter(function (c) {
    return c.getAttribute('data-route') === route
  })[0]
  if (!card) return
  var navTop = parseFloat(window.getComputedStyle(navEl).paddingTop || '0', 10)
  pillEl.style.height = card.offsetHeight + 'px'
  pillEl.style.transform = 'translateY(' + (card.offsetTop - navTop) + 'px)'
}

function setActive(route, updateHash) {
  cards.forEach(function (card) {
    var active = card.getAttribute('data-route') === route
    card.classList.toggle('is-active', active)
    if (active) {
      card.setAttribute('aria-current', 'true')
    } else {
      card.removeAttribute('aria-current')
    }
  })
  movePill(route)
  setTitle(route, currentLang())
  if (updateHash && location.hash !== '#/' + route) {
    history.replaceState(null, '', '#/' + route)
  }
}

function routeTarget(route) {
  var section = document.getElementById('view-' + route)
  return section ? Math.max(0, section.offsetTop - 2) : null
}

function scrollToRoute(route, smooth) {
  if (routeTarget(route) === null) return
  autoScrolling = smooth
  scrollAlignPending = route
  contentEl.scrollTo({
    top: routeTarget(route),
    behavior: smooth ? 'smooth' : 'auto',
  })
  /* While the smooth scroll is in flight the spy follows the
     position (card + pill) but must not rewrite the URL — the
     destination hash is already set. scrollend lands in every
     modern engine; the timeout is the safety net. */
  if (smooth) {
    clearTimeout(autoScrollTimer)
    autoScrollTimer = setTimeout(function () {
      autoScrolling = false
    }, 1600)
  }
}

/* Scroll-spy: a section owns the card once its top passes a third
   of the viewport; the page bottom always belongs to the last one. */
var autoScrolling = false
var autoScrollTimer = null
var scrollAlignPending = null
contentEl.addEventListener('scrollend', function () {
  autoScrolling = false
  clearTimeout(autoScrollTimer)
  /* The welcome→work transition resizes the window mid-flight, so
     the section a smooth scroll aimed at may have drifted; land
     exactly once the flight is over. */
  if (scrollAlignPending) {
    var target = routeTarget(scrollAlignPending)
    scrollAlignPending = null
    if (target !== null && Math.abs(contentEl.scrollTop - target) > 8) {
      contentEl.scrollTo({ top: target, behavior: 'auto' })
    }
  }
})
var spyPending = false
contentEl.addEventListener('scroll', function () {
  if (spyPending) return
  spyPending = true
  requestAnimationFrame(function () {
    spyPending = false
    var top = contentEl.scrollTop
    var height = contentEl.clientHeight
    /* The welcome page owns the opening: while its top half fills
       the viewport the shell stays in the at-welcome staging (rail
       collapsed, window centered and large, sidebar asleep). */
    if (welcomePage && top < welcomePage.offsetHeight * 0.5) {
      document.documentElement.classList.add('at-welcome')
      cards.forEach(function (card) {
        card.classList.remove('is-active')
        card.removeAttribute('aria-current')
      })
      document.title = currentLang() === 'zh' ? 'PNDS 池谱' : 'PNDS'
      return
    }
    document.documentElement.classList.remove('at-welcome')
    if (top + height >= contentEl.scrollHeight - 64) {
      setActive(ROUTES[ROUTES.length - 1], !autoScrolling)
      return
    }
    var current = DEFAULT_ROUTE
    sections.forEach(function (section) {
      if (section.offsetTop <= top + height * 0.35) {
        current = section.getAttribute('data-route')
      }
    })
    setActive(current, !autoScrolling)
  })
})

window.addEventListener('hashchange', function () {
  var route = getRoute()
  setActive(route, false)
  scrollToRoute(route, true)
})

function applyLang(lang) {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* private mode etc. — the choice just won't persist */
  }
  langBtns.forEach(function (btn) {
    btn.classList.toggle('is-active', btn.getAttribute('data-lang') === lang)
    btn.setAttribute(
      'aria-pressed',
      btn.getAttribute('data-lang') === lang ? 'true' : 'false'
    )
  })
  langThumb.style.transform =
    lang === 'en' ? 'translateX(100%)' : 'translateX(0)'
  setTitle(getRoute(), lang)
  /* Card heights can change with the language (titles re-wrap). */
  movePill(getRoute())
}

langBtns.forEach(function (btn) {
  btn.addEventListener('click', function () {
    applyLang(btn.getAttribute('data-lang'))
  })
})

window.addEventListener('resize', function () {
  movePill(getRoute())
})

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(function () {
    movePill(getRoute())
  })
}

/* Diagram category highlight: legend swatches and node cards share
   the same fill vocabulary, so hovering either lights every card of
   that category and quiets the rest — the legend, made live. */
function clearFilter(svg) {
  svg.classList.remove('dg-filtering')
  Array.prototype.forEach.call(svg.querySelectorAll('.dg-match'), function (r) {
    r.classList.remove('dg-match')
  })
}

Array.prototype.forEach.call(
  document.querySelectorAll('svg.diagram'),
  function (svg) {
    svg.addEventListener('mouseover', function (e) {
      var t = e.target
      if (!(t.classList && t.classList.contains('node-hit'))) {
        clearFilter(svg)
        return
      }
      var fill = t.getAttribute('fill')
      var any = false
      Array.prototype.forEach.call(
        svg.querySelectorAll('.node-hit'),
        function (r) {
          var match = r.getAttribute('fill') === fill
          r.classList.toggle('dg-match', match)
          any = any || match
        }
      )
      svg.classList.toggle('dg-filtering', any)
    })
    svg.addEventListener('mouseleave', function () {
      clearFilter(svg)
    })
  }
)

/* A reload always reopens the welcome page — the chapter hash it
   may carry was the scroll-spy's bookkeeping, not a navigation
   (the head script applies the same rule before first paint). */
function loadIsReload() {
  var entry =
    performance.getEntriesByType &&
    performance.getEntriesByType('navigation')[0]
  return !!(entry && entry.type === 'reload')
}

applyLang(currentLang())
if (location.hash && !loadIsReload()) {
  setActive(getRoute(), false)
  scrollToRoute(getRoute(), false)
  /* Webfonts and history scroll restoration both shift section
     offsets after load — realign once the layout has settled. */
  var alignTimer = setTimeout(function () {
    scrollToRoute(getRoute(), false)
  }, 900)
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      clearTimeout(alignTimer)
      scrollToRoute(getRoute(), false)
    })
  }
} else {
  /* Refresh must land on the welcome page. The engine restores the
     inner scroller's old position around the load event even with
     history.scrollRestoration = 'manual', so zero it again at every
     post-restoration beat; the scroll-spy then re-stages the
     welcome state on its own. */
  var landWelcome = function () {
    contentEl.scrollTop = 0
  }
  landWelcome()
  requestAnimationFrame(landWelcome)
  window.addEventListener('pageshow', landWelcome)
  setTimeout(landWelcome, 350)
  /* A reload that carried a chapter hash drops it, so the URL
     matches the welcome page it now shows. */
  if (location.hash) {
    history.replaceState(null, '', location.pathname + location.search)
  }
  document.title = currentLang() === 'zh' ? 'PNDS 池谱' : 'PNDS'
}
