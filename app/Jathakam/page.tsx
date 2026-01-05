
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

// Up 2 levels to reach ChandraPrabha root
import PdfExport from '../../components/PdfExport';

// Up 1 level to reach 'app', then into 'lib'
import { generateSummary, generateInterpretation } from '../lib/interpretation';

// Up 1 level to find Page7.tsx inside 'app'
import Page7 from '../Page7.tsx';

/* =========================
   Types
   ========================= */
type GeoHit = {
  name: string;
  lat: number;
  lon: number;
  class: string;
  type: string;
};
type NakRow = {
  body: string;
  sign: string;
  deg: number;
  nakshatra: string;
  pada: number;
  lord: string;
};
type DashaRow = { lord: string; startISO: string; endISO: string };
type AspectPair = { a: string; b: string; type: string; delta: number };

type ChartOut = {
  engine: 'SWIEPH' | 'MOSEPH';
  jd_ut: number;
  lstHours: number;
  timezone: string;
  // D1
  ascendant: number;
  cusps: number[];
  positions: Record<string, number>;
  // D9
  d9Ascendant: number;
  d9Cusps: number[];
  d9Positions: Record<string, number>;
  // Extras
  sunriseISO: string | null;
  sunsetISO: string | null;
  nakTable: NakRow[];
  dasha: DashaRow[];
  aspects: AspectPair[];
};

type ApiError = { error: string; details?: any };

/* =========================
   Constants & Helpers
   ========================= */
const PRINT_LOGO_EACH_PAGE = false;

const SIGNS = [
  'Aries',
  'Taurus',
  'Gemini',
  'Cancer',
  'Leo',
  'Virgo',
  'Libra',
  'Scorpio',
  'Sagittarius',
  'Capricorn',
  'Aquarius',
  'Pisces',
];
const SIGN_ABBR = [
  'Ar',
  'Ta',
  'Ge',
  'Cn',
  'Le',
  'Vi',
  'Li',
  'Sc',
  'Sg',
  'Cp',
  'Aq',
  'Pi',
];

const TIMEZONES = [
  'Asia/Kolkata',
  'America/Chicago',
  'America/New_York',
  'America/Los_Angeles',
  'America/Denver',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

function norm360(x: number) {
  return ((x % 360) + 360) % 360;
}
function toDMSSafe(deg: number) {
  let total = Math.round(norm360(deg) * 3600);
  let d = Math.floor(total / 3600);
  total -= d * 3600;
  let m = Math.floor(total / 60);
  total -= m * 60;
  let s = total;
  if (s === 60) {
    s = 0;
    m += 1;
  }
  if (m === 60) {
    m = 0;
    d += 1;
  }
  d = d % 360;
  return { d, m, s };
}

/* ---- Varga helpers (D1, D2, D3, D7, D9, D10, D12, D30) ---- */
function signIndex(deg: number) {
  return Math.floor(norm360(deg) / 30);
}
const ODD = (s: number) => s % 2 === 0; // Aries index 0 -> true (odd sign)

const QUALITY: Array<'movable' | 'fixed' | 'dual'> = [
  'movable',
  'fixed',
  'dual',
  'movable',
  'fixed',
  'dual',
  'movable',
  'fixed',
  'dual',
  'movable',
  'fixed',
  'dual',
];

function horaSign(s: number, within: number) {
  // D2
  const first = within < 15;
  const odd = ODD(s);
  if (odd) return first ? 4 : 3; // odd: 0–15 -> Leo, 15–30 -> Cancer
  return first ? 3 : 4; // even: 0–15 -> Cancer, 15–30 -> Leo
}

function drekkanaSign(s: number, within: number) {
  // D3
  const p = Math.floor(within / 10); // 0..2
  const add = [0, 4, 8][p];
  return (s + add) % 12;
}

function saptamsaSign(s: number, within: number) {
  // D7
  const p = Math.floor(within / (30 / 7)); // 0..6
  const base = ODD(s) ? s : (s + 6) % 12; // odd: from sign; even: from 7th
  return (base + p) % 12;
}

function navamsaSign(s: number, within: number) {
  // D9
  const p = Math.floor(within / (30 / 9)); // 0..8
  const q = QUALITY[s];
  const base =
    q === 'movable' ? s : q === 'fixed' ? (s + 8) % 12 : (s + 4) % 12;
  return (base + p) % 12;
}

function dasamsaSign(s: number, within: number) {
  // D10
  const p = Math.floor(within / 3); // 0..9
  const base = ODD(s) ? s : (s + 8) % 12; // odd: from sign; even: from 9th
  return (base + p) % 12;
}

function dwadasamsaSign(s: number, within: number) {
  // D12
  const p = Math.floor(within / 2.5); // 0..11
  return (s + p) % 12;
}

function trimshamsaSign(s: number, within: number) {
  // D30 (Parashara)
  const odd = ODD(s);
  if (odd) {
    if (within < 5) return 0; // Aries
    if (within < 10) return 10; // Aquarius
    if (within < 18) return 8; // Sagittarius
    if (within < 25) return 2; // Gemini
    return 6; // Libra
  } else {
    if (within < 5) return 7; // Scorpio
    if (within < 10) return 9; // Capricorn
    if (within < 18) return 11; // Pisces
    if (within < 25) return 5; // Virgo
    return 1; // Taurus
  }
}

/** Compute Varga placements (sign names only) from D1 degrees */
function vargaPlacements(positions: Record<string, number>, asc: number) {
  const bodies = [
    'Ascendant',
    'Sun',
    'Moon',
    'Mercury',
    'Venus',
    'Mars',
    'Jupiter',
    'Saturn',
    'Rahu',
    'Ketu',
    'Uranus',
    'Neptune',
    'Pluto',
  ];
  const getDeg = (name: string) =>
    name === 'Ascendant' ? asc : positions[name];
  return bodies
    .map((b) => {
      const deg = getDeg(b);
      if (!Number.isFinite(deg)) return null;
      const s = signIndex(deg);
      const within = norm360(deg) % 30;
      return {
        body: b,
        D1: SIGNS[s],
        D2: SIGNS[horaSign(s, within)],
        D3: SIGNS[drekkanaSign(s, within)],
        D7: SIGNS[saptamsaSign(s, within)],
        D9: SIGNS[navamsaSign(s, within)],
        D10: SIGNS[dasamsaSign(s, within)],
        D12: SIGNS[dwadasamsaSign(s, within)],
        D30: SIGNS[trimshamsaSign(s, within)],
      };
    })
    .filter(Boolean) as Array<{
    body: string;
    D1: string;
    D2: string;
    D3: string;
    D7: string;
    D9: string;
    D10: string;
    D12: string;
    D30: string;
  }>;
}

function fmtDMS(deg: number) {
  const { d, m, s } = toDMSSafe(deg);
  return `${d}° ${m}′ ${s}″`;
}
function fmtSignDeg(deg: number) {
  const d = norm360(deg);
  const sign = Math.floor(d / 30);
  const within = d - sign * 30;
  const { d: dd, m, s } = toDMSSafe(within);
  return `${SIGNS[sign]} ${dd}°${m.toString().padStart(2, '0')}′${s
    .toString()
    .padStart(2, '0')}″`;
}
function fmtLST(hours: number) {
  const h = Math.floor(hours);
  const mFloat = (hours - h) * 60;
  const m = Math.floor(mFloat);
  const s = Math.round((mFloat - m) * 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function fmtISO(iso: string | null, zone: string) {
  if (!iso) return '—';
  try {
    const dt = new Date(iso);
    const d = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dt);
    const t = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(dt);
    return `${d} ${t} (${zone})`;
  } catch {
    return '—';
  }
}
const pad2 = (n: number) => n.toString().padStart(2, '0');

function range(a: number, b: number) {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}
function daysInMonth(year?: number, month1based?: number) {
  if (!year || !month1based) return 31;
  return new Date(year, month1based, 0).getDate();
}

function normalizeTimezone(tzRaw: string): {
  tz: string | null;
  corrected?: string;
} {
  const tz = (tzRaw || '').trim();
  if (!tz) return { tz: null };
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return { tz };
  } catch {}
  if (tz.includes('/')) {
    const parts = tz.split('/');
    const candidate = `${parts[1]}/${parts[0]}`.replace(/\s+/g, '_');
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate });
      return { tz: candidate, corrected: candidate };
    } catch {}
  }
  const quickMap: Record<string, string> = {
    'Chicago/America': 'America/Chicago',
    'Kolkata/Asia': 'Asia/Kolkata',
    'Calcutta/Asia': 'Asia/Kolkata',
    'Bombay/Asia': 'Asia/Kolkata',
    'Madras/Asia': 'Asia/Kolkata',
  };
  if (quickMap[tz]) return { tz: quickMap[tz], corrected: quickMap[tz] };
  return { tz: null };
}

/* ---- South-Indian 4×4 layout ---- */
const SOUTH_LAYOUT: Array<{ sign: number; row: number; col: number }> = [
  { sign: 11, row: 0, col: 0 }, // Pisces
  { sign: 0, row: 0, col: 1 }, // Aries
  { sign: 1, row: 0, col: 2 }, // Taurus
  { sign: 2, row: 0, col: 3 }, // Gemini
  { sign: 10, row: 1, col: 0 }, // Aquarius
  { sign: 3, row: 1, col: 3 }, // Cancer
  { sign: 9, row: 2, col: 0 }, // Capricorn
  { sign: 4, row: 2, col: 3 }, // Leo
  { sign: 8, row: 3, col: 0 }, // Sagittarius
  { sign: 7, row: 3, col: 1 }, // Scorpio
  { sign: 6, row: 3, col: 2 }, // Libra
  { sign: 5, row: 3, col: 3 }, // Virgo
];

/* 3-letter planet labels */
const PLANET_ABBR: Record<string, string> = {
  Sun: 'Sun',
  Moon: 'Moo',
  Mercury: 'Mer',
  Venus: 'Ven',
  Mars: 'Mar',
  Jupiter: 'Jup',
  Saturn: 'Sat',
  Rahu: 'Rah',
  Ketu: 'Ket',
  Uranus: 'Ura',
  Neptune: 'Nep',
  Pluto: 'Plu',
};

/* ---- Panchanga helpers ---- */
const NAK_NAMES = [
  'Ashwini',
  'Bharani',
  'Krittika',
  'Rohini',
  'Mrigashira',
  'Ardra',
  'Punarvasu',
  'Pushya',
  'Ashlesha',
  'Magha',
  'Purva Phalguni',
  'Uttara Phalguni',
  'Hasta',
  'Chitra',
  'Swati',
  'Vishakha',
  'Anuradha',
  'Jyeshtha',
  'Mula',
  'Purva Ashadha',
  'Uttara Ashadha',
  'Shravana',
  'Dhanishta',
  'Shatabhisha',
  'Purva Bhadrapada',
  'Uttara Bhadrapada',
  'Revati',
];
const LORD_SEQ = [
  'Ketu',
  'Venus',
  'Sun',
  'Moon',
  'Mars',
  'Rahu',
  'Jupiter',
  'Saturn',
  'Mercury',
];
const DEG_PER_NAK = 360 / 27;
const DEG_PER_PADA = DEG_PER_NAK / 4; // 3°20′
const TITHI_15 = [
  'Pratipada',
  'Dvitiya',
  'Tritiya',
  'Chaturthi',
  'Panchami',
  'Shashthi',
  'Saptami',
  'Ashtami',
  'Navami',
  'Dashami',
  'Ekadashi',
  'Dwadashi',
  'Trayodashi',
  'Chaturdashi',
  'Purnima',
];
const TITHI_15_KRISHNA_LAST = 'Amavasya';
const YOGAS_27 = [
  'Vishkumbha',
  'Preeti',
  'Ayushman',
  'Saubhagya',
  'Shobhana',
  'Atiganda',
  'Sukarma',
  'Dhriti',
  'Shoola',
  'Ganda',
  'Vriddhi',
  'Dhruva',
  'Vyaghata',
  'Harshana',
  'Vajra',
  'Siddhi',
  'Vyatipata',
  'Variyan',
  'Parigha',
  'Shiva',
  'Siddha',
  'Sadhya',
  'Shubha',
  'Shukla',
  'Brahma',
  'Indra',
  'Vaidhriti',
];
const KARANA_ROT = [
  'Bava',
  'Balava',
  'Kaulava',
  'Taitila',
  'Garaja',
  'Vanija',
  'Vishti',
];
const KARANA_END = ['Shakuni', 'Chatushpada', 'Naga'];
function jdToDate(jd_ut: number) {
  const ms = (jd_ut - 2440587.5) * 86400000;
  return new Date(ms);
}
function nakForDeg(deg: number) {
  const L = norm360(deg);
  const idx = Math.floor(L / DEG_PER_NAK);
  const within = L - idx * DEG_PER_NAK;
  const pada = Math.floor(within / DEG_PER_PADA) + 1;
  const lord = LORD_SEQ[idx % 9];
  return { index: idx, name: NAK_NAMES[idx], pada, lord };
}
function panchangaFrom(out: ChartOut | null) {
  if (!out) return null;
  const sun = out.positions['Sun'];
  const moon = out.positions['Moon'];
  if (!Number.isFinite(sun) || !Number.isFinite(moon)) return null;
  const birthUTC = jdToDate(out.jd_ut);
  const vara = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: out.timezone,
  }).format(birthUTC);
  const diff = norm360(moon - sun);
  const tithiNum = Math.floor(diff / 12) + 1; // 1..30
  const paksha = tithiNum <= 15 ? 'Shukla' : 'Krishna';
  const idx15 = (tithiNum - 1) % 15;
  const tithiName =
    paksha === 'Shukla'
      ? TITHI_15[idx15]
      : idx15 === 14
        ? TITHI_15_KRISHNA_LAST
        : TITHI_15[idx15];
  const nk = nakForDeg(moon);
  const yogaAngle = norm360(moon + sun);
  const yogaIdx = Math.floor(yogaAngle / DEG_PER_NAK);
  const yogaName = YOGAS_27[yogaIdx];
  const karIdx = Math.floor(diff / 6);
  let karanaName = '';
  if (karIdx === 0) karanaName = 'Kimstughna';
  else if (karIdx >= 57) karanaName = KARANA_END[karIdx - 57];
  else karanaName = KARANA_ROT[(karIdx - 1) % 7];
  return {
    vara,
    tithiNum,
    tithiName,
    paksha,
    nakshatra: nk.name,
    pada: nk.pada,
    yoga: yogaName,
    karana: karanaName,
  };
}

/* ---- Aspects, include Ascendant ---- */
const ASPECTS_DEF: Array<{ name: string; angle: number; orb: number }> = [
  { name: 'Conjunction', angle: 0, orb: 6 },
  { name: 'Opposition', angle: 180, orb: 6 },
  { name: 'Trine', angle: 120, orb: 5 },
  { name: 'Square', angle: 90, orb: 5 },
  { name: 'Sextile', angle: 60, orb: 4 },
];
function angDiff(a: number, b: number) {
  const d = Math.abs(norm360(a) - norm360(b));
  return Math.min(d, 360 - d);
}
function deriveAscAspects(out: ChartOut): AspectPair[] {
  const asc = out.ascendant;
  const pairs: AspectPair[] = [];
  const names = Object.keys(out.positions);
  for (const n of names) {
    const deg = out.positions[n];
    if (!Number.isFinite(deg)) continue;
    const d = angDiff(asc, deg);
    for (const A of ASPECTS_DEF) {
      if (Math.abs(d - A.angle) <= A.orb) {
        pairs.push({
          a: 'Ascendant',
          b: n,
          type: A.name,
          delta: +(d - A.angle).toFixed(2),
        });
        break;
      }
    }
  }
  return pairs;
}
function mergeAspects(existing: AspectPair[], ascOnes: AspectPair[]) {
  const key = (p: AspectPair) => [p.a, p.type, p.b].join('|');
  const m = new Map<string, AspectPair>();
  for (const p of existing) m.set(key(p), p);
  for (const p of ascOnes) m.set(key(p), p);
  return Array.from(m.values());
}
function calculateChart({
  name,
  place,
  lat,
  lon,
  date,
  time,
  timezone,
  houseSystem,
}) {
  // This is a stub. Replace with your real calculation logic.
  // For now, return dummy output so the report renders.
  return {
    engine: 'DemoEngine',
    jd_ut: 2451545.0,
    lstHours: 12.0,
    ascendant: 100,
    d9Ascendant: 120,
    positions: { Sun: 10, Moon: 20, Mercury: 30 },
    d9Positions: { Sun: 12, Moon: 22, Mercury: 32 },
    timezone: timezone || 'UTC',
    sunriseISO: new Date().toISOString(),
    sunsetISO: new Date().toISOString(),
    nakTable: [
      {
        body: 'Sun',
        sign: 'Leo',
        deg: 10,
        nakshatra: 'Magha',
        pada: 2,
        lord: 'Ketu',
      },
    ],
    aspects: [],
    dasha: [
      {
        lord: 'Sun',
        startISO: new Date().toISOString(),
        endISO: new Date().toISOString(),
      },
    ],
  };
}

/* =========================
   Page Component
   ========================= */
export default function Home() {
  /* Global style + print CSS */
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      :root { --cp-font: 16px; --cell-size: 140px; }
      body { color:#111; }
      input, select, button { font-size: var(--cp-font) !important; padding: 10px 12px !important; }
      label > div:first-child { font-size: 14px !important; }
      .card { background:#fff; border-radius:16px; box-shadow:0 2px 8px rgba(0,0,0,.06); padding:16px; }
      .avoid-break { break-inside: avoid; page-break-inside: avoid; }
      .print-only { display:none; }
      .page-section { margin-top:16px; }
      .section-title { font-size:20px; font-weight:900; margin: 6px 0 10px; }

      /* South-Indian chart visuals (screen) */
      .si-cell { border:2.2px solid #111; border-radius:12px; background:#fff; overflow:hidden; }
      .si-label { font-size:17px; font-weight:900; letter-spacing:.2px; }
      .si-chip { font-size:16px; padding:4px 10px; border:2px solid #111; border-radius:10px; font-weight:800; background:#fff; }
      .si-chip-asc { background:#fff1f2; border-color:#b91c1c; color:#b91c1c; font-weight:900; }

      /* D1 & D9 wrapper — side-by-side with a fixed spacer column */
      .charts-row.two-up {
        display: grid;
        grid-template-columns: 1fr minmax(28px, 40px) 1fr; /* middle column is a hard spacer */
        column-gap: 0; row-gap: 0;
        align-items: start;
        margin-top: 12px;
      }
      .charts-row.two-up > .card:nth-child(1) { grid-column: 1; }
      .charts-row.two-up > .card:nth-child(2) { grid-column: 3; }

      /* Floating export toolbar (screen only) */
      .export-bar {
        position: fixed; right: 16px; bottom: 16px;
        display: flex; gap: 8px; align-items: center;
        background: rgba(255,255,255,.95);
        border: 1px solid #ddd; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,.08);
        padding: 10px; z-index: 9999;
      }
      .export-bar button { border: 1px solid #ddd; background: #fff; padding: 8px 12px; border-radius: 8px; }

      @page { size: A4; margin: 12mm; }
      @media print {
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body * { visibility: hidden !important; }
        #print-root, #print-root * { visibility: visible !important; }
        #print-root { position: absolute; left: 0; top: 0; width: 100%; font-size: 14.5pt; }
        .no-print { display: none !important; }
        .print-only { display: block !important; }
        .export-bar { display: none !important; }
        .page-section { page-break-before: always; }
        .page-section.first { page-break-before: avoid; }
        .card { box-shadow: none !important; border: 2px solid #000; }

        /* Side-by-side charts on print + slightly smaller cells */
        .charts-row.two-up { grid-template-columns: 1fr minmax(20px,20px) 1fr !important; }
        :root { --cell-size: 130px; }

        .si-cell { border:3px solid #000 !important; overflow:hidden !important; }
        .si-label { font-size:17pt !important; font-weight:900 !important; }
        .si-chip { font-size:16pt !important; border:3px solid #000 !important; }
        .si-chip-asc { background:#ffe5e8 !important; border-color:#000 !important; color:#000 !important; }

        .charts-grid { break-inside: avoid; page-break-inside: avoid; }
        .page-logo { text-align:center; margin: 0 0 10px; }
        .page-logo img { display:block; margin:0 auto; }
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  /* Form state (blank defaults) */
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [lat, setLat] = useState<number | ''>('');
  const [lon, setLon] = useState<number | ''>('');
  const [year, setYear] = useState<number | ''>('');
  const [month, setMonth] = useState<number | ''>('');
  const [day, setDay] = useState<number | ''>('');
  const [hour12, setHour12] = useState<number | ''>('');
  const [minute, setMinute] = useState<number | ''>('');
  const [second, setSecond] = useState<number | ''>('');
  const [ampm, setAmpm] = useState<'AM' | 'PM' | ''>('');
  const [timezone, setTimezone] = useState('');
  const [tzSelect, setTzSelect] = useState<string>('');
  const [houseSystem, setHouseSystem] = useState('P');

  const [consent, setConsent] = useState<boolean | null>(null); // default = neither selected

  const [email, setEmail] = useState('');

  // Keep selected day valid when month/year changes
  useEffect(() => {
    if (day === '' || year === '' || month === '') return;
    const max = daysInMonth(Number(year), Number(month));
    if (Number(day) > max) setDay(max);
  }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timezone select vs custom
  useEffect(() => {
    if (!timezone) {
      setTzSelect('');
      return;
    }
    setTzSelect(TIMEZONES.includes(timezone) ? timezone : 'CUSTOM');
  }, [timezone]);

  // Geocoding & results
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<GeoHit[]>([]);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Chart
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState<ChartOut | null>(null);
  const [err, setErr] = useState<string | ApiError | null>(null);

const { summary, interpretation } = useMemo(() => {
  if (!out) return { summary: null, interpretation: null };

  const baseSummary = generateSummary(out);

  // 1. Get today's date
  const today = new Date();

  // 2. Find the dasha that is active RIGHT NOW
  const currentDashaObject = out?.dasha?.find((period: any) => {
    const startDate = new Date(period.startISO);
    const endDate = new Date(period.endISO);
    return today >= startDate && today <= endDate;
  });

  // 3. Fallback: If for some reason dates don't match, use the first one 
  // (though the logic above should find the real current one)
  const planetName = currentDashaObject?.lord || out?.dasha?.[0]?.lord || "Unknown";

  const fullSummary = {
    ...baseSummary,
    currentDasa: planetName
  };

  const text = generateInterpretation(fullSummary);
  return { summary: fullSummary, interpretation: text };
}, [out]);

// Note: Ensure your Page 7 refers to the 'interpretation' variable created above.
  
  const printRef = useRef<HTMLDivElement>(null);

  // Prevent any global click -> print from hijacking our Download button
  useEffect(() => {
    const handler = (ev: Event) => {
      const target = ev.target as Element | null;
      if (!target) return;
      // only care about clicks inside the export bar
      if (!target.closest('.export-bar')) return;

      // If the click is on the Download HTML button, do download and stop everything else
      if (target.closest('#btn-download-html')) {
        ev.preventDefault();
        ev.stopPropagation();
        // @ts-ignore
        ev.stopImmediatePropagation?.();
        try {
          downloadHTML();
        } catch (e) {
          console.error(e);
        }
      }
    };
    document.addEventListener('click', handler, true); // capture phase
    return () => document.removeEventListener('click', handler, true);
  }, []);

  // --- Hard stop: prevent any global click -> print when pressing Download (HTML) ---
  useEffect(() => {
    function handleCapture(ev: Event) {
      const t = ev.target as Element | null;
      if (!t) return;
      // Only care about clicks coming from inside the export bar
      const bar = t.closest?.('.export-bar');
      if (!bar) return;

      // If the click is on (or inside) the Download HTML button, run download and kill the event
      const onDownload = t.closest?.('#btn-download-html');
      if (onDownload) {
        ev.preventDefault();
        // @ts-ignore
        ev.stopImmediatePropagation?.();
        ev.stopPropagation();

        try {
          // Call your hardened download function
          // (use whatever name you actually kept: safeDownloadHTML / downloadHTML)
          safeDownloadHTML && safeDownloadHTML();
        } catch (e) {
          console.error('download failed:', e);
        }
        return; // nothing else fires
      }
    }

    // Capture phase so we run BEFORE any other listeners
    document.addEventListener('click', handleCapture, true);
    document.addEventListener('pointerup', handleCapture, true);
    document.addEventListener('mouseup', handleCapture, true);

    return () => {
      document.removeEventListener('click', handleCapture, true);
      document.removeEventListener('pointerup', handleCapture, true);
      document.removeEventListener('mouseup', handleCapture, true);
    };
  }, []);

  function resetAll() {
    setName('');
    setPlace('');
    setLat('');
    setLon('');
    setYear('');
    setMonth('');
    setDay('');
    setHour12('');
    setMinute('');
    setSecond('');
    setAmpm('');
    setTimezone('');
    setTzSelect('');
    setHouseSystem('P');
    setHits([]);
    setGeoError(null);
    setOut(null);
    setErr(null);
  }
  useEffect(() => {
    resetAll();
  }, []); // start blank

  function useMyTimezone() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) setTimezone(tz);
    } catch {}
  }
  function useMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('Geolocation not supported in this browser.');
      return;
    }
    setGeoError(null);
    setSearching(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLat(Number(latitude.toFixed(6)));
        setLon(Number(longitude.toFixed(6)));
        setSearching(false);
      },
      (err) => {
        setSearching(false);
        setGeoError(
          err?.message || 'Could not read location (permission denied?).'
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }
  async function doGeocode() {
    setGeoError(null);
    setSearching(true);
    setHits([]);
    try {
      if (!place.trim()) throw new Error('Type a city/place first.');
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(place)}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Geocode failed');
      const list: GeoHit[] = json?.results || [];
      setHits(list);
      if (json?.top) {
        setPlace(json.top.name);
        setLat(Number(json.top.lat.toFixed(6)));
        setLon(Number(json.top.lon.toFixed(6)));
      }
    } catch (e: any) {
      setGeoError(e?.message || String(e));
    } finally {
      setSearching(false);
    }
  }
  // Auto-geocode if place typed & coords empty (gentle)
  useEffect(() => {
    const should = place.trim() && (lat === '' || lon === '');
    if (!should) return;
    const id = window.setTimeout(() => {
      (async () => {
        try {
          const res = await fetch(
            `/api/geocode?q=${encodeURIComponent(place)}`,
            { cache: 'no-store' }
          );
          const json = await res.json();
          if (res.ok && json?.top) {
            setPlace(json.top.name);
            setLat(Number(json.top.lat.toFixed(6)));
            setLon(Number(json.top.lon.toFixed(6)));
            setHits(json.results || []);
          }
        } catch {}
      })();
    }, 600);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place]);

  const yearOptions = useMemo(() => range(1800, 2100), []);
  const dateStr = useMemo(() => {
    if (!year || !month || !day) return '';
    return `${year}-${pad2(Number(month))}-${pad2(Number(day))}`;
  }, [year, month, day]);
  const timeStr = useMemo(() => {
    if (hour12 === '' || minute === '' || second === '' || ampm === '')
      return '';
    let h = Number(hour12);
    if (ampm === 'AM') h = h === 12 ? 0 : h;
    if (ampm === 'PM') h = h === 12 ? 12 : h + 12;
    return `${pad2(h)}:${pad2(Number(minute))}:${pad2(Number(second))}`;
  }, [hour12, minute, second, ampm]);

  async function generateChart(e?: React.FormEvent) {
    e?.preventDefault();
    setErr(null);
    setOut(null);
    setLoading(true);
    try {
      if (!name.trim()) {
        setErr({ error: 'Please enter a Name.' });
        return;
      }
      if (!place.trim()) {
        setErr({
          error: 'Please enter a Place (e.g., Park Ridge, Illinois, USA).',
        });
        return;
      }
      if (lat === '' || lon === '') {
        setErr({
          error:
            'Please provide latitude and longitude (use Geocode, Use my location, or type them).',
        });
        return;
      }
      if (!dateStr) {
        setErr({ error: 'Please set Day/Month/Year using the dropdowns.' });
        return;
      }
      if (!timeStr) {
        setErr({
          error: 'Please set Time (HH:MM:SS & AM/PM) using the dropdowns.',
        });
        return;
      }
      const { tz, corrected } = normalizeTimezone(timezone);
      if (!tz) {
        setErr({
          error:
            'Unrecognized timezone. Choose from the list or type a valid IANA zone like "America/Chicago", "Asia/Kolkata".',
        });
        return;
      }
      if (corrected && corrected !== timezone) setTimezone(corrected);

      // Log user input (Fire-and-forget style to prevent UI errors)
      fetch('https://chandraprabha-production.up.railway.app/log-chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, place, lat, lon, date: dateStr, time: timeStr, timezone: tz }),
      }).catch(() => console.log("Logging skipped")); 

      const res = await fetch('/api/chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dateStr,
          time: timeStr,
          timezone: tz,
          lat: Number(lat),
          lon: Number(lon),
          houseSystem,
        }),
      });

      let json: any = null;
      try {
        json = await res.json();
      } catch {}

      if (!res.ok) {
        setErr(json && json.error ? (json as ApiError) : { error: 'Chart error' });
        return;
      }

      setErr(null);
      setOut(json as ChartOut);

      // 5-second delay
      setTimeout(() => {
        const element = document.getElementById('report');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 5000);

    } catch (e: any) {
      setErr({ error: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  } // end generateChart

  const panchanga = useMemo(() => panchangaFrom(out), [out]);

  const filteredHits = useMemo(() => {
    const preferred = hits.filter(
      (h) =>
        (h.class === 'place' &&
          [
            'city',
            'town',
            'village',
            'hamlet',
            'suburb',
            'neighbourhood',
            'municipality',
            'county',
          ].includes(h.type)) ||
        (h.class === 'boundary' && ['administrative'].includes(h.type))
    );
    return preferred.length ? preferred : hits;
  }, [hits]);

  /* ---- Chart component (bold; uses CSS var --cell-size) ---- */
  function SouthIndianChart({
    title,
    mode,
    ascDeg,
    positions,
  }: {
    title: string;
    mode: 'sign' | 'bhava';
    ascDeg?: number;
    positions: Record<string, number>;
  }) {
    const boxes = Array.from({ length: 12 }).map((_, i) => ({
      sign: i,
      signAbbr: SIGN_ABBR[i],
      label: '',
      planets: [] as string[],
    }));
    const ascSign = Math.floor(norm360(ascDeg ?? 0) / 30);

    if (mode === 'sign') {
      boxes.forEach((b) => (b.label = b.signAbbr));
      Object.entries(positions).forEach(([name, deg]) => {
        const s = Math.floor(norm360(deg) / 30);
        boxes[s].planets.push(PLANET_ABBR[name] ?? name);
      });
      if (typeof ascDeg === 'number' && Number.isFinite(ascDeg)) {
        const sAsc = Math.floor(norm360(ascDeg) / 30);
        boxes[sAsc].planets.unshift('ASC');
      }
    } else {
      boxes.forEach((b) => {
        const h = ((b.sign - ascSign + 12) % 12) + 1;
        b.label = `H${h}`;
      });
      Object.entries(positions).forEach(([name, deg]) => {
        const s = Math.floor(norm360(deg) / 30);
        const house = ((s - ascSign + 12) % 12) + 1;
        const idx = boxes.findIndex((bb) => bb.label === `H${house}`);
        if (idx >= 0) boxes[idx].planets.push(PLANET_ABBR[name] ?? name);
      });
      const idxH1 = boxes.findIndex((bb) => bb.label === 'H1');
      if (idxH1 >= 0) boxes[idxH1].planets.unshift('ASC');
    }

    const grid: Array<Array<null | (typeof boxes)[number]>> = Array.from({
      length: 4,
    }).map(() => Array(4).fill(null));
    SOUTH_LAYOUT.forEach(({ sign, row, col }) => {
      grid[row][col] = boxes[sign];
    });

    return (
      <div className="card avoid-break">
        <div style={{ fontWeight: 800, marginBottom: 10, fontSize: 18 }}>
          {title}
        </div>
        <div
          className="charts-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, var(--cell-size))',
            gridTemplateRows: 'repeat(4, var(--cell-size))',
            gap: 10,
            justifyContent: 'center',
          }}
        >
          {grid.map((row, r) =>
            row.map((cell, c) => (
              <div
                key={`${r}-${c}`}
                className="si-cell"
                style={{
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  background: '#fff',
                }}
              >
                {cell ? (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span className="si-label">{cell.label}</span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        alignItems: 'center',
                        minHeight: 38,
                      }}
                    >
                      {(() => {
                        const n = cell.planets.length;
                        if (n === 0)
                          return (
                            <span
                              className="si-label"
                              style={{ fontWeight: 600, opacity: 0.9 }}
                            >
                              —
                            </span>
                          );

                        const fontPx =
                          n >= 7 ? 10 : n >= 5 ? 12 : n >= 4 ? 14 : 16;
                        const pad = fontPx <= 12 ? '2px 6px' : '4px 8px';
                        return cell.planets.map((p, i) => (
                          <span
                            key={i}
                            className={`si-chip ${
                              p === 'ASC' ? 'si-chip-asc' : ''
                            }`}
                            style={{
                              fontSize: fontPx,
                              padding: pad,
                              lineHeight: 1,
                            }}
                          >
                            {p}
                          </span>
                        ));
                      })()}
                    </div>
                  </>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  /* -------- Exports -------- */
  function downloadText(filename: string, mime: string, text: string) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadJSON() {
    if (!out) return;
    downloadText(
      'chart.json',
      'application/json;charset=utf-8',
      JSON.stringify(payload, null, 2)
    );
  }
  function downloadCSV() {
    if (!out) return;
    const d1Names = [
      'Ascendant',
      'Sun',
      'Moon',
      'Mercury',
      'Venus',
      'Mars',
      'Jupiter',
      'Saturn',
      'Rahu',
      'Ketu',
      'Uranus',
      'Neptune',
      'Pluto',
    ];
    const d1Rows = d1Names
      .map((n) => {
        const deg = n === 'Ascendant' ? out.ascendant : out.positions[n];
        if (deg === undefined) return null;
        return [n, fmtSignDeg(deg), fmtDMS(deg)].join(',');
      })
      .filter(Boolean)
      .join('\n');
    downloadText(
      'longitudes_d1.csv',
      'text/csv;charset=utf-8',
      'Body,SignLongitude,DMS\n' + d1Rows
    );

    const d9Rows = d1Names
      .map((n) => {
        const deg = n === 'Ascendant' ? out.d9Ascendant : out.d9Positions[n];
        if (deg === undefined) return null;
        return [n, fmtSignDeg(deg), fmtDMS(deg)].join(',');
      })
      .filter(Boolean)
      .join('\n');
    downloadText(
      'longitudes_d9.csv',
      'text/csv;charset=utf-8',
      'Body,SignLongitude,DMS\n' + d9Rows
    );

    const nakRows = out.nakTable
      .map((r) =>
        [r.body, r.sign, fmtSignDeg(r.deg), r.nakshatra, r.pada, r.lord].join(
          ','
        )
      )
      .join('\n');
    downloadText(
      'nakshatra.csv',
      'text/csv;charset=utf-8',
      'Body,Sign,Longitude,Nakshatra,Pada,Ruler\n' + nakRows
    );

    const dashaRows = out.dasha
      .map((d) => [d.lord, d.startISO, d.endISO].join(','))
      .join('\n');
    downloadText(
      'vimshottari_dasha.csv',
      'text/csv;charset=utf-8',
      'Lord,StartISO,EndISO\n' + dashaRows
    );
  }
  function svgForSouthChart(
    title: string,
    mode: 'sign' | 'bhava',
    ascDeg: number,
    positions: Record<string, number>
  ) {
    const boxes = Array.from({ length: 12 }).map((_, i) => ({
      sign: i,
      label: '',
      planets: [] as string[],
    }));
    const ascSign = Math.floor(norm360(ascDeg) / 30);
    if (mode === 'sign') {
      boxes.forEach((b) => (b.label = SIGN_ABBR[b.sign]));
      Object.entries(positions).forEach(([name, deg]) => {
        const s = Math.floor(norm360(deg) / 30);
        boxes[s].planets.push(PLANET_ABBR[name] ?? name);
      });
      const sAsc = Math.floor(norm360(ascDeg) / 30);
      boxes[sAsc].planets.unshift('ASC');
    } else {
      boxes.forEach((b) => {
        const h = ((b.sign - ascSign + 12) % 12) + 1;
        b.label = `H${h}`;
      });
      Object.entries(positions).forEach(([name, deg]) => {
        const s = Math.floor(norm360(deg) / 30);
        const house = ((s - ascSign + 12) % 12) + 1;
        const idx = boxes.findIndex((bb) => bb.label === `H${house}`);
        if (idx >= 0) boxes[idx].planets.push(PLANET_ABBR[name] ?? name);
      });
      const idxH1 = boxes.findIndex((bb) => bb.label === 'H1');
      if (idxH1 >= 0) boxes[idxH1].planets.unshift('ASC');
    }
    const cell = 140,
      gap = 10,
      pad = 24;
    const width = pad * 2 + gap * 3 + cell * 4;
    const height = pad * 2 + gap * 3 + cell * 4;
    const rects: string[] = [];
    const labels: string[] = [];
    const texts: string[] = [];
    for (const { sign, row, col } of SOUTH_LAYOUT) {
      const b = boxes[sign];
      const x = pad + col * (cell + gap);
      const y = pad + row * (cell + gap);
      rects.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="12" ry="12" fill="#ffffff" stroke="#000000" stroke-width="3"/>`
      );
      labels.push(
        `<text x="${x + 10}" y="${
          y + 26
        }" font-family="system-ui,-apple-system,Segoe UI,Roboto" font-size="18" font-weight="700" fill="#000000">${
          b.label
        }</text>`
      );
      const line = b.planets.length ? b.planets.join(' ') : '—';
      texts.push(
        `<text x="${x + 10}" y="${
          y + 56
        }" font-family="system-ui,-apple-system,Segoe UI,Roboto" font-size="18" fill="#000000">${line}</text>`
      );
    }
    const titleText = `<text x="${
      width / 2
    }" y="20" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto" font-size="20" font-weight="700">${title}</text>`;
    return `<?xml version="1.0" encoding="UTF-8"?> <svg width="${width}" height="${
      height + 30
    }" viewBox="0 0 ${width} ${
      height + 30
    }" xmlns="http://www.w3.org/2000/svg"> <rect x="0" y="0" width="${width}" height="${
      height + 30
    }" fill="#ffffff"/> ${titleText} ${rects.join('\n')} ${labels.join(
      '\n'
    )} ${texts.join('\n')} </svg>`;
  }
  async function svgToPngAndDownload(svgText: string, filename: string) {
    const svgUrl =
      'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    const img = new Image();
    const done = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
    });
    img.src = svgUrl;
    await done;
    const canvas = document.createElement('canvas');
    canvas.width = (img as any).width;
    canvas.height = (img as any).height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }
  async function exportChartsSVG() {
    if (!out) return;
    const d1svg = svgForSouthChart(
      `Rāśi (D1) — Signs${name ? ` • ${name}` : ''}`,
      'sign',
      out.ascendant,
      out.positions
    );
    const d9svg = svgForSouthChart(
      `Navāṁśa (D9) — Signs${name ? ` • ${name}` : ''}`,
      'sign',
      out.d9Ascendant,
      out.d9Positions
    );
    const bhsvg = svgForSouthChart(
      `Bhāva (Houses from Lagna)${name ? ` • ${name}` : ''}`,
      'bhava',
      out.ascendant,
      out.positions
    );
    downloadText('chart_d1.svg', 'image/svg+xml;charset=utf-8', d1svg);
    downloadText('chart_d9.svg', 'image/svg+xml;charset=utf-8', d9svg);
    downloadText('chart_bhava.svg', 'image/svg+xml;charset=utf-8', bhsvg);
  }
  async function exportChartsPNG() {
    if (!out) return;
    const d1svg = svgForSouthChart(
      `Rāśi (D1) — Signs${name ? ` • ${name}` : ''}`,
      'sign',
      out.ascendant,
      out.positions
    );
    const d9svg = svgForSouthChart(
      `Navāṁśa (D9) — Signs${name ? ` • ${name}` : ''}`,
      'sign',
      out.d9Ascendant,
      out.d9Positions
    );
    const bhsvg = svgForSouthChart(
      `Bhāva (Houses from Lagna)${name ? ` • ${name}` : ''}`,
      'bhava',
      out.ascendant,
      out.positions
    );
    await svgToPngAndDownload(d1svg, 'chart_d1.png');
    await svgToPngAndDownload(d9svg, 'chart_d9.png');
    await svgToPngAndDownload(bhsvg, 'chart_bhava.png');
  }
  function handleDownloadHTML() {
    try {
      safeDownloadHTML();
    } catch (err) {
      console.error('download failed:', err);
    }
  }

  // Hardened download (replaces your old downloadHTML)
  function safeDownloadHTML() {
    const root = document.getElementById('print-root');
    if (!root) return;

    // Collect inline styles so offline file looks the same
    const styles = Array.from(document.querySelectorAll('style'))
      .map((s) => s.innerHTML)
      .join('\n');

    const title = `Vedic Astrology Report${name ? ' - ' + name : ''}`;
    const filename = `report${
      name ? '_' + name.replace(/\s+/g, '_') : ''
    }.html`;

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <style>${styles}</style>
</head>
<body>
  <div id="print-root">${root.innerHTML}</div>
</body>
</html>`.trim();

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    // Create a real <a> and fire only its click (no form submit, no bubbling)
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.target = '_self';

    // do not attach to DOM to avoid layout/bubbling quirks
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });

    // Trigger the download on the microtask queue to dodge any shared click handlers
    setTimeout(() => {
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 0);
  }

  function handleDownloadHTML() {
    try {
      console.log('[Download] clicked');
      downloadHTML();
    } catch (err) {
      console.error('downloadHTML failed:', err);
    }
  }

  function downloadHTML() {
    const root = document.getElementById('print-root');
    if (!root) return;

    // Collect inline styles so the file looks identical offline
    const styles = Array.from(document.querySelectorAll('style'))
      .map((s) => s.innerHTML)
      .join('\n');

    const title = `Vedic Astrology Report${name ? ' - ' + name : ''}`;
    const filename = `report${
      name ? '_' + name.replace(/\s+/g, '_') : ''
    }.html`;

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <style>${styles}</style>
</head>
<body>
  <div id="print-root">${root.innerHTML}</div>
</body>
</html>`.trim();

    // Blob download path
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    // Create an anchor and click it programmatically
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.target = '_self'; // keep in same tab to avoid weird browser behaviors
    document.body.appendChild(a);

    console.log('[Download] starting blob download:', filename);
    a.click();

    // Cleanup
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
    @media print {
      /* Hide UI chrome on paper */
      header { display: none !important; }
      .export-bar, .screen-only { display: none !important; }
      .print-only { display: block !important; }
      .page-section { break-after: page; page-break-after: always; }
      .page-section:last-child { break-after: auto; page-break-after: auto; }
      .card, .avoid-break { break-inside: avoid !important; page-break-inside: avoid !important; }
      .si-grid {
        grid-template-columns: repeat(4, 1fr) !important;
        grid-auto-rows: 1fr !important;
        height: auto !important;
        overflow: visible !important;
      }
      svg { overflow: visible !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  /* Form state (blank defaults) 
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [lat, setLat] = useState<number | ''>('');
  const [lon, setLon] = useState<number | ''>('');
  const [year, setYear] = useState<number | ''>('');
  const [month, setMonth] = useState<number | ''>('');
  const [day, setDay] = useState<number | ''>('');
  const [hour12, setHour12] = useState<number | ''>('');
  const [minute, setMinute] = useState<number | ''>('');
  const [second, setSecond] = useState<number | ''>('');
  const [ampm, setAmpm] = useState<'AM' | 'PM' | ''>('');
  const [timezone, setTimezone] = useState('');
  const [tzSelect, setTzSelect] = useState<string>('');*/

  /*Build chart object from form state
  const chart = calculateChart({
    name,
    place,
    lat,
    lon,
    year,
    month,
    day,
    hour12,
    minute,
    second,
    ampm,
    timezone,
  });
  */
  // ✅ Generate summary + interpretation

  // === Save PDF with per-page header (logo + title) ===

  /* =========================
     UI
     ========================= */

  return (
    <>
      <PdfExport />
      <main
        style={{
          minHeight: '100vh',
          background: '#f7f7f8',
          fontSize: 16,
          lineHeight: 1.6,
        }}
      >
        <style>{`
  @media print {
    /* Hide UI chrome on paper */
    header { display: none !important; }
    .export-bar, .screen-only { display: none !important; }
    .print-only { display: block !important; }

    /* One PDF/print page per section (last section won't add a blank page) */
    .page-section { break-after: page; page-break-after: always; }
    .page-section:last-child { break-after: auto; page-break-after: auto; }

    /* Keep big blocks intact; avoid mid-page splits */
    .card, .avoid-break { break-inside: avoid !important; page-break-inside: avoid !important; }

    /* Charts: prevent clipping */
    .si-grid {
      grid-template-columns: repeat(4, 1fr) !important;
      grid-auto-rows: 1fr !important;
      height: auto !important;
      overflow: visible !important;
    }
    svg { overflow: visible !important; }

    /* Preserve colors */
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`}</style>
        <div className="mt-4 text-sm text-gray-800">
          <p className="mt-2">
            <a
              href="https://docs.google.com/forms/d/e/1FAIpQLSfggwnVAIEcqgxqU6G5OB4YSApgYOlyCUAdjkJz-CKUPu2E-g/viewform"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            ></a>
          </p>
        </div>
        {/* Top header with centered logo (screen) */}
        <header
          style={{
            position: 'sticky',
            top: 0,
            background: 'rgba(255,255,255,.9)',
            backdropFilter: 'blur(6px)',
            borderBottom: '1px solid #eee',
          }}
        >
          <div
            style={{
              maxWidth: 1100,
              margin: '0 auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
            }}
          >
            <img
              src="/logo.png"
              alt="Chandra Prabha — Vedic Astrology"
              width={200}
              height={200}
              style={{ display: 'block', margin: '0 auto' }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <div
              style={{
                fontSize: 28,
                fontWeight: 'bold',
                color: '#333',
                marginTop: 6,
              }}
            >
              Jathakam
            </div>
          </div>
        </header>
        <div
          id="pdf-content"
          style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}
        >
          <form
            onSubmit={generateChart}
            className="card avoid-break"
            style={{ display: 'grid', gap: 12 }}
          >
            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}
            >
              <label>
                <div>Name</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Person's name (e.g., Durga)"
                  style={{
                    border: '1px solid #ddd',
                    padding: '8px 10px',
                    borderRadius: 8,
                    width: '100%',
                  }}
                />
              </label>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                alignItems: 'flex-start',
                marginBottom: '12px',
              }}
            >
              <label style={{ flex: '1 1 100%' }}>
                <div>Place</div>
                <input
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                  placeholder="City, State/Province, Country (e.g., Park Ridge, Illinois, USA)"
                  style={{
                    border: '1px solid #ddd',
                    padding: '8px 10px',
                    borderRadius: 8,
                    width: '100%',
                  }}
                />
              </label>

              <button
                type="button"
                disabled={searching}
                onClick={doGeocode}
                style={{
                  background: '#000',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 12px',
                  borderRadius: 8,
                }}
              >
                {searching ? 'Searching…' : 'Geocode'}
              </button>

              {/* Geocode results */}
              {filteredHits.length > 0 && (
                <div className="card avoid-break" style={{ marginTop: 16 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>
                    Geocode results (city/town first)
                  </div>
                  <ul style={{ display: 'grid', gap: 6 }}>
                    {filteredHits.map((h, i) => (
                      <li
                        key={i}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          alignItems: 'center',
                        }}
                      >
                        <span>{h.name}</span>
                        <button
                          onClick={() => {
                            setPlace(h.name);
                            setLat(Number(h.lat.toFixed(6)));
                            setLon(Number(h.lon.toFixed(6)));
                          }}
                          style={{
                            border: '1px solid #ddd',
                            padding: '6px 12px',
                            borderRadius: 8,
                            background: '#fff',
                          }}
                        >
                          Use
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="button"
                onClick={useMyLocation}
                style={{
                  border: '1px solid #ddd',
                  background: '#fff',
                  padding: '8px 12px',
                  borderRadius: 8,
                }}
              >
                Use my location
              </button>

              <button
                type="button"
                onClick={useMyTimezone}
                style={{
                  border: '1px solid #ddd',
                  background: '#fff',
                  padding: '8px 12px',
                  borderRadius: 8,
                }}
              >
                Use my timezone
              </button>

              <button
                type="button"
                onClick={resetAll}
                style={{
                  border: '1px solid #ddd',
                  background: '#fff',
                  padding: '8px 12px',
                  borderRadius: 8,
                }}
              >
                Reset
              </button>
            </div>

            <div
              style={{
                fontSize: '14px',
                color: '#111827',
                textAlign: 'center',
                marginTop: '16px',
                marginBottom: '16px',
                fontWeight: 'bold',
              }}
            >
              Click Geocode and scroll down to view matching places. Click “Use”
              to auto-fill Latitude and Longitude.
              <br />
              If no results appear, visit{' '}
              <a
                href="https://www.latlong.net"
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'underline', color: '#1d4ed8' }}
              >
                latlong.net
              </a>{' '}
              to obtain coordinates and paste them here manually.
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: 8,
              }}
            >
              <label>
                <div>Latitude</div>
                <input
                  type="number"
                  step="0.000001"
                  value={lat}
                  onChange={(e) =>
                    setLat(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  placeholder="e.g., 42.011233"
                  style={{
                    border: '1px solid #ddd',
                    padding: '8px 10px',
                    borderRadius: 8,
                    width: '100%',
                  }}
                />
              </label>
              <label>
                <div>Longitude</div>
                <input
                  type="number"
                  step="0.000001"
                  value={lon}
                  onChange={(e) =>
                    setLon(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  placeholder="e.g., -87.840603"
                  style={{
                    border: '1px solid #ddd',
                    padding: '8px 10px',
                    borderRadius: 8,
                    width: '100%',
                  }}
                />
              </label>

              <style>{`
             #print-root .si-grid { height: auto !important; overflow: visible !important; }
             #print-root svg       { overflow: visible !important; }
`}</style>

              <style>{`
              /* Keep SI charts full 4×4 and avoid clipping in the PDF capture */
          #print-root .si-grid {
           grid-template-columns: repeat(4, 1fr) !important;
           grid-auto-rows: 1fr !important;
           height: auto !important;
           overflow: visible !important;
  }
          #print-root svg {
           overflow: visible !important;
  }

  /* Make large blocks stay together across page breaks */
          #print-root .card,
          #print-root .page-section,
          #print-root .avoid-break {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
          overflow: visible !important;
  }

  /* Helper: vertical stack for charts (we'll use in Patch 2) */
  #print-root .charts-column { display: block; }
  #print-root .charts-column > * { margin-bottom: 16px; }

  /* First-page header (logo + title) */
  #print-root .report-header { text-align: center; margin: 8px 0 12px; }
  #print-root .report-header img {
    width: 140px; height: 140px; object-fit: contain;
    display: block; margin: 0 auto;
  }
  #print-root .report-title { font-weight: 900; font-size: 18px; margin-top: 6px; }
`}</style>

              {/* Date (DD/MM/YYYY) */}
              <div>
                <div>Date (DD/MM/YYYY)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <select
                    value={day === '' ? '' : Number(day)}
                    onChange={(e) =>
                      setDay(
                        e.target.value === '' ? '' : Number(e.target.value)
                      )
                    }
                    style={{
                      border: '1px solid #ddd',
                      padding: '8px 10px',
                      borderRadius: 8,
                    }}
                  >
                    <option value="">DD</option>
                    {range(
                      1,
                      daysInMonth(
                        typeof year === 'number' ? year : undefined,
                        typeof month === 'number' ? month : undefined
                      )
                    ).map((d) => (
                      <option key={d} value={d}>
                        {pad2(d)}
                      </option>
                    ))}
                  </select>
                  <span>/</span>
                  <select
                    value={month === '' ? '' : Number(month)}
                    onChange={(e) => {
                      setMonth(
                        e.target.value === '' ? '' : Number(e.target.value)
                      );
                    }}
                    style={{
                      border: '1px solid #ddd',
                      padding: '8px 10px',
                      borderRadius: 8,
                    }}
                  >
                    <option value="">MM</option>
                    {range(1, 12).map((m) => (
                      <option key={m} value={m}>
                        {pad2(m)}
                      </option>
                    ))}
                  </select>
                  <span>/</span>
                  <select
                    value={year === '' ? '' : Number(year)}
                    onChange={(e) => {
                      setYear(
                        e.target.value === '' ? '' : Number(e.target.value)
                      );
                    }}
                    style={{
                      border: '1px solid #ddd',
                      padding: '8px 10px',
                      borderRadius: 8,
                    }}
                  >
                    <option value="">YYYY</option>
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Time (HH:MM:SS + AM/PM) */}
              <div>
                <div>Time (HH:MM:SS)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <select
                    value={hour12 === '' ? '' : Number(hour12)}
                    onChange={(e) =>
                      setHour12(
                        e.target.value === '' ? '' : Number(e.target.value)
                      )
                    }
                    style={{
                      border: '1px solid #ddd',
                      padding: '8px 10px',
                      borderRadius: 8,
                    }}
                  >
                    <option value="">HH</option>
                    {range(1, 12).map((h) => (
                      <option key={h} value={h}>
                        {pad2(h)}
                      </option>
                    ))}
                  </select>
                  <span>:</span>
                  <select
                    value={minute === '' ? '' : Number(minute)}
                    onChange={(e) =>
                      setMinute(
                        e.target.value === '' ? '' : Number(e.target.value)
                      )
                    }
                    style={{
                      border: '1px solid #ddd',
                      padding: '8px 10px',
                      borderRadius: 8,
                    }}
                  >
                    <option value="">MM</option>
                    {range(0, 59).map((m) => (
                      <option key={m} value={m}>
                        {pad2(m)}
                      </option>
                    ))}
                  </select>
                  <span>:</span>
                  <select
                    value={second === '' ? '' : Number(second)}
                    onChange={(e) =>
                      setSecond(
                        e.target.value === '' ? '' : Number(e.target.value)
                      )
                    }
                    style={{
                      border: '1px solid #ddd',
                      padding: '8px 10px',
                      borderRadius: 8,
                    }}
                  >
                    <option value="">SS</option>
                    {range(0, 59).map((s) => (
                      <option key={s} value={s}>
                        {pad2(s)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={ampm}
                    onChange={(e) =>
                      setAmpm((e.target.value || '') as 'AM' | 'PM' | '')
                    }
                    style={{
                      border: '1px solid #ddd',
                      padding: '8px 10px',
                      borderRadius: 8,
                    }}
                  >
                    <option value="">AM/PM</option>
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </div>

              {/* Timezone */}
              <label>
                <div>Timezone</div>
                <select
                  value={tzSelect}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTzSelect(v);
                    if (v !== 'CUSTOM') setTimezone(v);
                  }}
                  style={{
                    border: '1px solid #ddd',
                    padding: '8px 10px',
                    borderRadius: 8,
                    width: '100%',
                  }}
                >
                  <option value="">Select timezone…</option>
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                  <option value="CUSTOM">Custom (type below)</option>
                </select>
                {tzSelect === 'CUSTOM' && (
                  <input
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    placeholder="e.g., America/Chicago"
                    style={{
                      border: '1px solid #ddd',
                      padding: '8px 10px',
                      borderRadius: 8,
                      width: '100%',
                      marginTop: 6,
                    }}
                  />
                )}
              </label>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 8,
                alignItems: 'end',
              }}
            >
              <label>
                <div>House System</div>
                <select
                  value={houseSystem}
                  onChange={(e) => setHouseSystem(e.target.value)}
                  style={{
                    border: '1px solid #ddd',
                    padding: '8px 10px',
                    borderRadius: 8,
                    width: '100%',
                  }}
                >
                  <option value="P">Placidus (P)</option>
                  <option value="W">Whole Sign (W)</option>
                  <option value="K">Koch (K)</option>
                  <option value="C">Campanus (C)</option>
                  <option value="E">Equal (E)</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="submit"
                disabled={loading}
                style={{
                  background: '#000',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 14px',
                  borderRadius: 8,
                }}
              >
                {loading ? 'Calculating…' : 'Generate Chart'}
              </button>

              <a
                href="mailto:pranag@yahoo.com?subject=Feedback on Jathakam"
                style={{
                  display: 'inline-block',
                  padding: '10px 14px',
                  borderRadius: 8,
                  backgroundColor: '#fffbe6',
                  color: '#1d4ed8', // blue text
                  fontWeight: 'bold',
                  textDecoration: 'underline',
                  border: '1px solid #facc15',
                }}
              >
                Click here to send your feedback
              </a>
            </div>

            {geoError && <div style={{ color: '#b91c1c' }}>{geoError}</div>}

            {err && (
              <div
                style={{
                  color: '#b91c1c',
                  background: '#fff',
                  border: '1px solid #fca5a5',
                  padding: 12,
                  borderRadius: 8,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {typeof err === 'string' ? err : err.error}
                </div>
                {typeof err === 'object' && (err as ApiError).details && (
                  <details style={{ fontSize: 14 }}>
                    <summary>Show technical details</summary>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify((err as ApiError).details, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}
            {/* ✅ Add this message block here */}
            <div
              style={{
                fontSize: '14px',
                color: '#111827',
                textAlign: 'center',
                marginBottom: '1rem',
                padding: '1rem',
                backgroundColor: '#f5f5f5',
                borderRadius: '8px',
                fontWeight: 'bold',
                lineHeight: '1.6',
              }}
            >
              <div style={{ fontSize: '16px', marginBottom: '0.5rem' }}>
                Welcome to Chandra Prabha.
              </div>
              For best results, use a desktop or laptop and add this app to your{' '}
              <em>Dock</em>.<br />
              iPad users: Tap <em>“Add to Home Screen”</em> in Safari for a
              native-like experience.
              <br />
              iPhone users: You may use this app for quick viewing, download, or
              print—but charts may appear truncated due to screen size.
            </div>
            {/* ✅ Message ends here */}
          </form>
        </div> {/* This closes id="pdf-content" */}
        {out && (
          <div id="print-root">
            {/* ========================= REPORT ========================= */}
            {/* ---------- PAGE 1: Summary + Pañchāṅga + D1 ---------- */}
            <section className="page-section first">
              {PRINT_LOGO_EACH_PAGE && (
                <div className="print-only page-logo">
                  <img
                    src="/logo.png"
                    width={140}
                    height={140}
                    alt="Chandra Prabha — Jathakam"
                  />
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 900,
                      marginTop: 6,
                    }}
                  >
                    Vedic Astrology Report
                  </div>
                </div>
              )}

              {/* Report header (always visible on page 1: screen + print) */}
              <div
                className="report-header"
                style={{ textAlign: 'center', margin: '0 0 12px' }}
              >
                <img
                  src="/logo.png"
                  alt="Chandra-Prabha"
                  width={140}
                  height={140}
                  style={{ display: 'block', margin: '0 auto' }}
                />
                <div style={{ fontSize: 32, fontWeight: 900, marginTop: 6 }}>
                  Jathakam-Insights
                </div>
              </div>

              {/* Intro + Summary + Panchanga */}
              <div className="card avoid-break" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 900 }}>User Input</div>
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 16,
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                    justifyContent: 'center',
                    maxWidth: 600,
                    marginLeft: 'auto',
                    marginRight: 'auto',
                  }}
                >
                  <div>
                    <b>Name:</b> {name || '—'}
                  </div>
                  <div>
                    <b>Birth Place:</b> {place || '—'}
                  </div>
                  <div>
                    <b>Date of Birth:</b> {dateStr || '—'}
                  </div>
                  <div>
                    <b>Time of Birth:</b> {timeStr || '—'}
                  </div>
                  <div>
                    <b>Timezone:</b> {timezone || '—'}
                  </div>
                </div>
              </div>

              <div className="card avoid-break" style={{ marginTop: 16 }}>
                <div className="section-title">Summary & Pañchāṅga</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.5fr 1fr',
                    gap: 12,
                  }}
                >
                  {/* Summary (left) */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 8,
                    }}
                  >
                    <div>
                      <b>Engine:</b> {out.engine}
                    </div>
                    <div>
                      <b>JD (UT):</b> {out.jd_ut.toFixed(6)}
                    </div>
                    <div>
                      <b>LST:</b> {fmtLST(out.lstHours)}
                    </div>
                    <div>
                      <b>D1 Lagna:</b> {fmtSignDeg(out.ascendant)} (
                      {fmtDMS(out.ascendant)})
                    </div>
                    <div>
                      <b>D9 Lagna:</b> {fmtSignDeg(out.d9Ascendant)} (
                      {fmtDMS(out.d9Ascendant)})
                    </div>
                    <div>
                      <b>Timezone:</b> {out.timezone}
                    </div>
                    <div style={{ gridColumn: '1 / span 3' }}>
                      <b>Sunrise:</b> {fmtISO(out.sunriseISO, out.timezone)}{' '}
                      &nbsp;|&nbsp;
                      <b>Sunset:</b> {fmtISO(out.sunsetISO, out.timezone)}
                    </div>
                  </div>

                  {/* Panchanga (right) */}
                  <div>
                    {panchanga ? (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 8,
                        }}
                      >
                        <div>
                          <b>Vara</b>
                          <div>{panchanga.vara}</div>
                        </div>
                        <div>
                          <b>Tithi</b>
                          <div>
                            {panchanga.paksha} {panchanga.tithiName} (#
                            {panchanga.tithiNum})
                          </div>
                        </div>
                        <div>
                          <b>Nakshatra</b>
                          <div>{panchanga.nakshatra}</div>
                        </div>
                        <div>
                          <b>Pada</b>
                          <div>{panchanga.pada}</div>
                        </div>
                        <div>
                          <b>Yoga</b>
                          <div>{panchanga.yoga}</div>
                        </div>
                        <div>
                          <b>Karana</b>
                          <div>{panchanga.karana}</div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontStyle: 'italic', color: '#6b7280' }}>
                        Pañchāṅga not available.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* D1 chart */}
              <div className="charts-column" style={{ marginTop: 16 }}>
                <SouthIndianChart
                  key={`d1-${out.jd_ut}`}
                  title="Rāśi (D1) — Signs"
                  mode="sign"
                  ascDeg={out.ascendant}
                  positions={out.positions}
                />
              </div>
            </section>

            {/* ---------- PAGE 2: D9 + Varga Summary ---------- */}
            <section className="page-section">
              {/* D9 chart */}
              <div className="charts-column">
                <SouthIndianChart
                  key={`d9-${out.jd_ut}`}
                  title="Navāṁśa (D9) — Signs"
                  mode="sign"
                  ascDeg={out.d9Ascendant}
                  positions={out.d9Positions}
                />
              </div>

              {/* Varga Summary */}
              <div className="card avoid-break" style={{ marginTop: 16 }}>
                <div className="section-title">
                  Varga Summary — D1 → D9 (Navāṁśa)
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.2fr 1.4fr 1.4fr 0.8fr',
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 900 }}>Body</div>
                  <div style={{ fontWeight: 900 }}>D1 (Rāśi)</div>
                  <div style={{ fontWeight: 900 }}>D9 (Navāṁśa)</div>
                  <div style={{ fontWeight: 900 }}>Navāṁśa part</div>
                  {[
                    'Ascendant',
                    'Sun',
                    'Moon',
                    'Mercury',
                    'Venus',
                    'Mars',
                    'Jupiter',
                    'Saturn',
                    'Rahu',
                    'Ketu',
                  ].map((body) => {
                    const d1 =
                      body === 'Ascendant'
                        ? out.ascendant
                        : out.positions?.[body];
                    const d9 =
                      body === 'Ascendant'
                        ? out.d9Ascendant
                        : out.d9Positions?.[body];
                    const navSize = 360 / (12 * 9); // 3°20′
                    const d9Deg =
                      typeof d9 === 'number' ? ((d9 % 360) + 360) % 360 : NaN;
                    const part = Number.isFinite(d9Deg)
                      ? Math.floor((d9Deg % 30) / navSize) + 1
                      : null;
                    return (
                      <React.Fragment key={`vs-${body}`}>
                        <div>{body}</div>
                        <div>
                          {Number.isFinite(d1 as number)
                            ? fmtSignDeg(d1 as number)
                            : '—'}
                        </div>
                        <div>
                          {Number.isFinite(d9 as number)
                            ? fmtSignDeg(d9 as number)
                            : '—'}
                        </div>
                        <div>{part ?? '—'}</div>
                      </React.Fragment>
                    );
                  })}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                  “Navāṁśa part” is the 1–9 sub-division within the D9 sign
                  (each is 3°20′).
                </div>
              </div>
            </section>

            {/* ---------- PAGE 3: Bhāva ---------- */}
            <section className="page-section">
              {PRINT_LOGO_EACH_PAGE && (
                <div className="print-only page-logo">
                  <img
                    src="/logo.png"
                    width={120}
                    height={120}
                    alt="Chandra Prabha — Vedic Astrology"
                  />
                </div>
              )}
              <SouthIndianChart
                title="Bhāva (Houses from Lagna)"
                mode="bhava"
                ascDeg={out.ascendant}
                positions={out.positions}
              />
            </section>
            {/* ---------- PAGE: Varga — Signs only (D1, D2, D3, D7, D9, D10, D12, D30) ---------- */}
            <section className="page-section">
              <div className="card avoid-break">
                <div className="section-title">Varga — Signs only</div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.3fr repeat(8, 1fr)',
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 900 }}>Body</div>
                  <div style={{ fontWeight: 900 }}>D1</div>
                  <div style={{ fontWeight: 900 }}>D2</div>
                  <div style={{ fontWeight: 900 }}>D3</div>
                  <div style={{ fontWeight: 900 }}>D7</div>
                  <div style={{ fontWeight: 900 }}>D9</div>
                  <div style={{ fontWeight: 900 }}>D10</div>
                  <div style={{ fontWeight: 900 }}>D12</div>
                  <div style={{ fontWeight: 900 }}>D30</div>

                  {vargaPlacements(out.positions, out.ascendant).map(
                    (row, i) => (
                      <React.Fragment key={`varga-${i}`}>
                        <div>{row.body}</div>
                        <div>{row.D1}</div>
                        <div>{row.D2}</div>
                        <div>{row.D3}</div>
                        <div>{row.D7}</div>
                        <div>{row.D9}</div>
                        <div>{row.D10}</div>
                        <div>{row.D12}</div>
                        <div>{row.D30}</div>
                      </React.Fragment>
                    )
                  )}
                </div>

                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                  Signs only are computed from D1 longitudes using standard
                  varga rules (no degrees shown).
                </div>
              </div>
            </section>
            {/* ---------- PAGE 4: Nakshatra • Pada • Ruler (D1) ---------- */}
            <section className="page-section">
              {PRINT_LOGO_EACH_PAGE && (
                <div className="print-only page-logo">
                  <img
                    src="/logo.png"
                    width={120}
                    height={120}
                    alt="Chandra Prabha — Vedic Astrology"
                  />
                </div>
              )}
              <div className="card avoid-break">
                <div className="section-title">
                  Nakshatra • Pada • Ruler (D1)
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(6, 1fr)',
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 900 }}>Body</div>
                  <div style={{ fontWeight: 900 }}>Sign</div>
                  <div style={{ fontWeight: 900 }}>Longitude</div>
                  <div style={{ fontWeight: 900 }}>Nakshatra</div>
                  <div style={{ fontWeight: 900 }}>Pada</div>
                  <div style={{ fontWeight: 900 }}>Ruler</div>
                  {out.nakTable.map((r, i) => (
                    <React.Fragment key={`nak-${i}`}>
                      <div>{r.body}</div>
                      <div>{r.sign}</div>
                      <div>{fmtSignDeg(r.deg)}</div>
                      <div>{r.nakshatra}</div>
                      <div>{r.pada}</div>
                      <div>{r.lord}</div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </section>
            {/* ---------- PAGE 5: Aspects (Major) ---------- */}
            <section className="page-section">
              {PRINT_LOGO_EACH_PAGE && (
                <div className="print-only page-logo">
                  <img
                    src="/logo.png"
                    width={120}
                    height={120}
                    alt="Chandra Prabha — Vedic Astrology"
                  />
                </div>
              )}
              <div className="card avoid-break">
                <div className="section-title">Aspects (Major)</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr 1fr',
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 900 }}>Planet A</div>
                  <div style={{ fontWeight: 900 }}>Aspect</div>
                  <div style={{ fontWeight: 900 }}>Planet B</div>
                  <div style={{ fontWeight: 900 }}>Δ°</div>
                  {mergeAspects(out.aspects || [], deriveAscAspects(out))
                    .length === 0 && (
                    <>
                      <div>—</div>
                      <div>—</div>
                      <div>—</div>
                      <div>—</div>
                    </>
                  )}
                  {mergeAspects(out.aspects || [], deriveAscAspects(out)).map(
                    (p, i) => (
                      <React.Fragment key={`asp-${i}`}>
                        <div>{p.a}</div>
                        <div>{p.type}</div>
                        <div>{p.b}</div>
                        <div>{p.delta.toFixed(2)}</div>
                      </React.Fragment>
                    )
                  )}
                </div>
                <div style={{ fontSize: 14, color: '#6b7280', marginTop: 6 }}>
                  Aspects include Ascendant↔planet; ecliptic longitudes with
                  typical orbs (6° conj/opp, 5° tri/sq, 4° sex).
                </div>
              </div>
            </section>

            {/* ---------- PAGE 6: Vimśottarī Mahādaśā ---------- */}
            <section className="page-section">
              <div className="card avoid-break">
                <div className="section-title">
                  Vimśottarī Mahādaśā (from birth)
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 900 }}>Lord</div>
                  <div style={{ fontWeight: 900 }}>Start</div>
                  <div style={{ fontWeight: 900 }}>End</div>
                  {out.dasha.map((d, i) => (
                    <React.Fragment key={`dasha-${i}`}>
                      <div>{d.lord}</div>
                      <div>{fmtISO(d.startISO, out.timezone)}</div>
                      <div>{fmtISO(d.endISO, out.timezone)}</div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </section>

           {/* ---------- PAGE 7: Highlights ---------- */}
{/* ---------- PAGE 7: Highlights ---------- */}
<section
  className="page-section"
  style={{ 
    pageBreakBefore: 'always', 
    padding: '40px', 
    backgroundColor: '#fffdf5', // Soft parchment feel
    borderRadius: '8px',
    boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
    borderTop: '6px solid #e67e22', // Nice orange Vedic accent
    maxWidth: '800px',
    margin: '40px auto'
  }}
>
  <div style={{ textAlign: 'center', marginBottom: 20 }}>
    <img
      src="/logo.png"
      width={140}
      height={140}
      alt="Chandra Prabha — Jathakam"
    />
  </div>

  {/* 1. The Main Header */}
  <div style={{ marginBottom: 30, textAlign: 'center' }}>
    <h2 style={{ 
      fontSize: '28px', 
      fontWeight: 'bold', 
      fontFamily: 'serif', 
      color: '#2c3e50',
      borderBottom: '1px solid #ddd', 
      paddingBottom: '15px',
      letterSpacing: '1px'
    }}>
      Personalized Life Highlights
    </h2>
  </div>

  {/* 2. The Full Interpretation */}
  {interpretation ? (
    <div style={{ marginTop: 20 }}>
      <div style={{ 
        whiteSpace: 'pre-line', 
        fontSize: '16px', 
        lineHeight: '1.8', 
        color: '#2c3e50',
        fontFamily: 'serif', // Makes it look like a formal report
        textAlign: 'justify'
      }}>
        {interpretation}
      </div>
    </div>
  ) : (
    <p style={{ textAlign: 'center', fontFamily: 'serif' }}>Generating details...</p>
  )}
</section>

            {/* ---------- Export Toolbar ---------- */}
            <div className="no-print" style={{ 
              marginTop: '40px', 
              padding: '20px', 
              borderTop: '1px solid #eee', 
              textAlign: 'center',
              display: 'flex',
              justifyContent: 'center',
              gap: '20px'
            }}>
              <button 
                onClick={() => window.print()}
                style={{ padding: '10px 20px', cursor: 'pointer', backgroundColor: '#4A90E2', color: 'white', border: 'none', borderRadius: '4px' }}
              >
                Print Report
              </button>
              
              <button 
                onClick={async () => {
                  const element = document.getElementById('report');
                  if (element) {
                    const html2pdf = (await import('html2pdf.js')).default;
                    html2pdf().set({
                      margin: 0.5,
                      filename: 'Jathakam-Report.pdf',
                      image: { type: 'jpeg', quality: 0.98 },
                      html2canvas: { scale: 2 },
                      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
                    }).from(element).save();
                  }
                }}
                style={{ padding: '10px 20px', cursor: 'pointer', backgroundColor: '#50E3C2', color: 'white', border: 'none', borderRadius: '4px' }}
              >
                Download PDF
              </button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

