/**
 * What a bug report has to be able to name: the app version and the exact plugin binary inside it. The SHA
 * is injected at build time from the embedded `perfect-cutscene.asi` (see vite.config.ts).
 */
export function About(): React.ReactElement {
  const built = __ASI_SHA1__.length > 0;

  return (
    <footer className="cc-about">
      <span>v{__APP_VERSION__}</span>
      <span className="cc-about-sep">·</span>
      {built ? (
        <span>
          perfect-cutscene.asi {__ASI_BYTES__} B · sha1 <code>{__ASI_SHA1__}</code>
        </span>
      ) : (
        <span className="cc-about-missing">no plugin embedded — this is a dev tree, not a shippable build</span>
      )}
    </footer>
  );
}
