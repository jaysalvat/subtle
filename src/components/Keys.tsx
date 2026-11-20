/**
 * A text with its shortcuts shown as key caps: "Add a bookmark (B)" → Add a bookmark [B]
 * (`keyParts` in lib/keys.ts). Used by the tooltips, menus and hints; style `kbd.key` in base.css.
 */
import { keyParts } from '../lib/keys';

export function WithKeys({ text }: { text: string }) {
  return (
    <>
      {keyParts(text).map((p, i) =>
        typeof p === 'string' ? (
          p
        ) : (
          <kbd key={i} className="key">
            {p.key}
          </kbd>
        ),
      )}
    </>
  );
}
