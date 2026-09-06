import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/**
 * Offline lookups for a phone number and a vehicle plate.
 *
 * Both are the SAFE, public halves of what was asked for. Neither reaches a
 * network, tracks a device, or names a person:
 *
 *   - A phone number is decoded to country, operator and line type. Where it
 *     is registered and who holds it are not here, and there is no legal API
 *     that would add them without the owner's consent.
 *   - A plate is decoded to the REGION its prefix denotes - public reference
 *     knowledge, the same table printed in any almanac. The owner's name and
 *     address live in Samsat/Korlantas records, which are personal data behind
 *     authorisation, so they are not here either.
 *
 * Pure functions over local tables, so they run instantly and cost nothing.
 */

export interface LookupRow {
  label: string;
  value: string;
}

export interface LookupResult {
  kind: 'phone' | 'plate';
  title: string;
  subtitle: string;
  rows: LookupRow[];
  note?: string;
}

/**
 * Indonesian mobile operator by the three digits after the 8.
 *
 * Public numbering-plan data. Ranges are stated as prefixes rather than
 * enumerated so a new series in an existing band is still recognised.
 */
const ID_CARRIER: Record<string, string> = {};
for (const [carrier, prefixes] of Object.entries({
  Telkomsel: ['811', '812', '813', '821', '822', '823', '851', '852', '853'],
  'Indosat Ooredoo': ['814', '815', '816', '855', '856', '857', '858'],
  XL: ['817', '818', '819', '859', '877', '878'],
  Axis: ['831', '832', '833', '838'],
  'Tri (3)': ['895', '896', '897', '898', '899'],
  Smartfren: ['881', '882', '883', '884', '885', '886', '887', '888', '889'],
})) {
  for (const prefix of prefixes) ID_CARRIER[prefix] = carrier;
}

/** Human line type from libphonenumber's terse enum. */
const LINE_TYPE: Record<string, string> = {
  MOBILE: 'Seluler',
  FIXED_LINE: 'Telepon tetap',
  FIXED_LINE_OR_MOBILE: 'Tetap atau seluler',
  VOIP: 'VoIP',
  TOLL_FREE: 'Bebas pulsa',
  PREMIUM_RATE: 'Tarif premium',
};

const COUNTRY_NAME: Record<string, string> = {
  ID: 'Indonesia',
  MY: 'Malaysia',
  SG: 'Singapura',
  US: 'Amerika Serikat',
};

/**
 * Read a phone number, or return null when the text is not one.
 *
 * Deliberately conservative about WHAT it will treat as a number: mostly
 * digits, the odd + / space / dash, and long enough to be a real subscriber
 * line. A short numeric query - a house number, a year - is a place search,
 * not a phone lookup, and must fall through.
 */
export function lookupPhone(text: string): LookupResult | null {
  const trimmed = text.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  const shaped = /^[+()\d][()\d\s-]{7,}$/.test(trimmed);
  if (!shaped || digits.length < 9 || digits.length > 15) return null;

  // Default to Indonesia so a local 08.. number parses, while a +.. number
  // keeps whatever country it declares.
  const parsed = parsePhoneNumberFromString(trimmed, 'ID');
  if (!parsed) return null;

  const country = parsed.country || '';
  const national = parsed.nationalNumber ? String(parsed.nationalNumber) : '';
  const rows: LookupRow[] = [
    { label: 'Format internasional', value: parsed.formatInternational() },
    { label: 'Negara', value: COUNTRY_NAME[country] || country || 'Tidak diketahui' },
    { label: 'Jenis', value: LINE_TYPE[String(parsed.getType() || '')] || 'Tidak diketahui' },
    { label: 'Nomor valid', value: parsed.isValid() ? 'Ya' : 'Tidak' },
  ];

  if (country === 'ID' && national.startsWith('8')) {
    const carrier = ID_CARRIER[national.slice(0, 3)];
    rows.splice(2, 0, { label: 'Operator', value: carrier || 'Tidak dikenali' });
  }

  return {
    kind: 'phone',
    title: parsed.formatInternational(),
    subtitle: 'Info nomor telepon',
    rows,
    note: 'Hanya metadata nomor. Lokasi dan identitas pemilik tidak tersedia dan tidak dilacak.',
  };
}

/**
 * Indonesian plate prefix to the region it denotes.
 *
 * The front code is one or two letters. Two-letter codes are matched first so
 * "AB" (Yogyakarta) is not read as "A" (Banten). Public reference data.
 */
const PLATE_REGION: Record<string, string> = {
  // Two-letter first
  AA: 'Kedu (Magelang, Purworejo, Temanggung)',
  AB: 'DI Yogyakarta',
  AD: 'Surakarta (Solo) & sekitarnya',
  AE: 'Madiun & sekitarnya',
  AG: 'Kediri & sekitarnya',
  BA: 'Sumatra Barat',
  BB: 'Tapanuli (Sumut bagian barat)',
  BD: 'Bengkulu',
  BE: 'Lampung',
  BG: 'Sumatra Selatan',
  BH: 'Jambi',
  BK: 'Sumatra Utara (Medan & sekitarnya)',
  BL: 'Aceh',
  BM: 'Riau',
  BN: 'Kepulauan Bangka Belitung',
  BP: 'Kepulauan Riau',
  DA: 'Kalimantan Selatan',
  DB: 'Sulawesi Utara (Manado & sekitarnya)',
  DC: 'Sulawesi Barat',
  DD: 'Sulawesi Selatan',
  DE: 'Maluku',
  DG: 'Maluku Utara',
  DH: 'NTT (Timor)',
  DK: 'Bali',
  DL: 'Sangihe & Talaud',
  DM: 'Gorontalo',
  DN: 'Sulawesi Tengah',
  DR: 'NTB (Lombok)',
  DT: 'Sulawesi Tenggara',
  EA: 'NTB (Sumbawa)',
  EB: 'NTT (Flores)',
  ED: 'NTT (Sumba)',
  KB: 'Kalimantan Barat',
  KH: 'Kalimantan Tengah',
  KT: 'Kalimantan Timur',
  KU: 'Kalimantan Utara',
  PA: 'Papua',
  PB: 'Papua Barat',
  // One-letter
  A: 'Banten',
  B: 'DKI Jakarta, Bekasi, Depok, Tangerang',
  D: 'Bandung & sekitarnya',
  E: 'Cirebon & sekitarnya',
  F: 'Bogor, Sukabumi, Cianjur',
  G: 'Pekalongan & sekitarnya',
  H: 'Semarang & sekitarnya',
  K: 'Pati & sekitarnya',
  L: 'Surabaya',
  M: 'Madura',
  N: 'Malang, Pasuruan, Probolinggo',
  P: 'Besuki (Jember, Banyuwangi)',
  R: 'Banyumas & sekitarnya',
  S: 'Bojonegoro & sekitarnya',
  T: 'Purwakarta, Karawang, Subang',
  W: 'Sidoarjo, Gresik',
  Z: 'Garut, Tasikmalaya, Sumedang',
};

/**
 * Read a vehicle plate, or return null when the text is not one.
 *
 * Indonesian plates are 1-2 letters, 1-4 digits, then 1-3 letters. Only the
 * region prefix is decoded; the digits and the rear letters identify one
 * specific vehicle and its owner, which is exactly the part that is not
 * public.
 */
export function lookupPlate(text: string): LookupResult | null {
  const cleaned = text.trim().toUpperCase().replace(/\s+/g, ' ');
  const match = /^([A-Z]{1,2})\s?(\d{1,4})\s?([A-Z]{0,3})$/.exec(cleaned);
  if (!match) return null;

  const [, prefix, number, suffix] = match;
  const region = PLATE_REGION[prefix] || (prefix.length === 2 ? PLATE_REGION[prefix[0]] : null);
  if (!region) return null;

  const rows: LookupRow[] = [
    { label: 'Wilayah', value: region },
    { label: 'Kode', value: prefix },
    { label: 'Nomor', value: number },
  ];
  if (suffix) rows.push({ label: 'Seri belakang', value: suffix });

  return {
    kind: 'plate',
    title: `${prefix} ${number}${suffix ? ` ${suffix}` : ''}`,
    subtitle: 'Info wilayah plat kendaraan',
    rows,
    note: 'Hanya wilayah registrasi. Data pemilik ada di Samsat/Korlantas dan bukan informasi publik.',
  };
}

/** Try both, phone first. Returns the one that matched, or null. */
export function lookupIdentifier(text: string): LookupResult | null {
  return lookupPhone(text) || lookupPlate(text);
}
