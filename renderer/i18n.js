const en = {
  'app.title': 'Torrgether',
  'app.eyebrow': 'Torrgether 0.3.0',
  'app.heading': 'Torrgether',
  'app.subtitle': 'Synchronized legal torrent playback with MPV and RAM-only streaming.',
  'labels.language': 'UI language',
  'labels.audioLanguage': 'Audio language',
  'nav.home': 'Home',
  'nav.movies': 'Movies',
  'nav.series': 'Series',
  'nav.anime': 'Anime',
  'nav.favorites': 'Favorites',
  'nav.history': 'History',
  'nav.downloads': 'Downloads',
  'nav.settings': 'Settings',
  'nav.categories': 'Categories',
  'search.placeholder': 'Search legal movies, public-domain video...',
  'updates.available': 'Update {version} is available.',
  'updates.none': 'You are on the latest version.',
  'updates.error': 'Could not check updates: {error}',
  'updates.open': 'Open release',
  'updates.dismiss': 'Dismiss',
  'status.offline': 'offline',
  'status.online': 'online ({id})',
  'status.badUrl': 'bad signaling URL',
  'status.offlineReason': 'offline: {reason}',
  'status.connectError': 'error: {message}',
  'status.role': 'role:',
  'status.seq': 'seq:',
  'status.host': 'host',
  'status.viewer': 'viewer',
  'status.onlineWord': 'online',
  'status.offlineWord': 'offline',
  'status.ready': 'ready',
  'status.loadingTorrent': 'loading',
  'mpv.ready': 'mpv: ready',
  'mpv.missing': 'mpv: missing',
  'mpv.checking': 'mpv: checking',
  'mpv.required': 'MPV is required',
  'mpv.notStarted': 'not started',
  'mpv.notRunning': 'not running',
  'mpv.starting': 'starting...',
  'mpv.stopped': 'stopped',
  'mpv.playing': 'playing',
  'mpv.paused': 'paused',
  'room.title': 'Room',
  'room.subtitle': 'The first participant becomes host.',
  'room.signalingUrl': 'Signaling URL',
  'room.serverToken': 'Server token',
  'room.optional': 'optional',
  'room.room': 'Room',
  'room.name': 'Name',
  'room.defaultName': 'Viewer',
  'buttons.join': 'Join',
  'buttons.chooseTorrent': 'Choose .torrent',
  'buttons.load': 'Load',
  'buttons.restartMpv': 'Restart MPV',
  'buttons.stopMpv': 'Stop MPV',
  'buttons.playPause': 'Play / Pause',
  'buttons.showLog': 'Show log',
  'buttons.openLogs': 'Open logs',
  'buttons.choosing': 'Choosing...',
  'buttons.loading': 'Loading...',
  'buttons.opening': 'Opening...',
  'buttons.stopping': 'Stopping...',
  'buttons.rutrackerOpen': 'Open RuTracker',
  'buttons.rutrackerClose': 'Hide',
  'buttons.rutrackerBack': 'Back',
  'buttons.rutrackerForward': 'Forward',
  'buttons.rutrackerReload': 'Reload',
  'buttons.search': 'Search',
  'buttons.watch': 'Watch',
  'buttons.import': 'Import',
  'buttons.favorite': 'Favorite',
  'sources.title': 'Sources',
  'sources.subtitle': 'Manual import, RuTracker, and open-license catalogs.',
  'sources.manual': 'Manual',
  'sources.rutracker': 'RuTracker',
  'sources.catalog': 'Catalog',
  'sources.hostControl': 'Host Control',
  'sources.hostSubtitle': 'Choose a torrent and video file for the room.',
  'sources.magnetPlaceholder': 'or paste magnet URI',
  'sources.videoInside': 'Video inside torrent',
  'sources.results': 'Results',
  'sources.noResults': 'No source results yet.',
  'sources.languageFallback': 'No {language} audio results were found. Showing other languages.',
  'sources.importFailed': 'Could not import source: {error}',
  'sources.duplicates': '{count} variants',
  'rutracker.subtitle': 'Open the isolated RuTracker panel and import a magnet or .torrent into RAM.',
  'rutracker.placeholder': 'RuTracker opens here.',
  'rutracker.ready': 'RuTracker panel ready',
  'rutracker.hidden': 'RuTracker hidden',
  'rutracker.importing': 'Importing from RuTracker...',
  'rutracker.importedMagnet': 'RuTracker magnet imported.',
  'rutracker.importedTorrent': 'RuTracker .torrent imported.',
  'rutracker.error': 'RuTracker error: {error}',
  'stream.title': 'Stream',
  'stream.subtitle': 'Peers, progress, and RAM cache pressure.',
  'stream.peers': 'Peers',
  'stream.speed': 'Speed',
  'stream.time': 'Time',
  'stream.file': 'File',
  'stream.ramCache': 'RAM cache',
  'stream.evictions': 'Evictions',
  'stream.refetch': 'Refetch',
  'stream.pending': 'Pending',
  'stream.cachePressure': 'Pressure',
  'stream.pressureLow': 'low',
  'stream.pressureWatch': 'watch',
  'stream.pressureHigh': 'high',
  'stream.peerCount': '{count} peers',
  'stream.speedText': 'down {down} / up {up}',
  'stream.mpvCacheEmpty': 'MPV cache: -',
  'stream.cacheSummary': 'RAM {used} / {max}, chunks: {chunks}, recent: {recent}, piece: {piece}, {mpv}',
  'stream.overLimit': ', over: {over}',
  'stream.lowMpvBuffer': ', low MPV buffer',
  'stream.starved': 'Cache starvation detected',
  'participants.title': 'Participants',
  'participants.subtitle': 'Readiness for current torrent.',
  'player.kicker': 'Now playing',
  'player.noVideo': 'No video selected',
  'player.chooseHint': 'Choose a catalog result, .torrent, or magnet.',
  'player.mpvMissingHint': 'MPV is required before playback.',
  'player.selectedVideo': 'Selected video',
  'player.selectedHint': 'Selected {name}. MPV reads the local RAM-backed stream.',
  'player.title': 'Player',
  'player.subtitle': 'MPV IPC syncs playback with the room.',
  'catalog.popular': 'Popular',
  'catalog.continue': 'Continue watching',
  'catalog.new': 'New',
  'catalog.torrents': 'Torrents',
  'catalog.info': 'Information',
  'catalog.quality': 'Quality',
  'catalog.size': 'Size',
  'catalog.seeders': 'Seeders',
  'catalog.leechers': 'Leechers',
  'catalog.language': 'Language',
  'catalog.provider': 'Provider',
  'controls.title': 'MPV Controls',
  'controls.subtitle': 'Seek and pause commands sync to the room.',
  'controls.back': '-10 sec',
  'controls.forward': '+10 sec',
  'diagnostics.title': 'Diagnostics',
  'diagnostics.summary': 'MPV diagnostics',
  'diagnostics.log': 'Log:',
  'diagnostics.memory': 'current session memory',
  'events.title': 'Events',
  'events.subtitle': 'Warnings, reconnects, and sync actions.',
  'log.logsAt': 'Logs are written to: {path}',
  'log.configFailed': 'Could not read client config: {error}',
  'log.mpvMissing': 'MPV was not found. Rerun the installer or install mpv and add it to PATH.',
  'log.mpvPreflightFailed': 'MPV preflight failed: {error}',
  'log.actionFailed': 'Action failed: {error}',
  'log.mpvLogFailed': 'Could not read MPV log: {error}',
  'log.latestMpvStderr': 'Latest MPV stderr: {stderr}',
  'log.reportReadyFailed': 'Could not report torrent readiness: {error}',
  'log.chooseTorrentFirst': 'Choose a torrent/video first.',
  'log.mpvDidNotStart': 'MPV did not start: {error}. Check diagnostics.',
  'log.mpvStarted': 'MPV started ({reason}).',
  'log.loadingTorrent': 'Loading torrent into RAM: {name}',
  'log.torrentError': 'Torrent error: {error}',
  'log.readyForStreaming': 'Ready for RAM streaming: {name}',
  'log.joinedRoom': 'Joined room {room}',
  'log.joinFailed': 'Join failed: {error}',
  'log.connectionLost': 'Connection lost: {reason}. The client will reconnect.',
  'log.signalingError': 'Signaling connection error: {message}',
  'log.badSignalingUrl': 'Bad signaling URL: {message}',
  'log.hostOnly': 'Only the host can choose a torrent.',
  'log.validMagnet': 'Paste a valid magnet URI.',
  'log.serverRejected': 'Server rejected torrent: {error}',
  'log.torrentSent': 'Torrent was sent to the room. The stream is RAM-backed.',
  'log.controlFailed': 'Could not send control: {error}',
  'log.mpvNotRunning': 'MPV is not running.',
  'log.openTorrentFailed': 'Could not open .torrent: {error}',
  'log.invalidFileIndex': 'Invalid file index.',
  'log.openLogsFailed': 'Could not open logs folder: {error}',
  'log.heartbeatFailed': 'Could not send heartbeat: {error}',
  'log.statusFailed': 'Could not update torrent status: {error}',
  'log.mpvStopped': 'MPV stopped: {error}',
  'log.mpvStatusFailed': 'Could not update MPV status: {error}',
  'log.torrentWarning': 'Torrent warning/error: {message}'
}

function complete(overrides) {
  return { ...en, ...overrides }
}

const ru = complete({
  'labels.language': 'Язык интерфейса',
  'labels.audioLanguage': 'Язык озвучки',
  'nav.home': 'Главная',
  'nav.movies': 'Фильмы',
  'nav.series': 'Сериалы',
  'nav.anime': 'Аниме',
  'nav.favorites': 'Избранное',
  'nav.history': 'История',
  'nav.downloads': 'Загрузки',
  'nav.settings': 'Настройки',
  'search.placeholder': 'Поиск фильмов, сериалов, аниме...',
  'status.offline': 'офлайн',
  'status.online': 'онлайн ({id})',
  'status.host': 'хост',
  'status.viewer': 'зритель',
  'room.title': 'Комната',
  'buttons.join': 'Войти',
  'buttons.watch': 'Смотреть',
  'buttons.import': 'Импорт',
  'sources.title': 'Источники',
  'sources.noResults': 'Пока нет результатов.',
  'sources.languageFallback': 'На языке {language} ничего не найдено. Показываю другие языки.',
  'stream.title': 'Поток',
  'participants.title': 'Участники',
  'player.noVideo': 'Видео не выбрано',
  'catalog.popular': 'Популярное',
  'catalog.continue': 'Продолжить просмотр',
  'catalog.new': 'Новинки',
  'catalog.torrents': 'Торренты',
  'catalog.info': 'Информация',
  'events.title': 'События'
})

const uk = complete({ 'labels.language': 'Мова інтерфейсу', 'labels.audioLanguage': 'Мова озвучення', 'nav.home': 'Головна', 'nav.movies': 'Фільми', 'buttons.watch': 'Дивитись', 'catalog.torrents': 'Торенти' })
const zhCN = complete({ 'labels.language': '界面语言', 'labels.audioLanguage': '音频语言', 'nav.home': '主页', 'nav.movies': '电影', 'buttons.watch': '观看', 'catalog.torrents': '种子' })
const ja = complete({ 'labels.language': '表示言語', 'labels.audioLanguage': '音声言語', 'nav.home': 'ホーム', 'nav.movies': '映画', 'buttons.watch': '見る', 'catalog.torrents': 'トレント' })
const ko = complete({ 'labels.language': 'UI 언어', 'labels.audioLanguage': '오디오 언어', 'nav.home': '홈', 'nav.movies': '영화', 'buttons.watch': '보기', 'catalog.torrents': '토렌트' })
const es = complete({ 'labels.language': 'Idioma de interfaz', 'labels.audioLanguage': 'Idioma de audio', 'nav.home': 'Inicio', 'nav.movies': 'Películas', 'buttons.watch': 'Ver', 'catalog.torrents': 'Torrents' })
const ptBR = complete({ 'labels.language': 'Idioma da interface', 'labels.audioLanguage': 'Idioma do áudio', 'nav.home': 'Início', 'nav.movies': 'Filmes', 'buttons.watch': 'Assistir', 'catalog.torrents': 'Torrents' })
const fr = complete({ 'labels.language': 'Langue de l’interface', 'labels.audioLanguage': 'Langue audio', 'nav.home': 'Accueil', 'nav.movies': 'Films', 'buttons.watch': 'Regarder', 'catalog.torrents': 'Torrents' })
const de = complete({ 'labels.language': 'Oberflächensprache', 'labels.audioLanguage': 'Audiosprache', 'nav.home': 'Start', 'nav.movies': 'Filme', 'buttons.watch': 'Ansehen', 'catalog.torrents': 'Torrents' })
const it = complete({ 'labels.language': 'Lingua interfaccia', 'labels.audioLanguage': 'Lingua audio', 'nav.home': 'Home', 'nav.movies': 'Film', 'buttons.watch': 'Guarda', 'catalog.torrents': 'Torrent' })
const pl = complete({ 'labels.language': 'Język interfejsu', 'labels.audioLanguage': 'Język audio', 'nav.home': 'Start', 'nav.movies': 'Filmy', 'buttons.watch': 'Oglądaj', 'catalog.torrents': 'Torrenty' })
const tr = complete({ 'labels.language': 'Arayüz dili', 'labels.audioLanguage': 'Ses dili', 'nav.home': 'Ana sayfa', 'nav.movies': 'Filmler', 'buttons.watch': 'İzle', 'catalog.torrents': 'Torrentler' })
const ar = complete({ 'labels.language': 'لغة الواجهة', 'labels.audioLanguage': 'لغة الصوت', 'nav.home': 'الرئيسية', 'nav.movies': 'أفلام', 'buttons.watch': 'مشاهدة', 'catalog.torrents': 'تورنت' })
const hi = complete({ 'labels.language': 'इंटरफ़ेस भाषा', 'labels.audioLanguage': 'ऑडियो भाषा', 'nav.home': 'होम', 'nav.movies': 'फ़िल्में', 'buttons.watch': 'देखें', 'catalog.torrents': 'टोरेंट' })
const id = complete({ 'labels.language': 'Bahasa UI', 'labels.audioLanguage': 'Bahasa audio', 'nav.home': 'Beranda', 'nav.movies': 'Film', 'buttons.watch': 'Tonton', 'catalog.torrents': 'Torrent' })
const vi = complete({ 'labels.language': 'Ngôn ngữ giao diện', 'labels.audioLanguage': 'Ngôn ngữ âm thanh', 'nav.home': 'Trang chủ', 'nav.movies': 'Phim', 'buttons.watch': 'Xem', 'catalog.torrents': 'Torrent' })

export const locales = {
  en,
  ru,
  uk,
  'zh-CN': zhCN,
  ja,
  ko,
  es,
  'pt-BR': ptBR,
  fr,
  de,
  it,
  pl,
  tr,
  ar,
  hi,
  id,
  vi
}

export const localeNames = {
  en: 'English',
  ru: 'Русский',
  uk: 'Українська',
  'zh-CN': '简体中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pl: 'Polski',
  tr: 'Türkçe',
  ar: 'العربية',
  hi: 'हिन्दी',
  id: 'Bahasa Indonesia',
  vi: 'Tiếng Việt'
}

const localeAliases = [
  ['pt-br', 'pt-BR'],
  ['zh', 'zh-CN'],
  ['ru', 'ru'],
  ['uk', 'uk'],
  ['ja', 'ja'],
  ['ko', 'ko'],
  ['es', 'es'],
  ['fr', 'fr'],
  ['de', 'de'],
  ['it', 'it'],
  ['pl', 'pl'],
  ['tr', 'tr'],
  ['ar', 'ar'],
  ['hi', 'hi'],
  ['id', 'id'],
  ['vi', 'vi']
]

export function supportedLocales() {
  return Object.keys(locales)
}

export function normalizeLocale(locale) {
  const raw = String(locale || '').trim()
  if (locales[raw]) return raw
  const lower = raw.toLowerCase()
  const match = localeAliases.find(([prefix]) => lower === prefix || lower.startsWith(`${prefix}-`))
  return match?.[1] || 'en'
}

export function resolveInitialLocale({ storedLocale, systemLocale } = {}) {
  return storedLocale && locales[storedLocale] ? storedLocale : normalizeLocale(systemLocale)
}

export function interpolate(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_match, key) => {
    const value = params[key]
    return value == null ? '' : String(value)
  })
}

export function translate(locale, key, params = {}) {
  const dictionary = locales[locale] || locales.en
  return interpolate(dictionary[key] || locales.en[key] || key, params)
}

export function applyTranslations(root, locale) {
  if (!root) return
  root.documentElement?.setAttribute('lang', locale)
  root.documentElement?.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = translate(locale, el.dataset.i18n)
  })
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', translate(locale, el.dataset.i18nPlaceholder))
  })
  root.querySelectorAll('[data-i18n-value]').forEach(el => {
    if (!el.dataset.userEdited) el.value = translate(locale, el.dataset.i18nValue)
  })
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', translate(locale, el.dataset.i18nTitle))
  })
  root.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    el.setAttribute('aria-label', translate(locale, el.dataset.i18nAriaLabel))
  })
}
