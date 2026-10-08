// Allowlist HTML sanitizer for rich-text job descriptions (v2 M1 · 1.10).
//
// Only inline emphasis + lists + simple blocks are permitted. Everything else —
// scripts, styles, event handlers, every attribute, and any other tag — is
// stripped. Runs BOTH on save and on render, so stored HTML is never trusted.
//
// Parsing goes through a <template>, whose content is inert (no scripts run, no
// images/resources load), so this is safe to point at arbitrary pasted HTML.

const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'P', 'BR', 'DIV']);

export function sanitizeHtml(input) {
  if (input == null) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = String(input);
  clean(tpl.content);
  const out = tpl.innerHTML.trim();

  // Collapse an "empty" editor (just <br>/<div></div>/whitespace, no text and no
  // list items) to '' so it persists as NULL instead of a stray tag.
  const probe = document.createElement('div');
  probe.innerHTML = out;
  const hasText = (probe.textContent || '').trim().length > 0;
  const hasList = !!probe.querySelector('li');
  return (hasText || hasList) ? out : '';
}

function clean(node) {
  // Snapshot children first — we mutate the tree as we go.
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === 3) continue;          // text node — keep as-is
    if (child.nodeType !== 1) { child.remove(); continue; } // comments etc.

    if (!ALLOWED.has(child.tagName)) {
      // Unknown tag (span, a, script, img, …): drop the tag but keep its
      // cleaned children in place, so pasted text survives without markup.
      clean(child);
      while (child.firstChild) node.insertBefore(child.firstChild, child);
      child.remove();
      continue;
    }

    // Strip every attribute (class, style, href, on*, data-*, …).
    while (child.attributes.length) child.removeAttribute(child.attributes[0].name);
    clean(child);
  }
}
