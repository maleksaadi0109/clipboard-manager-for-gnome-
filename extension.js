import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GdkPixbuf from 'gi://GdkPixbuf';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const MAX_HISTORY = 10;
const POLL_INTERVAL_MS = 500;
const LABEL_MAX_CHARS = 60;
const KEYBINDING_NAME = 'show-clipboard-shortcut';
const THUMB_SIZE = 80;
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/bmp', 'image/gif'];

function truncateLabel(text, max = LABEL_MAX_CHARS) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= max)
        return cleaned;
    return `${cleaned.substring(0, max)}…`;
}

function hashBytes(bytes) {
    let hash = 5381;
    const len = Math.min(bytes.length, 4096);
    for (let i = 0; i < len; i++)
        hash = ((hash << 5) + hash + bytes[i]) >>> 0;
    return hash.toString(16);
}

export default class ClipboardManagerExtension extends Extension {
    enable() {
        this._history = [];
        this._lastTextHash = '';
        this._lastImageHash = '';
        this._pollSourceId = null;
        this._initMenuSourceId = null;
        this._settings = this.getSettings();

        this._cacheDir = GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            'clipboard-manager-extension',
        ]);
        GLib.mkdir_with_parents(this._cacheDir, 0o755);

        this._buildUI();
        this._bindShortcut();
        this._startPolling();
    }

    disable() {
        this._stopPolling();
        this._unbindShortcut();

        if (this._initMenuSourceId !== null) {
            GLib.Source.remove(this._initMenuSourceId);
            this._initMenuSourceId = null;
        }

        this._destroyUI();

        this._settings = null;
        this._history = null;
        this._lastTextHash = null;
        this._lastImageHash = null;
    }

    _buildUI() {
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        const icon = new St.Icon({
            icon_name: 'edit-paste-symbolic',
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(icon);

        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._initMenuSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._initMenuSourceId = null;
            this._refreshMenu();
            return GLib.SOURCE_REMOVE;
        });
    }

    _destroyUI() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _refreshMenu() {
        if (!this._indicator)
            return;

        const menu = this._indicator.menu;
        menu.removeAll();

        if (this._history.length === 0) {
            const placeholder = new PopupMenu.PopupMenuItem('(clipboard is empty)', {
                reactive: false,
            });
            menu.addMenuItem(placeholder);
            return;
        }

        const clearItem = new PopupMenu.PopupMenuItem('✕  Clear history');
        clearItem.connect('activate', () => {
            this._history = [];
            this._lastTextHash = '';
            this._lastImageHash = '';
            this._refreshMenu();
        });
        menu.addMenuItem(clearItem);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        for (let i = 0; i < this._history.length; i++) {
            const entry = this._history[i];

            if (entry.type === 'text') {
                const label = truncateLabel(entry.content);
                const item = new PopupMenu.PopupMenuItem(label);
                item.connect('activate', () => {
                    this._writeTextToClipboard(entry.content);
                });
                menu.addMenuItem(item);

            } else if (entry.type === 'image') {
                const item = this._createImageMenuItem(entry);
                menu.addMenuItem(item);
            }
        }
    }

    _createImageMenuItem(entry) {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: true });

        const box = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'spacing: 10px;',
        });

        try {
            const gfile = Gio.File.new_for_path(entry.path);
            const gicon = new Gio.FileIcon({ file: gfile });
            const thumbIcon = new St.Icon({
                gicon: gicon,
                icon_size: THUMB_SIZE,
                style_class: 'clipboard-image-thumb',
                style: 'border-radius: 4px;',
            });
            box.add_child(thumbIcon);
        } catch (e) {
            const fallback = new St.Icon({
                icon_name: 'image-x-generic-symbolic',
                icon_size: 32,
            });
            box.add_child(fallback);
        }

        const dimLabel = new St.Label({
            text: `🖼 Image (${entry.width}×${entry.height})`,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 0.9em; color: #aaa;',
        });
        box.add_child(dimLabel);

        item.add_child(box);

        item.connect('activate', () => {
            this._writeImageToClipboard(entry.path);
        });

        return item;
    }

    _startPolling() {
        this._pollSourceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            POLL_INTERVAL_MS,
            () => {
                this._readClipboard();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    _stopPolling() {
        if (this._pollSourceId !== null) {
            GLib.Source.remove(this._pollSourceId);
            this._pollSourceId = null;
        }
    }

    _readClipboard() {
        const clipboard = St.Clipboard.get_default();

        clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
            if (text && text.trim() !== '') {
                if (text !== this._lastTextHash) {
                    this._lastTextHash = text;
                    this._pushToHistory({ type: 'text', content: text });
                }
                return;
            }

            this._readImageClipboard(clipboard);
        });
    }

    _readImageClipboard(clipboard) {
        try {
            clipboard.get_content(
                St.ClipboardType.CLIPBOARD,
                'image/png',
                (_clipboard, bytes) => {
                    if (!bytes || bytes.get_size() === 0)
                        return;

                    const data = bytes.get_data();
                    if (!data || data.length === 0)
                        return;

                    const imgHash = hashBytes(data);
                    if (imgHash === this._lastImageHash)
                        return;

                    this._lastImageHash = imgHash;

                    const filename = `clip_${Date.now()}_${imgHash}.png`;
                    const filepath = GLib.build_filenamev([this._cacheDir, filename]);

                    try {
                        GLib.file_set_contents(filepath, data);

                        let width = 0, height = 0;
                        try {
                            const pixbuf = GdkPixbuf.Pixbuf.new_from_file(filepath);
                            width = pixbuf.get_width();
                            height = pixbuf.get_height();
                        } catch (e) {}

                        this._pushToHistory({
                            type: 'image',
                            path: filepath,
                            hash: imgHash,
                            width: width,
                            height: height,
                        });
                    } catch (e) {
                        log(`[ClipboardManager] Failed to save image: ${e.message}`);
                    }
                },
            );
        } catch (e) {}
    }

    _writeTextToClipboard(text) {
        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
        this._lastTextHash = text;
    }

    _writeImageToClipboard(filepath) {
        try {
            const file = Gio.File.new_for_path(filepath);
            const [ok, contents] = file.load_contents(null);
            if (ok) {
                const clipboard = St.Clipboard.get_default();
                const bytes = GLib.Bytes.new(contents);
                clipboard.set_content(
                    St.ClipboardType.CLIPBOARD,
                    'image/png',
                    bytes,
                );
                this._lastImageHash = hashBytes(contents);
            }
        } catch (e) {
            log(`[ClipboardManager] Failed to write image to clipboard: ${e.message}`);
        }
    }

    _pushToHistory(entry) {
        if (entry.type === 'text') {
            this._history = this._history.filter(
                e => !(e.type === 'text' && e.content === entry.content)
            );
        } else if (entry.type === 'image') {
            this._history = this._history.filter(
                e => !(e.type === 'image' && e.hash === entry.hash)
            );
        }

        this._history.unshift(entry);

        if (this._history.length > MAX_HISTORY)
            this._history.length = MAX_HISTORY;

        this._refreshMenu();
    }

    _bindShortcut() {
        Main.wm.addKeybinding(
            KEYBINDING_NAME,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._toggleMenu(),
        );
    }

    _unbindShortcut() {
        Main.wm.removeKeybinding(KEYBINDING_NAME);
    }

    _toggleMenu() {
        if (this._indicator)
            this._indicator.menu.toggle();
    }
}
