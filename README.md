# GNOME Clipboard Manager

A lightweight clipboard history manager for GNOME Shell (GNOME 45+). It stores your last 10 copied items (both text and images) and lets you access them from the top panel or with a global hotkey.

## Features
- **Text & Image support**: Keeps track of both text snippets and images (saves image previews as PNGs in `~/.cache`).
- **Quick Panel Access**: Click the clipboard icon in your top bar to see history.
- **Keyboard Shortcut**: Toggle the dropdown menu quickly with `Super + V` (configurable).
- **ESM-compliant**: Built using modern ES modules (compatible with GNOME 45, 46, 47, 48, 49, and 50).
- **Deduplication**: Automatically filters out duplicate consecutive entries.

---

## Installation

### 1. Place the files
Clone or copy this folder directly into your local GNOME Shell extensions directory:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/
# If cloning directly:
git clone https://github.com/<your-username>/clipboard-manager.git ~/.local/share/gnome-shell/extensions/clipboard@extension.com
```

If you already have the files locally, just make sure they are located at:
`~/.local/share/gnome-shell/extensions/clipboard@extension.com/`

### 2. Compile the schemas
You must compile the settings schema so GNOME knows about the keyboard shortcut config:

```bash
glib-compile-schemas ~/.local/share/gnome-shell/extensions/clipboard@extension.com/schemas/
```

### 3. Restart GNOME Shell
- **X11**: Press `Alt + F2`, type `r`, and hit `Enter`.
- **Wayland**: Log out of your session and log back in.

### 4. Enable the extension
Enable it via the Extensions app, or run:

```bash
gnome-extensions enable clipboard@extension.com
```

---

## Configuration & Shortcuts

The default shortcut to open the history menu is `Super + V`.

If you want to change it, you can use `gsettings` from your terminal. For example, to change it to `Super + Shift + V`:

```bash
gsettings set org.gnome.shell.extensions.clipboard-manager show-clipboard-shortcut "['<Super><Shift>v']"
```

To reset it back to default:
```bash
gsettings reset org.gnome.shell.extensions.clipboard-manager show-clipboard-shortcut
```
