/**
 * Local-only language catalogue for the target-language picker.
 *
 * The picker accepts any BCP 47 value the user types. This catalogue simply
 * supplies searchable names and flags for the languages most likely to be
 * requested from a translation model.
 */

const BASE_LANGUAGE_ROWS = `
aa:ET ab:GE ae: af:ZA ak:GH am:ET an:ES ar:SA as:IN av:RU ay:BO az:AZ
ba:RU be:BY bg:BG bh:IN bi:VU bm:ML bn:BD bo:CN br:FR bs:BA
ca:AD ce:RU ch:GU co:FR cr:CA cs:CZ cu:VA cv:RU cy:GB
da:DK de:DE dv:MV dz:BT
ee:GH el:GR en:US eo: es:ES et:EE eu:ES
fa:IR ff:SN fi:FI fj:FJ fo:FO fr:FR fy:NL
ga:IE gd:GB gl:ES gn:PY gu:IN gv:IM
ha:NG he:IL hi:IN ho:PG hr:HR ht:HT hu:HU hy:AM hz:NA
ia: ie: ig:NG ii:CN ik:US io: is:IS it:IT iu:CA
ja:JP jv:ID
ka:GE kg:CD ki:KE kj:NA kk:KZ kl:GL km:KH kn:IN ko:KR kr:NG ks:IN ku:TR kv:RU kw:GB ky:KG
la:VA lb:LU lg:UG li:NL ln:CD lo:LA lt:LT lu:CD lv:LV
mg:MG mh:MH mi:NZ mk:MK ml:IN mn:MN mr:IN ms:MY mt:MT my:MM
na:NR nb:NO nd:ZW ne:NP ng:NA nl:NL nn:NO no:NO nr:ZA nv:US ny:MW
oc:FR oj:CA om:ET or:IN os:GE
pa:IN pi:IN pl:PL ps:AF pt:PT
qu:PE
rm:CH rn:BI ro:RO ru:RU rw:RW
sa:IN sc:IT sd:PK se:NO sg:CF si:LK sk:SK sl:SI sm:WS
sn:ZW so:SO sq:AL sr:RS ss:SZ st:LS su:ID sv:SE sw:KE
ta:IN te:IN tg:TJ th:TH ti:ET tk:TM tl:PH tn:BW to:TO tr:TR ts:ZA tt:RU tw:GH ty:PF
ug:CN uk:UA ur:PK uz:UZ
ve:ZA vi:VN vo:
wa:BE wo:SN
xh:ZA
yi:IL yo:NG
za:CN zh:CN zu:ZA
`;

const REGIONAL_LANGUAGE_ROWS = `
af-ZA:ZA am-ET:ET ar-AE:AE ar-DZ:DZ ar-EG:EG ar-IQ:IQ ar-JO:JO ar-LB:LB ar-MA:MA ar-SA:SA ar-SY:SY ar-TN:TN
az-AZ:AZ be-BY:BY bg-BG:BG bn-BD:BD bn-IN:IN bs-BA:BA ca-ES:ES cs-CZ:CZ cy-GB:GB
da-DK:DK de-AT:AT de-CH:CH de-DE:DE el-GR:GR
en-AU:AU en-CA:CA en-GB:GB en-IN:IN en-NZ:NZ en-SG:SG en-US:US en-ZA:ZA
es-419: es-AR:AR es-CL:CL es-CO:CO es-ES:ES es-MX:MX es-PE:PE es-US:US
et-EE:EE eu-ES:ES fa-IR:IR fi-FI:FI fil-PH:PH fr-BE:BE fr-CA:CA fr-CH:CH fr-FR:FR
ga-IE:IE gl-ES:ES he-IL:IL hi-IN:IN hr-HR:HR hu-HU:HU hy-AM:AM id-ID:ID
is-IS:IS it-CH:CH it-IT:IT ja-JP:JP ka-GE:GE kk-KZ:KZ km-KH:KH ko-KR:KR ky-KG:KG
lo-LA:LA lt-LT:LT lv-LV:LV mk-MK:MK mn-MN:MN ms-MY:MY ms-SG:SG my-MM:MM
nb-NO:NO ne-NP:NP nl-BE:BE nl-NL:NL nn-NO:NO pl-PL:PL pt-AO:AO pt-BR:BR pt-MZ:MZ pt-PT:PT
ro-MD:MD ro-RO:RO ru-RU:RU si-LK:LK sk-SK:SK sl-SI:SI sq-AL:AL sr-Latn:RS sr-RS:RS sv-SE:SE
sw-KE:KE sw-TZ:TZ ta-IN:IN ta-LK:LK te-IN:IN tg-TJ:TJ th-TH:TH tk-TM:TM tr-TR:TR
uk-UA:UA ur-IN:IN ur-PK:PK uz-UZ:UZ vi-VN:VN yo-NG:NG zh-CN:CN zh-HK:HK zh-MO:MO zh-SG:SG zh-TW:TW zu-ZA:ZA
`;

// Additional ISO 639-2/3 languages and globally used regional/script forms.
const EXTENDED_LANGUAGE_ROWS = `
ace:ID ady:RU afb:SA ain:JP als:AL alt:RU arb:SA anp:IN apc:PS apd:SD arn:CL arp:US ary:MA arz:EG ast:ES awa:IN
azb:IR bal:PK ban:ID bem:ZM bho:IN bik:PH bjn:ID bug:ID ceb:PH chk:FM cho:US cjy:CN ckb:IQ crh:UA crs:SC
cmn:CN dak:US doi:IN dyu:BF fil:PH fon:BJ fur:IT gag:MD gan:CN gbm:IN gil:KI glk:IR gsw:CH hak:CN haw:US hil:PH hmn:CN
hsb:DE hsn:CN iba:MY ilo:PH inh:RU jam:JM jbo: kab:DZ kac:MM kam:KE kbd:RU kha:IN kmb:AO kok:IN kos:FM
krc:RU krl:RU kri:SL ksh:DE kun:ER lad:IL lzh:CN lez:RU lmo:IT lrc:IR luo:KE mai:IN mdf:RU men:SL mer:KE mfe:MU
mni:IN mos:BF mwr:IN mzn:IR nah:MX nan:CN nap:IT nds:DE new:NP nqo: nso:ZA nus:SS pag:PH pam:PH
pan:IN pap:AW pau:PW pcm:NG pes:IR pon:FM prs:AF quc:GT quz:PE raj:IN rif:MA rom: rup:GR ryu:JP sah:RU sat:IN scn:IT sco:GB sdh:IR swh:TZ
sgs:LT sh: shi:MA sma:SE smj:SE smn:FI sms:FI srn:SR suk:TZ swb:KM syr:IQ tem:SL tet:TL tiv:NG tpi:PG
tum:MW tvl:TV tyv:RU tzm:MA udm:RU umb:AO vec:IT vep:RU war:PH wuu:CN xal:RU yap:FM yua:MX yue:HK zgh:MA zsm:MY zun:US
`;

const LANGUAGE_ALIASES = {
  ar: ['Arabic', 'العربية'],
  ckb: ['Kurdish Sorani', 'Sorani Kurdish', 'Sorani'],
  cdo: ['Min Dong', 'Eastern Min'],
  cjy: ['Jinyu', 'Jin Chinese'],
  cmn: ['Mandarin', 'Mandarin Chinese'],
  fa: ['Farsi', 'Persian'],
  fil: ['Tagalog', 'Filipino'],
  gsw: ['Swiss German', 'Alemannic'],
  hak: ['Hakka Chinese'],
  hsn: ['Xiang Chinese'],
  ku: ['Kurdish', 'Kurmanji'],
  lzh: ['Literary Chinese', 'Classical Chinese'],
  ory: ['Odia', 'Oriya'],
  pes: ['Iranian Persian', 'Western Persian'],
  quz: ['Cusco Quechua', 'Qusqu Runasimi'],
  swh: ['Swahili', 'Kiswahili'],
  zsm: ['Standard Malay', 'Bahasa Melayu'],
  nan: ['Min Nan', 'Hokkien', 'Taiwanese Hokkien'],
  nb: ['Bokmal', 'Norwegian Bokmal'],
  nn: ['Nynorsk', 'Norwegian Nynorsk'],
  prs: ['Dari', 'Afghan Persian'],
  qu: ['Quechua', 'Runasimi'],
  sh: ['Serbo-Croatian', 'BCMS'],
  tl: ['Tagalog', 'Filipino'],
  wuu: ['Wu Chinese', 'Shanghainese'],
  yue: ['Cantonese', 'Yue Chinese'],
  zgh: ['Standard Moroccan Tamazight', 'Tamazight']
};

const BCP47_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i;
const optionsCache = new Map();

function parseRows(source) {
  return source.trim().split(/\s+/).map((row) => {
    const [code, territory = ''] = row.split(':');
    return [code, territory];
  });
}

function flagFromTerritory(territory) {
  if (!/^[A-Z]{2}$/.test(territory)) return '🌐';
  return String.fromCodePoint(...[...territory].map((letter) => 127397 + letter.charCodeAt(0)));
}

function explicitRegion(tag) {
  const parts = String(tag || '').replace(/_/g, '-').split('-');
  for (const part of parts.slice(1)) {
    if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase();
  }
  return null;
}

function baseLanguage(tag) {
  return String(tag || '').trim().toLowerCase().split('-')[0];
}

function displayNames(locales) {
  if (typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') return null;
  try {
    return new Intl.DisplayNames(locales, { type: 'language', fallback: 'code' });
  } catch {
    return null;
  }
}

function displayName(names, tag, fallback) {
  if (!names) return fallback;
  try {
    return names.of(tag) || fallback;
  } catch {
    return fallback;
  }
}

function searchKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function normalizedLocale(locale) {
  const value = String(locale || '').trim().replace(/_/g, '-');
  return BCP47_PATTERN.test(value) ? value : 'en';
}

function buildLanguageOptions(locale) {
  const uiLocale = normalizedLocale(locale);
  const localizedNames = displayNames([uiLocale, 'en']);
  const englishNames = displayNames(['en']);
  const collator = new Intl.Collator(uiLocale, { sensitivity: 'base' });
  const rows = new Map();

  for (const [code, territory] of [
    ...parseRows(BASE_LANGUAGE_ROWS),
    ...parseRows(REGIONAL_LANGUAGE_ROWS),
    ...parseRows(EXTENDED_LANGUAGE_ROWS)
  ]) {
    rows.set(code.toLowerCase(), { code, territory });
  }

  const options = [...rows.values()].map(({ code, territory }) => {
    const name = displayName(localizedNames, code, code);
    const englishName = displayName(englishNames, code, code);
    const nativeName = displayName(displayNames([code]), code, name);
    const aliases = LANGUAGE_ALIASES[code] || LANGUAGE_ALIASES[baseLanguage(code)] || [];
    const resolvedTerritory = territory || explicitRegion(code) || '';
    const searchNames = [code, name, englishName, nativeName, ...aliases].map(searchKey);
    const searchText = searchNames.join(' ');
    return {
      value: code,
      name,
      englishName,
      nativeName,
      flag: flagFromTerritory(resolvedTerritory),
      territory: resolvedTerritory,
      searchText,
      searchNames
    };
  });

  options.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.value, b.value));
  return options;
}

export function preferredBrowserLanguage(candidates, fallback = 'en') {
  for (const candidate of candidates || []) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim().replace(/_/g, '-');
    if (BCP47_PATTERN.test(value)) return value;
  }
  return fallback;
}

export function getBrowserLanguage() {
  if (typeof navigator === 'undefined') return 'en';
  const candidates = [];
  if (typeof navigator.language === 'string') candidates.push(navigator.language);
  if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
  return preferredBrowserLanguage(candidates, 'en');
}

export function getLanguageOptions(locale = getBrowserLanguage()) {
  const key = normalizedLocale(locale);
  if (!optionsCache.has(key)) optionsCache.set(key, buildLanguageOptions(key));
  return optionsCache.get(key);
}

export function searchLanguageOptions(query, locale = getBrowserLanguage()) {
  const normalizedQuery = searchKey(query).trim();
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (!terms.length) return getLanguageOptions(locale);
  const collator = new Intl.Collator(normalizedLocale(locale), { sensitivity: 'base' });
  return getLanguageOptions(locale)
    .filter((option) => terms.every((term) => option.searchText.includes(term)))
    .map((option) => {
      const exact = option.searchNames.some((name) => name === normalizedQuery);
      const starts = option.searchNames.some((name) => name.startsWith(normalizedQuery));
      return { option, score: exact ? 0 : starts ? 1 : 2 };
    })
    .sort((a, b) => a.score - b.score || collator.compare(a.option.name, b.option.name) || collator.compare(a.option.value, b.option.value))
    .map(({ option }) => option);
}

export function languageOptionFor(value, locale = getBrowserLanguage()) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return null;
  return getLanguageOptions(locale).find((option) => option.value.toLowerCase() === key) || null;
}

export function languageTerritoryFor(value, locale = getBrowserLanguage()) {
  const exact = languageOptionFor(value, locale);
  if (exact?.territory) return exact.territory;
  const region = explicitRegion(value);
  if (region) return region;
  return languageOptionFor(baseLanguage(value), locale)?.territory || '';
}

export function languageFlagFor(value, locale = getBrowserLanguage()) {
  return flagFromTerritory(languageTerritoryFor(value, locale));
}

export const DEFAULT_TARGET_LANGUAGE = getBrowserLanguage();







