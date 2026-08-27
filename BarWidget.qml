import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Air raid alert status for selected regions of Ukraine.
//
// Deliberately passive: no notification, no sound. People here already have
// phone apps and the actual street sirens; what a desktop can usefully add is
// an always-visible answer to "is it on right now, and for how long".
//
// All network access lives in scripts/fetch-alerts, which promises one line of
// JSON and never a non-zero exit, so nothing here has to branch on an exit
// code inside a binding.
BarWidget {
  id: root
  moduleName: "io.github.dfrost90.air-alert"

  readonly property string script: Quickshell.env("HOME")
    + "/.config/omarchy/plugins/" + moduleName + "/scripts/fetch-alerts"

  readonly property string stateFile: Quickshell.env("HOME")
    + "/.local/state/omarchy/settings/air-alert.json"

  // Sanitized because WidgetButton's internal Text uses AutoText, which would
  // rich-text-parse a crafted settings value.
  readonly property string icon: Model.plain(setting("icon", "󰀦"), 8)

  readonly property int pollSeconds: Math.max(5, setting("pollSeconds", 15))
  // Staleness has to outlast at least a couple of missed ticks, or a single
  // dropped request would flip the pill to unknown on a flaky connection.
  readonly property int staleAfterSeconds:
    Math.max(pollSeconds * 2, setting("staleAfterSeconds", 60))

  // shell.json wins over the picker's state file; see Model.resolveRegions.
  property var shellRegions: setting("regions", [])
  property var stateRegions: []
  readonly property var regions: Model.resolveRegions(shellRegions, stateRegions)

  property double lastOkFetch: 0
  property string lastActionIndex: ""
  property string lastError: ""
  property int consecutiveFailures: 0

  // Advanced by clockTimer so the elapsed time re-renders between polls.
  property double tick: Date.now()

  // liveRegions once a fetch has landed, the configured list before that.
  // Assigned rather than bound: Model.resolveRegions returns a fresh array on
  // every evaluation, so a binding here re-triggers itself forever.
  property var activeRegions: []

  // Derived state is assigned, not bound. Model.aggregate and resolveRegions
  // both return fresh objects on every call, and the pill label feeds the
  // layout that sizes this widget; leaving either as a binding closes a loop
  // QML then reports every frame. Everything below is recomputed explicitly
  // from the few places that can actually change it.
  property var agg: ({ status: "unconfigured", stale: false, primary: null })
  property string pillLabel: ""

  function recompute() {
    agg = Model.aggregate(activeRegions, lastOkFetch, tick, staleAfterSeconds)
    pillLabel = Model.plain(Model.pillText(agg, regions.length, tick), 48)
  }

  onTickChanged: recompute()
  Component.onCompleted: { activeRegions = regions; recompute() }

  readonly property color stateColor:
    agg.status === "alert" ? Color.urgent
      : agg.status === "clear" ? (bar ? bar.barForeground : Color.foreground)
      : Color.muted

  // Merge fetched alert state onto the configured list by id, so a configured
  // label is never overwritten by whatever the network said.
  function applyRegions(fetched) {
    var byId = {}
    for (var i = 0; i < fetched.length; i++) byId[fetched[i].id] = fetched[i]
    var next = []
    for (var j = 0; j < regions.length; j++) {
      var mine = regions[j]
      var got = byId[mine.id]
      next.push({
        id: mine.id,
        name: mine.name || (got ? got.name : ""),
        type: mine.type,
        label: mine.label,
        alerts: got ? got.alerts : mine.alerts
      })
    }
    liveRegions = next
    activeRegions = next
    recompute()
  }

  // regions is derived from config; liveRegions carries the fetched alerts.
  property var liveRegions: []

  function poll() {
    if (!regions.length || pollProc.running) return
    var args = [root.script]
    if (lastActionIndex !== "") {
      args.push("--since")
      args.push(lastActionIndex)
    }
    for (var i = 0; i < regions.length; i++) args.push(regions[i].id)
    pollProc.command = args
    pollProc.running = true
  }

  function refresh() {
    // Drop the gate so a manual refresh always re-reads the regions.
    lastActionIndex = ""
    poll()
  }

  Process {
    id: pollProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        // StdioCollector exposes no ceiling of its own. parsePayload refuses an
        // oversized body too, but bounding here keeps the retained string small
        // even when the script it runs has stopped behaving.
        var raw = String(this.text || "")
        if (raw.length > Model.MAX_PAYLOAD_BYTES) {
          root.lastError = "response too large"
          return
        }
        var p = Model.parsePayload(raw)
        if (!p.ok) {
          // Keep the last known regions. Staleness is measured from the last
          // successful fetch, so a persistently failing poll ages into
          // unknown rather than masquerading as fresh.
          root.lastError = p.error
          root.consecutiveFailures = root.consecutiveFailures + 1
          return
        }
        root.lastError = ""
        root.consecutiveFailures = 0
        if (p.lastActionIndex !== "") root.lastActionIndex = p.lastActionIndex
        // An unchanged reply is a successful confirmation that nothing moved,
        // not an absence of data — so it advances lastOkFetch.
        root.lastOkFetch = Date.now()
        root.tick = Date.now()
        root.recompute()
        if (p.unchanged) return
        root.applyRegions(p.regions)
      }
    }
  }

  // What the picker saved. Watched rather than read once so a save re-resolves
  // the region list without a shell restart.
  FileView {
    id: stateView
    path: root.stateFile
    watchChanges: true
    // Absent until the picker saves for the first time; that is not an error.
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.readState()
    onLoadFailed: root.stateRegions = []
  }

  function readState() {
    try {
      var parsed = JSON.parse(stateView.text())
      stateRegions = (parsed && parsed.regions) ? parsed.regions : []
    } catch (e) {
      stateRegions = []
    }
  }

  onRegionsChanged: {
    // A changed region list invalidates both the gate and the fetched alerts.
    lastActionIndex = ""
    liveRegions = []
    activeRegions = regions
    lastOkFetch = 0
    recompute()
    poll()
  }

  Timer {
    id: pollTimer
    // Widens on consecutive failures so a rate-limited or down upstream is
    // not polled at full speed for hours.
    interval: Model.pollInterval(root.pollSeconds, root.consecutiveFailures) * 1000
    running: root.regions.length > 0
    repeat: true
    triggeredOnStart: true
    onTriggered: root.poll()
  }

  // Only advances the clock so elapsed times keep counting between polls.
  Timer {
    id: clockTimer
    interval: 30000
    running: root.regions.length > 0
    repeat: true
    onTriggered: root.tick = Date.now()
  }

  // --- panel plumbing -------------------------------------------------------

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  function togglePanel() {
    if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
  }

  // Shape contract for shell.summon/hide/toggle routing: Bar.findPanelWidget
  // requires open/close/opened on the bar-widget root.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item && panelLoader.item.openFromHotkey) panelLoader.item.openFromHotkey()
  }

  function close() {
    if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
  }

  readonly property bool popoutSwitchClosing:
    panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "io.github.dfrost90.air-alert"

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function refresh(): void { root.refresh() }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    // The glyph and label are drawn separately below so a longer label cannot
    // shift the glyph; the button only supplies the interaction surface.
    text: " "
    fixedWidth: labelRow.implicitWidth + horizontalMargin * 2
    foreground: "transparent"
    tooltipText: root.tooltip

    onPressed: function (b) {
      if (b === Qt.MiddleButton) root.refresh()
      else root.togglePanel()
    }
  }

  readonly property string tooltip: {
    if (agg.status === "unconfigured") return "Air alert: no region selected"
    var lines = []
    var rs = activeRegions
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i]
      if (r.alerts && r.alerts.length) {
        lines.push(Model.plain(r.label) + ": "
          + Model.plain(Model.alertAbbrev(r.alerts[0].type), 32)
          + " " + Model.formatElapsed(r.alerts[0].since, tick))
      } else {
        lines.push(Model.plain(r.label) + ": clear")
      }
    }
    if (agg.stale) {
      var age = lastOkFetch > 0
        ? Math.floor((tick - lastOkFetch) / 1000) + "s ago"
        : "never"
      lines.push("last update: " + age)
    }
    if (lastError !== "") lines.push(Model.plain(lastError))
    return Model.plain(lines.join("\n"), 1024)
  }

  Row {
    id: labelRow
    anchors.left: button.left
    anchors.leftMargin: button.horizontalMargin
    anchors.verticalCenter: button.verticalCenter
    spacing: root.pillLabel === "" ? 0 : Style.space(8)

    Text {
      text: root.icon
      textFormat: Text.PlainText
      color: root.stateColor
      font.family: button.fontFamily
      font.pixelSize: button.fontSize
      renderType: Text.NativeRendering
      anchors.verticalCenter: parent.verticalCenter
    }

    Text {
      visible: root.pillLabel !== "" && !root.vertical
      text: root.pillLabel
      textFormat: Text.PlainText
      color: root.stateColor
      font.family: button.fontFamily
      font.pixelSize: button.fontSize
      renderType: Text.NativeRendering
      anchors.verticalCenter: parent.verticalCenter
    }
  }
}
