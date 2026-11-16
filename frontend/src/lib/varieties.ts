// Coffee varieties (cultivars) the bean form suggests (docs/api/beans.md §4),
// before the workspace's own. Common names as roasters print them; a few
// have two spellings in use (Geisha / Gesha), so both are offered.
export const COMMON_VARIETIES: readonly string[] = [
  '74110', '74112', '74158', 'Abyssinia', 'Acaiá', 'Ateng', 'Batian', 'Bourbon', 'Bourbon Pointu', 'Castillo',
  'Catimor', 'Catuai', 'Caturra', 'Chiroso', 'Colombia', 'Ethiopian Heirloom', 'Geisha', 'Gesha', 'Heirloom', 'Icatu',
  'Java', 'Jember', 'K7', 'Kent', 'Laurina', 'Maragogype', 'Marsellesa', 'Mibirizi', 'Mokka', 'Mundo Novo',
  'Obatã', 'Pacamara', 'Pacas', 'Papayo', 'Parainema', 'Pink Bourbon', 'Red Bourbon', 'Red Catuai', 'Ruiru 11',
  'Rume Sudan', 'S795', 'Sarchimor', 'Sidra', 'SL14', 'SL28', 'SL34', 'Striped Bourbon', 'Tabi', 'Tim Tim',
  'Typica', 'Typica Mejorado', 'Villa Sarchi', 'Wush Wush', 'Yellow Bourbon', 'Yellow Catuai',
  // World Coffee Research catalog and other national-institute selections.
  'Anacafé 14', 'Blue Mountain', 'BorBor', 'Bourbon Mayaguez 71', 'Bourbon Mayaguez 139', 'Catigua', 'Catimor 129',
  'Centroamericano', 'Costa Rica 95', 'Dega', 'Harrar', 'IHCAFE 90', 'Jackson', 'KP423', 'Kurume', 'Lempira',
  'Maracatu', 'Maracaturra', 'Nyasaland', 'Pop3303/21', 'RAB C15', 'S288', 'Scottish Mission', 'Starmaya', 'Tupi',
  'Paraíso 1', 'Wolisho',
];

// Spelling key: lowercase, accents and everything but letters and digits dropped.
const key = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_KEY = new Map(COMMON_VARIETIES.map((v) => [key(v), v]));

// A known variety written another way ("SL-28", "ruiru-11", "Catuaí") becomes
// the suggested spelling; anything else is kept as typed. Geisha and Gesha
// differ in letters, so both stay.
export function canonicalVariety(name: string): string {
  return BY_KEY.get(key(name)) ?? name;
}
