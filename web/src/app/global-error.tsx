"use client";

import { useEffect } from "react";

// The last safety net: it replaces the whole page (layout included), so it brings its own document and styles and
// cannot use the app's CSS. Colours follow the system light or dark setting.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <head>
        <style>{`
          body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;font:400 16px/1.5 system-ui,sans-serif;background:#f1efed;color:#16100f}
          .p{width:min(100%,420px);background:#fff;border-radius:24px;padding:24px;display:grid;gap:12px;animation:in .38s cubic-bezier(.16,1,.3,1) both}
          h1{margin:0;font-size:1.5rem;letter-spacing:-.02em}p{margin:0;color:#6b605e}
          .b{min-height:46px;border:0;border-radius:999px;background:#5d1b23;color:#fffaf5;font:600 1rem system-ui,sans-serif;cursor:pointer;text-align:center;line-height:46px;text-decoration:none}
          .b.q{background:#e9e4e1;color:#16100f}.b:active{transform:scale(.97)}
          @keyframes in{from{opacity:0;transform:translateY(12px)}}
          @media (prefers-color-scheme:dark){body{background:#161011;color:#f5eeee}.p{background:#221819}p{color:#a79a9b}.b{background:#d98a94;color:#161011}.b.q{background:#2c2123;color:#f5eeee}}
          @media (prefers-reduced-motion:reduce){.p{animation:none}}
        `}</style>
      </head>
      <body>
        <div className="p" role="alert">
          <h1>Something went wrong</h1>
          <p>That’s on us, not you. Try again, and if it keeps happening, go back to Today.</p>
          <button className="b" onClick={retry}>Try again</button>
          <a className="b q" href="/">Go to Today</a>
        </div>
      </body>
    </html>
  );
}
