import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Popout for the air-alert widget: current status per watched region, recent
// alert history, and the region picker.
Panel {
  id: root
  moduleName: "io.github.dfrost90.air-alert"
  ipcTarget: "io.github.dfrost90.air-alert"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null

  // The bar tracks the widget mounted in its slot, not this nested panel, so
  // everything the bar identifies a panel by must be that widget.
  readonly property var barIdentity: hostWidget || root

  readonly property color fg: bar ? bar.barForeground : Color.foreground
  readonly property string fontFam: Style.font.family

  readonly property var regions: hostWidget ? hostWidget.activeRegions : []
  readonly property var configured: hostWidget ? hostWidget.regions : []
  readonly property string script: hostWidget ? hostWidget.script : ""

  function open() {
    root.controller.show()
    root.refresh()
  }

  function openFromHotkey() {
    root.controller.show()
    root.refresh()
  }

  function close() { root.controller.hide() }
  function toggle() { root.opened ? root.close() : root.openFromHotkey() }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function refresh() {
    if (hostWidget) hostWidget.refresh()
    loadHistory()
    loadCatalog()
  }

  onOpenedChanged: if (opened) refresh()

  // --- history ---------------------------------------------------------------

  // Fetched lazily on open and cached, which keeps this comfortably inside the
  // endpoint's one-request-per-minute limit: panels are not opened four times
  // a minute.
  readonly property int maxPayload: Model.MAX_PAYLOAD_BYTES

  // Fetched deep enough for a trustworthy 24h count, but only the three most
  // recent are listed -- the rest is one summary line, because how many there
  // have been says more than any single row.
  readonly property int historyFetchLimit: 24
  readonly property int historyShown: 3
  readonly property int historyWindowHours: 24

  property var history: ({})
  property double historyFetchedAt: 0
  property bool historyFailed: false
  property int historyPending: 0

  function loadHistory() {
    if (!regions.length) return
    if (Date.now() - historyFetchedAt < 60000) return
    historyFetchedAt = Date.now()
    historyFailed = false
    history = ({})
    historyPending = regions.length
    for (var i = 0; i < regions.length; i++) historyProc.createObject(root, { regionId: regions[i].id })
  }

  Component {
    id: historyProc
    Process {
      id: proc
      property string regionId: ""
      running: true
      // Through the fetch script rather than curl directly, so this request is
      // bounded by the same ceilings as every other one and the plugin has a
      // single place where network data enters.
      command: [root.script, "--history", regionId]
      stdout: StdioCollector {
        waitForEnd: true
        onStreamFinished: {
          var raw = String(this.text || "")
          // StdioCollector exposes no ceiling of its own, so the retained
          // string is bounded here before anything is kept.
          if (raw.length > root.maxPayload) { root.historyFailed = true; return }
          try {
            var parsed = JSON.parse(raw)
            if (!parsed || parsed.ok !== true) { root.historyFailed = true; return }
            var next = root.history
            next[proc.regionId] = (parsed.alarms || []).slice(0, root.historyFetchLimit)
            root.history = next
            root.historyChanged()
          } catch (e) {
            root.historyFailed = true
          }
        }
      }
      onExited: function (code) {
        // A history failure is never allowed to touch the pill's state.
        if (code !== 0) root.historyFailed = true
        root.historyPending = Math.max(0, root.historyPending - 1)
        proc.destroy()
      }
    }
  }

  // True once any watched region has at least one history entry, so the
  // section can stay hidden rather than showing an empty heading.
  readonly property bool hasHistory: {
    for (var i = 0; i < regions.length; i++)
      if (historyFor(regions[i].id).length > 0) return true
    return false
  }

  function historyFor(id) {
    return history[id] || []
  }

  function historyLine(entry) {
    var type = Model.plain(Model.alertAbbrev(entry.alertType || ""), 32)
    var start = Date.parse(entry.startDate || "")
    var when = isNaN(start) ? "?" : Qt.formatDateTime(new Date(start), "d MMM HH:mm")
    // isContinue means the alert is still running, so a duration of zero is
    // "ongoing" rather than an instantaneous alert.
    var dur = entry.isContinue === true ? "ongoing" : Model.formatDuration(entry.duration)
    return when + "  " + type + "  " + dur
  }

  // --- region catalog and picker ---------------------------------------------

  property var catalog: []
  property bool catalogLoading: false
  property bool catalogFailed: false
  property string query: ""
  property bool pickerOpen: false

  readonly property var results: Model.searchRegions(catalog, query, 12)

  function loadCatalog() {
    if (catalog.length || catalogLoading || script === "") return
    catalogLoading = true
    catalogProc.command = [script, "--regions"]
    catalogProc.running = true
  }

  Process {
    id: catalogProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.catalogLoading = false
        var raw = String(this.text || "")
        if (raw.length > root.maxPayload) { root.catalogFailed = true; return }
        try {
          var parsed = JSON.parse(raw)
          if (parsed && parsed.ok && parsed.regions) {
            root.catalog = parsed.regions.slice(0, Model.MAX_CATALOG)
            root.catalogFailed = false
            root.seedQuery()
            return
          }
        } catch (e) {}
        // Selection being unavailable must never take down monitoring: the
        // already-configured regions keep polling regardless.
        root.catalogFailed = true
      }
    }
  }

  // The shell already knows a location, but it is an English city name while
  // the region tree is Ukrainian-only, and a city is not an oblast. So it
  // pre-filters the picker and is never committed. See the spec's "Why the
  // weather city cannot auto-select".
  property bool seeded: false

  function seedQuery() {
    if (seeded || configured.length || query !== "") return
    seeded = true
    weatherView.reload()
  }

  FileView {
    id: weatherView
    path: Quickshell.env("HOME") + "/.local/state/omarchy/settings/weather.json"
    watchChanges: false
    printErrors: false
    onLoaded: {
      try {
        var parsed = JSON.parse(text())
        if (parsed && parsed.name) {
          root.query = Model.plain(parsed.name, 64)
          root.pickerOpen = true
        }
      } catch (e) {}
    }
  }

  // --- selection persistence -------------------------------------------------

  FileView {
    id: stateFile
    path: Quickshell.env("HOME") + "/.local/state/omarchy/settings/air-alert.json"
    watchChanges: false
    atomicWrites: true
    printErrors: false
  }

  function currentSelection() {
    return Model.copySelection(configured)
  }

  function saveSelection(list) {
    stateFile.setText(JSON.stringify({ regions: list }, null, 2) + "\n")
  }

  function addRegion(r) {
    saveSelection(Model.addRegionTo(currentSelection(), r))
    query = ""
  }

  function removeRegion(id) {
    saveSelection(Model.removeRegionFrom(currentSelection(), id))
  }

  function relabelRegion(id, label) {
    saveSelection(Model.relabelIn(currentSelection(), id, label))
  }

  readonly property bool shellPinned: hostWidget
    && hostWidget.shellRegions && hostWidget.shellRegions.length > 0

  function typeLabel(t) {
    return t === "State" ? "oblast" : (t === "District" ? "raion" : t)
  }

  // --- layout ----------------------------------------------------------------

  readonly property int contentW: 380

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(root.contentW)
    contentHeight: panel.fittedContentHeight(col.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function (direction) { root.switchPanel(direction) }

      Column {
        id: col
        width: parent.width
        spacing: Style.space(8)

        // ---- current status --------------------------------------------------

        PanelSectionHeader {
          text: "AIR ALERT"
          foreground: root.fg
        }

        Text {
          visible: root.regions.length === 0
          width: parent.width
          text: "No region selected yet. Search below to pick one."
          textFormat: Text.PlainText
          wrapMode: Text.WordWrap
          color: Color.muted
          font.family: root.fontFam
          font.pixelSize: Style.font.bodySmall
          font.italic: true
        }

        Repeater {
          model: root.regions

          Row {
            required property var modelData
            width: col.width
            spacing: Style.space(8)

            readonly property bool alerting: modelData.alerts && modelData.alerts.length > 0
            readonly property color rowColor: alerting ? Color.urgent : root.fg

            Text {
              width: col.width * 0.42
              elide: Text.ElideRight
              text: Model.plain(modelData.label)
              textFormat: Text.PlainText
              color: parent.rowColor
              font.family: root.fontFam
              font.pixelSize: Style.font.body
            }

            Text {
              text: parent.alerting
                ? Model.alertAbbrev(modelData.alerts[0].type)
                : "clear"
              textFormat: Text.PlainText
              color: parent.rowColor
              font.family: root.fontFam
              font.pixelSize: Style.font.body
              font.bold: parent.alerting
            }

            Text {
              visible: parent.alerting
              text: Model.formatElapsed(
                parent.alerting ? modelData.alerts[0].since : "",
                root.hostWidget ? root.hostWidget.tick : Date.now())
              textFormat: Text.PlainText
              color: parent.rowColor
              font.family: root.fontFam
              font.pixelSize: Style.font.body
            }
          }
        }

        Text {
          visible: root.hostWidget && root.hostWidget.agg.stale && root.regions.length > 0
          width: parent.width
          text: {
            if (!root.hostWidget) return ""
            var last = root.hostWidget.lastOkFetch
            if (last <= 0) return "No successful update yet — status unknown."
            var age = Math.floor((Date.now() - last) / 1000)
            return "Stale: last update " + age + "s ago."
          }
          textFormat: Text.PlainText
          wrapMode: Text.WordWrap
          color: Color.muted
          font.family: root.fontFam
          font.pixelSize: Style.font.bodySmall
        }

        // ---- history ---------------------------------------------------------

        PanelSeparator { width: parent.width }

        PanelSectionHeader {
          visible: root.hasHistory || root.historyFailed
          text: "RECENT"
          foreground: root.fg
        }

        Text {
          visible: root.historyFailed && root.regions.length > 0
          text: "history unavailable"
          textFormat: Text.PlainText
          color: Color.muted
          font.family: root.fontFam
          font.pixelSize: Style.font.bodySmall
          font.italic: true
        }

        Repeater {
          model: root.regions

          Column {
            required property var modelData
            width: col.width
            spacing: Style.space(2)
            visible: root.historyFor(modelData.id).length > 0

            Text {
              text: Model.plain(modelData.label)
              textFormat: Text.PlainText
              color: Qt.darker(root.fg, 1.4)
              font.family: root.fontFam
              font.pixelSize: Style.font.caption
            }

            Repeater {
              model: root.historyFor(modelData.id).slice(0, root.historyShown)

              Text {
                required property var modelData
                text: root.historyLine(modelData)
                textFormat: Text.PlainText
                color: root.fg
                font.family: root.fontFam
                font.pixelSize: Style.font.bodySmall
              }
            }

            Text {
              text: Model.historySummaryText(
                root.historyFor(parent.modelData.id),
                Date.now(), root.historyWindowHours, root.historyFetchLimit)
              textFormat: Text.PlainText
              color: Color.muted
              font.family: root.fontFam
              font.pixelSize: Style.font.caption
            }
          }
        }

        // ---- picker ----------------------------------------------------------

        PanelSeparator { width: parent.width }

        PanelSectionHeader {
          text: "REGIONS"
          foreground: root.fg
        }

        Text {
          visible: root.shellPinned
          width: parent.width
          text: "Regions are pinned in shell.json; remove them there to use the picker."
          textFormat: Text.PlainText
          wrapMode: Text.WordWrap
          color: Color.muted
          font.family: root.fontFam
          font.pixelSize: Style.font.bodySmall
          font.italic: true
        }

        // Selected regions, each with an editable display label.
        Repeater {
          model: root.shellPinned ? [] : root.configured

          Row {
            required property var modelData
            width: col.width
            spacing: Style.space(6)

            Text {
              width: col.width * 0.40
              elide: Text.ElideRight
              text: Model.plain(modelData.name || modelData.id)
              textFormat: Text.PlainText
              color: Qt.darker(root.fg, 1.3)
              font.family: root.fontFam
              font.pixelSize: Style.font.bodySmall
              anchors.verticalCenter: parent.verticalCenter
            }

            TextField {
              width: col.width * 0.38
              text: Model.plain(modelData.label)
              foreground: root.fg
              verticalPadding: 2
              font.pixelSize: Style.font.bodySmall
              onEditingFinished: root.relabelRegion(modelData.id, text)
            }

            PanelActionButton {
              iconText: "✕"
              foreground: root.fg
              hoverColor: root.bar ? root.bar.urgent : Color.urgent
              tooltipText: "Remove region"
              anchors.verticalCenter: parent.verticalCenter
              onClicked: root.removeRegion(modelData.id)
            }
          }
        }

        TextField {
          id: search
          visible: !root.shellPinned
          width: parent.width
          text: root.query
          placeholderText: "Search region (Kyiv, Львів, Odesa…)"
          foreground: root.fg
          font.pixelSize: Style.font.bodySmall
          onTextChanged: root.query = text
          // Enter takes the highlighted result, so the weather-city suggestion
          // is one keystroke from confirmed — but never applied on its own.
          onAccepted: if (root.results.length) root.addRegion(root.results[0])
        }

        Text {
          visible: root.catalogLoading
          text: "Loading regions…"
          textFormat: Text.PlainText
          color: Color.muted
          font.family: root.fontFam
          font.pixelSize: Style.font.bodySmall
          font.italic: true
        }

        Text {
          visible: root.catalogFailed
          width: parent.width
          text: "Region list unavailable — monitoring continues for the regions already set."
          textFormat: Text.PlainText
          wrapMode: Text.WordWrap
          color: Color.muted
          font.family: root.fontFam
          font.pixelSize: Style.font.bodySmall
          font.italic: true
        }

        Repeater {
          model: root.shellPinned ? [] : root.results

          Rectangle {
            required property var modelData
            required property int index
            width: col.width
            height: resultRow.implicitHeight + Style.space(6)
            radius: Style.radius.small
            // The first result is what Enter takes.
            color: index === 0 ? Qt.rgba(root.fg.r, root.fg.g, root.fg.b, 0.08) : "transparent"

            MouseArea {
              anchors.fill: parent
              cursorShape: Qt.PointingHandCursor
              onClicked: root.addRegion(modelData)
            }

            Column {
              id: resultRow
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.leftMargin: Style.space(4)
              anchors.rightMargin: Style.space(4)
              anchors.verticalCenter: parent.verticalCenter
              spacing: 0

              Text {
                width: parent.width
                elide: Text.ElideRight
                text: Model.plain(modelData.name)
                textFormat: Text.PlainText
                color: root.fg
                font.family: root.fontFam
                font.pixelSize: Style.font.bodySmall
              }

              // On its own line rather than appended: Львівська область and
              // Львівський район differ in the tail, so eliding one line would
              // clip away the only thing telling them apart.
              Text {
                width: parent.width
                elide: Text.ElideRight
                text: root.typeLabel(modelData.type)
                  + (modelData.parent ? " · " + Model.plain(modelData.parent) : "")
                textFormat: Text.PlainText
                color: Color.muted
                font.family: root.fontFam
                font.pixelSize: Style.font.caption
              }
            }
          }
        }

        PanelSeparator { width: parent.width }

        Text {
          width: parent.width
          text: "Unofficial indicator — data can be delayed or wrong. Rely on official alerts."
          textFormat: Text.PlainText
          wrapMode: Text.WordWrap
          color: Color.muted
          font.family: root.fontFam
          font.pixelSize: Style.font.caption
          font.italic: true
        }
      }
    }
  }
}
