/**
 * Major cities per country, for the location bar's suggestions.
 *
 * NAMES ONLY, deliberately. Coordinates are resolved at click time through the
 * geocoder, so nothing here can be a wrong number: a name is checkable, a
 * hand-copied latitude is not, and a subtly wrong one would fly the camera into
 * the sea with no indication anything was off.
 *
 * Ordered roughly by prominence, since the bar shows the first few and the rest
 * are never seen. Keys are ISO 3166-1 alpha-2, upper case, matching what the
 * reverse geocoder returns.
 *
 * Coverage is a selection, not a world index. A country that is not listed
 * falls back to the app's built-in city presets, which is why this can grow one
 * country at a time without any other change.
 *
 * @module data/countryCities
 */

export const COUNTRY_CITIES = Object.freeze({
  ID: ['Jakarta', 'Surabaya', 'Bandung', 'Medan', 'Semarang', 'Makassar', 'Yogyakarta', 'Denpasar', 'Palembang', 'Balikpapan'],
  MY: ['Kuala Lumpur', 'George Town', 'Johor Bahru', 'Kota Kinabalu', 'Kuching', 'Ipoh'],
  SG: ['Singapore'],
  TH: ['Bangkok', 'Chiang Mai', 'Phuket', 'Pattaya', 'Hat Yai'],
  VN: ['Hanoi', 'Ho Chi Minh City', 'Da Nang', 'Hai Phong', 'Hue'],
  PH: ['Manila', 'Quezon City', 'Cebu City', 'Davao City', 'Baguio'],
  JP: ['Tokyo', 'Osaka', 'Kyoto', 'Yokohama', 'Nagoya', 'Sapporo', 'Fukuoka'],
  KR: ['Seoul', 'Busan', 'Incheon', 'Daegu', 'Daejeon'],
  CN: ['Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu', "Xi'an", 'Hangzhou'],
  TW: ['Taipei', 'Kaohsiung', 'Taichung', 'Tainan'],
  HK: ['Hong Kong'],
  IN: ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Jaipur'],
  PK: ['Karachi', 'Lahore', 'Islamabad', 'Faisalabad', 'Peshawar'],
  BD: ['Dhaka', 'Chattogram', 'Khulna', 'Sylhet'],
  LK: ['Colombo', 'Kandy', 'Galle'],
  NP: ['Kathmandu', 'Pokhara'],

  AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra'],
  NZ: ['Auckland', 'Wellington', 'Christchurch', 'Queenstown'],

  US: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'San Francisco', 'Seattle', 'Austin', 'Miami', 'Washington'],
  CA: ['Toronto', 'Montreal', 'Vancouver', 'Calgary', 'Ottawa', 'Quebec City'],
  MX: ['Mexico City', 'Guadalajara', 'Monterrey', 'Cancun', 'Puebla'],
  BR: ['Sao Paulo', 'Rio de Janeiro', 'Brasilia', 'Salvador', 'Fortaleza', 'Manaus'],
  AR: ['Buenos Aires', 'Cordoba', 'Rosario', 'Mendoza'],
  CL: ['Santiago', 'Valparaiso', 'Concepcion'],
  CO: ['Bogota', 'Medellin', 'Cali', 'Cartagena'],
  PE: ['Lima', 'Cusco', 'Arequipa'],

  GB: ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Glasgow', 'Liverpool', 'Bristol'],
  IE: ['Dublin', 'Cork', 'Galway'],
  FR: ['Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Bordeaux'],
  DE: ['Berlin', 'Hamburg', 'Munich', 'Cologne', 'Frankfurt', 'Stuttgart'],
  NL: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven'],
  BE: ['Brussels', 'Antwerp', 'Ghent', 'Bruges'],
  ES: ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Bilbao', 'Malaga'],
  PT: ['Lisbon', 'Porto', 'Faro'],
  IT: ['Rome', 'Milan', 'Naples', 'Turin', 'Florence', 'Venice'],
  CH: ['Zurich', 'Geneva', 'Bern', 'Basel'],
  AT: ['Vienna', 'Salzburg', 'Graz', 'Innsbruck'],
  PL: ['Warsaw', 'Krakow', 'Gdansk', 'Wroclaw', 'Poznan'],
  CZ: ['Prague', 'Brno', 'Ostrava'],
  SE: ['Stockholm', 'Gothenburg', 'Malmo'],
  NO: ['Oslo', 'Bergen', 'Trondheim', 'Tromso'],
  DK: ['Copenhagen', 'Aarhus', 'Odense'],
  FI: ['Helsinki', 'Tampere', 'Turku'],
  GR: ['Athens', 'Thessaloniki', 'Heraklion'],
  TR: ['Istanbul', 'Ankara', 'Izmir', 'Antalya', 'Bursa'],
  RU: ['Moscow', 'Saint Petersburg', 'Novosibirsk', 'Yekaterinburg', 'Kazan'],
  UA: ['Kyiv', 'Lviv', 'Odesa', 'Kharkiv'],
  RO: ['Bucharest', 'Cluj-Napoca', 'Timisoara'],
  HU: ['Budapest', 'Debrecen'],

  AE: ['Dubai', 'Abu Dhabi', 'Sharjah'],
  SA: ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam'],
  QA: ['Doha'],
  IL: ['Jerusalem', 'Tel Aviv', 'Haifa'],
  EG: ['Cairo', 'Alexandria', 'Giza', 'Luxor'],
  MA: ['Casablanca', 'Marrakesh', 'Rabat', 'Fes', 'Tangier'],
  ZA: ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria'],
  NG: ['Lagos', 'Abuja', 'Kano', 'Ibadan'],
  KE: ['Nairobi', 'Mombasa', 'Kisumu'],
  ET: ['Addis Ababa', 'Dire Dawa'],
  TZ: ['Dar es Salaam', 'Dodoma', 'Arusha'],
  GH: ['Accra', 'Kumasi'],
});

/**
 * City names to offer for a country, or null when there is nothing to offer.
 *
 * @param {string|null} countryCode ISO 3166-1 alpha-2, any case.
 * @param {number} [limit=6] How many to return; the bar has finite width.
 * @returns {string[]|null}
 */
export function citiesForCountry(countryCode, limit = 6) {
  const key = String(countryCode || '').toUpperCase();
  const cities = COUNTRY_CITIES[key];
  if (!Array.isArray(cities) || !cities.length) return null;
  return cities.slice(0, Math.max(1, limit));
}
