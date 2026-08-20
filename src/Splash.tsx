import { useEffect, useRef } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { ABOUT, CREDIT, LEGAL, LINKS, SUBTITLE, TITLE, VERSION } from "./lib/about";
import banner from "./assets/splash-banner.jpg";
import logo from "./assets/tvd-logo.png";

/**
 * The splash, kept to the measurements of the macOS original rather than to
 * something that merely resembles them: 640x580, 250px of full-bleed key art,
 * 26px margins, 36/13/11pt type, and the mark's height derived from the type
 * beside it rather than picked by eye.
 *
 * The key art is Philon's own output — real page previews with the measured
 * source regions it recorded — because the only honest thing to put on the
 * front of a document converter is a document it converted.
 */
interface SplashProps {
  onDismiss: () => void;
}

export function Splash({ onDismiss }: SplashProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The close box, Continue and Escape all mean the same thing.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") { event.preventDefault(); onDismiss(); }
    };
    window.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div className="splash-backdrop" role="presentation" onMouseDown={onDismiss}>
      <div
        className="splash" role="dialog" aria-modal="true" aria-labelledby="splash-title"
        tabIndex={-1} ref={dialogRef} onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="splash-art" style={{ backgroundImage: `url(${banner})` }}>
          <div className="splash-lockup">
            <img className="splash-logo" src={logo} alt="" width={49} height={49} />
            <div className="splash-names">
              <h1 id="splash-title">{TITLE}</h1>
              <p>{SUBTITLE}</p>
            </div>
            <span className="splash-version">{VERSION}</span>
          </div>
        </div>

        <div className="splash-body">
          {ABOUT.split("\n\n").map((paragraph) => <p key={paragraph.slice(0, 24)}>{paragraph}</p>)}
        </div>

        <details className="splash-legal">
          <summary><CaretRight size={11} weight="bold" /> Sources, licences and credits</summary>
          {LEGAL.split("\n\n").map((paragraph) => <p key={paragraph.slice(0, 24)}>{paragraph}</p>)}
        </details>

        <footer className="splash-footer">
          <span>{CREDIT}</span>
          {LINKS.map(([label, address]) => (
            <a key={address} href={address} target="_blank" rel="noreferrer noopener">{label}</a>
          ))}
          <button className="splash-continue" type="button" onClick={onDismiss}>Continue</button>
        </footer>
      </div>
    </div>
  );
}

const STORAGE_KEY = "philon.splash.seen.v1";

/** Absent means yes: the first launch is when this is worth reading. */
export function splashWanted(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try { return storage.getItem(STORAGE_KEY) !== VERSION; } catch { return true; }
}

export function rememberSplashSeen(storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(STORAGE_KEY, VERSION); } catch { /* private mode; showing it again is harmless. */ }
}
