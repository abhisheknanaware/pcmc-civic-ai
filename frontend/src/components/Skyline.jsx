import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// Original, stylised Pimpri-Chinchwad skyline (hand-coded SVG, not traced from any image).
// variant="color": flat colour illustration; variant="line": single-colour line art for the footer.
const LANDMARKS = ['bhakti_shakti', 'flag', 'morya', 'metro', 'pcmc_bhavan', 'midc', 'homes'];

export default function Skyline({ variant = 'color', interactive = true, id = variant }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(null);
  const bind = (key) => (interactive ? {
    className: `landmark ${active === key ? 'is-active' : ''}`,
    tabIndex: 0,
    role: 'img',
    'aria-label': t(`skyline_${key}`),
    onMouseEnter: () => setActive(key),
    onMouseLeave: () => setActive(null),
    onFocus: () => setActive(key),
    onBlur: () => setActive(null),
    onClick: () => setActive(key),
  } : { className: 'landmark' });

  return (
    <figure className={`skyline skyline-${variant}`}>
      <svg viewBox="0 0 1200 240" preserveAspectRatio="xMidYMax meet" role="group" aria-label={t('skyline_title')}>
        <defs>
          <clipPath id={`metro-clip-${id}`}><rect x="470" y="100" width="300" height="60" /></clipPath>
        </defs>

        {/* sky: drifting clouds */}
        <g className="clouds">
          <path className="cloud c1" d="M150 60h60a14 14 0 0 0-14-14 18 18 0 0 0-33 4 11 11 0 0 0-13 10Z" />
          <path className="cloud c2" d="M640 42h76a17 17 0 0 0-17-17 23 23 0 0 0-42 5 14 14 0 0 0-17 12Z" />
          <path className="cloud c3" d="M1010 70h56a13 13 0 0 0-13-13 17 17 0 0 0-31 4 10 10 0 0 0-12 9Z" />
        </g>

        {/* distant hill (Durga Tekdi, Nigdi) */}
        <path className="hill" d="M0 210C60 150 130 128 210 140s120 40 170 70Z" />
        <path className="hill hill-2" d="M880 210c50-40 120-62 190-52s100 30 130 52Z" />

        {/* Bhakti-Shakti sculpture on its pedestal, Nigdi */}
        <g {...bind('bhakti_shakti')}>
          <path className="f-clay s" d="M52 210v-22h78v22Z M62 188v-18h58v18Z M72 170v-12h38v12Z" />
          <g className="f-ink">
            <circle cx="82" cy="118" r="6" />
            <path d="M77 125h10l3 33h-16Z" />
            <path d="M76 132l-8 14 4 2 7-11Z" />
            <circle cx="102" cy="116" r="6.5" />
            <path d="M96 124h12l2 34h-16Z" />
            <path d="M108 128l9 10-3 3-8-8Z" />
            <path d="M94 104h16l-3 6h-10Z" />
          </g>
        </g>

        {/* giant national flag at Bhakti-Shakti */}
        <g {...bind('flag')}>
          <path className="pole s" d="M190 210V38" />
          <circle className="f-ink" cx="190" cy="36" r="3" />
          <g className="flag">
            <path className="flag-saffron" d="M191 40h46v12h-46Z" />
            <path className="flag-white" d="M191 52h46v12h-46Z" />
            <path className="flag-green" d="M191 64h46v12h-46Z" />
            <circle className="flag-chakra" cx="214" cy="58" r="3.4" />
          </g>
        </g>

        {/* trees */}
        <g className="trees">
          <path className="trunk s" d="M262 210v-24 M292 210v-18" />
          <circle className="f-sage s" cx="262" cy="178" r="16" />
          <circle className="f-sage-dark s" cx="292" cy="188" r="12" />
        </g>

        {/* Morya Gosavi temple, Chinchwad */}
        <g {...bind('morya')}>
          <path className="f-sand s" d="M318 210v-10h150v10Z" />
          <path className="f-clay s" d="M330 200v-46h126v46Z" />
          <path className="f-paper s" d="M348 200v-22a8 8 0 0 1 16 0v22 M385 200v-26a8 8 0 0 1 16 0v26 M422 200v-22a8 8 0 0 1 16 0v22" />
          <path className="f-marigold s" d="M372 154c0-26 10-40 21-54 11 14 21 28 21 54Z" />
          <path className="f-marigold-light s" d="M338 154c0-12 6-19 12-25 6 6 12 13 12 25Z M424 154c0-12 6-19 12-25 6 6 12 13 12 25Z" />
          <path className="f-ink" d="M392 98h2v-10h-2Z M393 86a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path className="f-clay-dark" d="M330 160h126v4H330Z" />
        </g>

        {/* palm */}
        <g className="trees">
          <path className="trunk s" d="M486 210c2-18 0-34-4-46" />
          <path className="f-sage s" d="M482 164c-14-6-24-2-30 6 10-2 20 0 30-6Zm0 0c12-8 24-6 30 2-10-2-20 0-30-2Zm0 0c-4-12-12-18-22-18 8 6 14 12 22 18Z" />
        </g>

        {/* elevated metro with a moving train */}
        <g {...bind('metro')}>
          <path className="f-stone s" d="M500 158h260v8H500Z" />
          {[520, 590, 660, 730].map((x) => <path key={x} className="f-stone s" d={`M${x - 5} 210v-44h10v44Z M${x - 14} 166h28v-4h-28Z`} />)}
          <g clipPath={`url(#metro-clip-${id})`}>
            <g className="train">
              <path className="f-teal s" d="M470 156v-20a8 8 0 0 1 8-8h96a14 14 0 0 1 14 14v14Z" />
              <path className="f-paper" d="M484 134h14v10h-14Z M504 134h14v10h-14Z M524 134h14v10h-14Z M544 134h14v10h-14Z" />
              <path className="f-marigold" d="M470 150h118v3H470Z" />
            </g>
          </g>
        </g>

        {/* PCMC Bhavan (headquarters), Pimpri */}
        <g {...bind('pcmc_bhavan')}>
          <path className="f-teal s" d="M790 210V96h88v114Z" />
          <path className="f-teal-light s" d="M800 86h68v10h-68Z" />
          <path className="f-paper" d={[0, 1, 2, 3, 4, 5].map((r) => [0, 1, 2, 3].map((c) => `M${802 + c * 19} ${106 + r * 15}h12v9h-12Z`).join(' ')).join(' ')} />
          <path className="f-sand s" d="M818 210v-18h32v18Z" />
          <path className="pole s" d="M834 86V70" />
          <path className="flag-saffron" d="M835 70h12v4h-12Z" />
          <path className="flag-white" d="M835 74h12v3h-12Z" />
          <path className="flag-green" d="M835 77h12v3h-12Z" />
        </g>

        {/* MIDC industry: sawtooth factory with chimney smoke */}
        <g {...bind('midc')}>
          <path className="f-stone s" d="M902 210v-44l24-16v16l24-16v16l24-16v60Z" />
          <path className="f-clay s" d="M982 210v-92h14v92Z" />
          <path className="f-paper" d="M912 186h14v10h-14Z M938 186h14v10h-14Z" />
          <g className="smoke">
            <circle className="puff p1" cx="989" cy="108" r="6" />
            <circle className="puff p2" cx="995" cy="96" r="8" />
            <circle className="puff p3" cx="1003" cy="82" r="10" />
          </g>
        </g>

        {/* housing */}
        <g {...bind('homes')}>
          <path className="f-sand s" d="M1024 210v-70h40v70Z" />
          <path className="f-marigold-light s" d="M1070 210v-50h36v50Z" />
          <path className="f-paper" d="M1032 150h8v8h-8Z M1048 150h8v8h-8Z M1032 168h8v8h-8Z M1048 168h8v8h-8Z M1032 186h8v8h-8Z M1048 186h8v8h-8Z M1078 172h8v8h-8Z M1092 172h8v8h-8Z" />
        </g>

        <g className="trees">
          <path className="trunk s" d="M1136 210v-20 M1166 210v-26" />
          <circle className="f-sage-dark s" cx="1136" cy="184" r="13" />
          <circle className="f-sage s" cx="1166" cy="176" r="17" />
        </g>

        {/* ground */}
        <path className="ground" d="M0 210h1200" />
      </svg>
      {interactive && (
        <figcaption className={`skyline-caption ${active ? 'is-visible' : ''}`} aria-live="polite">
          {active ? t(`skyline_${active}`) : t('skyline_hint')}
        </figcaption>
      )}
    </figure>
  );
}

export { LANDMARKS };
