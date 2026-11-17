# App shell

The frame around every authenticated page: the sidebar with grouped navigation, the collapse handle, and the header actions.

## Sub-features

- Sidebar groups and links, with a count badge on Auth Files.
- The collapse handle on the sidebar edge hides the labels. Its label names the shortcut.
- Header: refresh, language menu (`aria-label` "Language"), theme menu (`aria-label` "Theme"), logout.
- Light and dark themes.

## How to get to it (user POV)

- Log in. The shell wraps every page.

## Driving it with drive.mjs

```bash
node $V/drive.mjs click '.theme-menu > button'
node $V/drive.mjs shot "$EVIDENCE/theme-menu.png"
node $V/drive.mjs click 'text=Quota Management'
node $V/drive.mjs eval 'location.hash'
```

Proof: the sidebar link changes the hash to its route and marks itself active. The theme menu lists its options and switching one changes `document.documentElement.dataset.theme`.

## Gotchas

- `drive.mjs theme` clicks the header menu by position (auto, light, paper, dark), so it works in any UI language. The choice persists in local storage for the profile. Set it back with `theme dark` before ending a run that changed it.
