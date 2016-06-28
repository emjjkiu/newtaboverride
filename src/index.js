const ONE_SECOND_IN_MILLISECONDS = 1000;
const URL_CHARS_LIMIT = 2000;

const _ = require('sdk/l10n').get;
const { ActionButton } = require('sdk/ui/button/action');
const { PrefsTarget } = require('sdk/preferences/event-target');
const { setInterval, clearInterval } = require('sdk/timers');
const clipboard = require('sdk/clipboard');
const data = require('sdk/self').data;
const newTabUrlJsm = require('resource:///modules/NewTabURL.jsm').NewTabURL;
const preferencesService = require('sdk/preferences/service');
const prefsTarget = PrefsTarget({ branchName: 'browser.startup.'});
const simplePrefs = require('sdk/simple-prefs');
const tabs = require('sdk/tabs');
const windows = require('sdk/windows');

const newtaboverride = {
  actionButton : null,
  lastClipboardUrl : false,
  timer : false,

  init : function () {
    newtaboverride.onPrefChange();
    newtaboverride.createButton();
  },

  onPrefChange : function () {
    var type = simplePrefs.prefs['type'];
    var newTabUrl;

    switch (type) {
      case 'about:blank':
      case 'about:home':
      case 'about:newtab':
      case 'about:sync-tabs':
        newTabUrl = type;
        break;
      case 'clipboard':
        newTabUrl = 'about:blank';
        // unfortunately there is no "clipboard changed" event…
        newtaboverride.timer = setInterval(newtaboverride.clipboardAction, ONE_SECOND_IN_MILLISECONDS / 2);
        break;
      case 'custom_url':
        var url = simplePrefs.prefs['url'];
        if (url === '') {
          newTabUrl = 'about:blank';
        } else {
          newTabUrl = url;
        }
        break;
      case 'homepage':
        newTabUrl = preferencesService.getLocalized('browser.startup.homepage', 'about:blank').split('|')[0];
        break;
      default:
        newTabUrl = 'about:newtab';
    }

    if (type !== 'clipboard') {
      clearInterval(newtaboverride.timer);
      newtaboverride.lastClipboardUrl = false;
    }

    newTabUrlJsm.override(newTabUrl);

    for (let tab of tabs) {
      if (tab.url === data.url('html/settings.html')) {
        newtaboverride.syncPreferencesForOptionsUi(tab);
        return;
      }
    }
  },

  createButton : function () {
    newtaboverride.actionButton = ActionButton({
      id : 'newtaboverride-button',
      label : _('settings_title_short'),
      icon : {
        '18' : data.url('images/icon-18.png'),
        '32' : data.url('images/icon-32.png'),
        '36' : data.url('images/icon-36.png'),
        '64' : data.url('images/icon-64.png')
      },
      onClick : () => {
        if (newtaboverride.actionButton.badge) {
          newtaboverride.actionButton.badge = null;
        }

        for (let window of windows.browserWindows) {
          for (let tab of window.tabs) {
            if (tab.url === data.url('html/settings.html')) {
              window.activate();
              tab.activate();
              return;
            }
          }
        }

        tabs.open({
          url : 'html/settings.html',
          onReady : (tab) => {
            newtaboverride.syncPreferencesForOptionsUi(tab).port.on('change-preference', (preference) => {
              simplePrefs.prefs[preference.key] = preference.value;
            });
          }
        });
      }
    });
  },

  clipboardAction : function () {
    var clipboardContent = clipboard.get();

    if (clipboard.currentFlavors.indexOf('text') === -1) {
      return;
    }

    if (clipboardContent.length > URL_CHARS_LIMIT || !newtaboverride.isValidUri(clipboardContent)) {
      return;
    }

    if (!newtaboverride.lastClipboardUrl || clipboardContent !== newtaboverride.lastClipboardUrl) {
      newTabUrlJsm.override(clipboardContent);
      newtaboverride.lastClipboardUrl = clipboardContent;
    }
  },

  /**
   * @see http://stackoverflow.com/a/9284473
   */
  isValidUri : function (string) {
    var website = /^(?:(?:https?):\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,}))\.?)(?::\d{2,5})?(?:[/?#]\S*)?$/i;
    var aboutpage = /^about:(about|accounts|addons|blank|buildconfig|cache|checkerboard|config|crashes|credits|debugging|downloads|healthreport|home|license|logo|memory|mozilla|networking|newtab|performance|plugins|preferences|privatebrowsing|profiles|rights|robots|searchreset|serviceworkers|support|sync-log|sync-tabs|telemetry|webrtc)?$/i;

    return website.test(string) || aboutpage.test(string);
  },

  syncPreferencesForOptionsUi : function (tab) {
    const worker = tab.attach({
      contentScriptFile : data.url('js/settings.js')
    });

    worker.port.emit('show-preferences', simplePrefs);

    return worker;
  }
};

const main = (options) => {
  newtaboverride.init();

  simplePrefs.on('', newtaboverride.onPrefChange);
  prefsTarget.on('homepage', newtaboverride.onPrefChange);

  if (options.loadReason === 'install') {
    newtaboverride.actionButton.badge = '★';
  }
};

const unload = (reason) => {
  if (reason === 'uninstall' || reason === 'disable') {
    clearInterval(newtaboverride.timer);
    newtaboverride.lastClipboardUrl = false;
    newTabUrlJsm.reset();
  }
};

exports.main = main;
exports.onUnload = unload;
