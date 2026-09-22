export type Locale = "en" | "zh-CN" | "hi";

export const LOCALE_STORAGE_KEY = "laforge.locale";

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "zh-CN" || v === "hi";
}

export function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "en";
}

function lookup(dict: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as object)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, dict);
}

function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] == null ? `{${k}}` : String(vars[k]),
  );
}

export function translate(
  locale: Locale,
  path: string,
  vars?: Record<string, string | number>,
): string {
  const raw = lookup(DICTIONARIES[locale], path) ?? lookup(DICTIONARIES.en, path);
  if (typeof raw !== "string") return path;
  return fill(raw, vars);
}

export function translateList<T>(locale: Locale, path: string): T[] {
  const raw = lookup(DICTIONARIES[locale], path) ?? lookup(DICTIONARIES.en, path);
  return Array.isArray(raw) ? (raw as T[]) : [];
}

const en = {
  lang: {
    group: "Language",
    toZh: "Switch to Simplified Chinese",
    toEn: "Switch to English",
    toHi: "Switch to Hindi",
    en: "EN",
    zh: "简",
    hi: "HI",
  },
  chain: {
    robinhood: "Robinhood Chain",
    ethereum: "Ethereum",
    hyperevm: "Hyperliquid",
    base: "Base",
    bsc: "BNB Smart Chain",
    robinhoodShort: "Robinhood",
    ethereumShort: "Ethereum",
    hyperevmShort: "HyperEVM",
    baseShort: "Base",
    bscShort: "BNB Chain",
    solana: "Solana",
  },
  nav: {
    dashboard: "Dashboard",
    pools: "Pools",
    stake: "Stake",
    roadmap: "Roadmap",
    yield: "Yield",
    calculator: "Calculator",
    history: "History",
    referral: "Referral",
    docs: "Docs",
    faqs: "FAQs",
    samples: "Samples",
    createStake: "Create Stake",
    backLanding: "Laforge — dashboard",
    stakingTerminal: "Staking Terminal",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },
  dash: {
    title: "Staking Terminal",
    caption: "Pools on Robinhood and Ethereum",
    live: "Mainnet feed · live",
    referrals: "Referrals",
    footer: "Tenure resets on unstake · rate can rise if the operator tops up",
  },
  referral: {
    title: "Referral desk",
    blurb:
      "Share your link. Direct: 10% of the launch fee, +1% per extra launch, cap 30%. Hop 2 (your upline) gets 5% of that commission. Hop 3 gets 2% of hop 2. Then it stops. Nobody’s cut is reduced — overrides come from the protocol remainder.",
    connect: "Connect a wallet to copy your referral link.",
    copy: "Copy",
    copied: "Copied",
    count: "{n} launches referred",
    owed: "Unclaimed",
    claim: "Claim",
    claiming: "Claiming…",
    upline: "Upline",
    uplinePh: "Upline 0x… (optional, once)",
    bind: "Bind",
    binding: "Binding…",
    learn: "How the cut works →",
  },
  refPage: {
    kicker: "The cut",
    title: "Send the link. Eat.",
    lede: "Three hops. Then the well is dry. On purpose.",
    totalLabel: "Total earned",
    unitLabel: "Show total in ETH or SOL",
    unclaimed: "Unclaimed",
    progressLabel: "Referred launches",
    progressCount: "{n} / {cap}",
    splitNow: "Your direct split",
    listLabel: "Your referrals",
    listHint: "Addresses masked · lifetime from each",
    listEmpty: "No referred launches yet. Share the link. When they create a pool, they land here.",
    hopsLabel: "Who gets paid",
    h1t: "You sent the link",
    h1p: "First launch through you is 10%. Every extra one +1%, cap 30%. This is the steak.",
    h1who: "You (direct)",
    h2t: "You brought the closer",
    h2p: "5% of their steak. They keep the whole steak. You get the side.",
    h2who: "Your upline (hop 2)",
    h3t: "You brought the bringer",
    h3p: "2% of that side. Crumbs. Good crumbs. Then we stop.",
    h3who: "Hop 2’s upline (hop 3)",
    cap: "Hop 4 is a tourist. Tourists don’t get paid.",
    exLabel: "One 0.03 ETH ecosystem launch",
    exBlurb: "First-time closer, no holder discount. Math is boring. The split isn’t.",
    protocol: "Protocol",
    theRest: "the rest",
    override:
      "Overrides come off the protocol remainder. Nobody’s cut is skimmed. Claim whenever from the desk below.",
    hold: "Hold the token, launch cheaper. 10k → 5% off. 100k → 10%. 1M → 20%. 10M → 30%. Referrals pay on what they actually send.",
    self: "You cannot refer yourself. Binding an upline is once. Cycles get skipped. We checked.",
  },
  hero: {
    kicker: "Stake · earn · compound",
    title: "Put your tokens to work.",
    body: "Earn continuous, auto-accruing yield with a tenure bonus that grows the longer you stake — up to 2.0×. No lockups you can't exit, transparent emissions, and rewards that compound in real time.",
    how: "How it works",
  },
  common: {
    website: "Website",
    telegram: "Telegram",
    discord: "Discord",
    back: "← Back to dashboard",
    daysShort: "{n}d",
    primary: "Primary",
  },
} as const;

const zh = {
  lang: {
    group: "语言",
    toZh: "切换为简体中文",
    toEn: "切换为英文",
    toHi: "切换为印地语",
    en: "EN",
    zh: "简",
    hi: "HI",
  },
  nav: {
    dashboard: "控制台",
    pools: "矿池",
    stake: "质押",
    referral: "推荐",
    docs: "文档",
  },
  dash: {
    title: "质押终端",
    referrals: "推荐",
  },
  referral: {
    title: "推荐台",
    copy: "复制",
    copied: "已复制",
    claim: "领取",
    learn: "分成怎么算 →",
  },
  refPage: {
    kicker: "分成",
    title: "发链接。吃肉。",
    lede: "三层。然后井就干了。这是故意的。",
    totalLabel: "累计收益",
    unitLabel: "以 ETH 或 SOL 显示累计",
    unclaimed: "待领取",
  },
  common: {
    back: "← 返回控制台",
  },
} as const;

const hi = {
  lang: {
    group: "भाषा",
    toZh: "सरलीकृत चीनी पर जाएँ",
    toEn: "अंग्रेज़ी पर जाएँ",
    toHi: "हिंदी पर जाएँ",
    en: "EN",
    zh: "简",
    hi: "HI",
  },
  chain: {
    robinhood: "रॉबिनहुड चेन",
    ethereum: "एथेरियम",
    hyperevm: "Hyperliquid",
    base: "Base",
    bsc: "BNB स्मार्ट चेन",
    robinhoodShort: "रॉबिनहुड",
    ethereumShort: "एथेरियम",
    hyperevmShort: "HyperEVM",
    baseShort: "Base",
    bscShort: "BNB चेन",
    solana: "Solana",
  },
  nav: {
    dashboard: "डैशबोर्ड",
    pools: "पूल",
    stake: "स्टेक",
    roadmap: "रोडमैप",
    yield: "यील्ड",
    calculator: "कैलकुलेटर",
    history: "इतिहास",
    referral: "रेफ़रल",
    docs: "डॉक्स",
    faqs: "सवाल",
    samples: "सैंपल",
    createStake: "स्टेक बनाएँ",
    backLanding: "Laforge — डैशबोर्ड",
    stakingTerminal: "स्टेकिंग टर्मिनल",
    openMenu: "मेनू खोलें",
    closeMenu: "मेनू बंद करें",
  },
  landing: {
    kicker: "Laforge",
    staking: "स्टेकिंग ",
    nexus: "नेक्सस",
    and: " और ",
    gaming: "गेमिंग ",
    terminal: "टर्मिनल",
    blurb: "मल्टी-चेन स्टेकिंग। टेन्योर-वेटेड यील्ड। मार्केटिंग जो कम्युनिटी बढ鏁़ा सकती है।",
    enter: "टर्मिनल में जाएँ",
  },
  dash: {
    title: "स्टेकिंग टर्मिनल",
    caption: "रॉबिनहुड और एथेरियम पर पूल",
    live: "मेननेट फ़ीड · लाइव",
    referrals: "रेफ़रल",
    footer: "अनस्टेक पर टेन्योर रीसेट · ऑपरेटर टॉप-अप से रेट बढ鏁़ सकता है",
  },
  connect: {
    withX: "X से कनेक्ट करें",
    connecting: "कनेक्ट हो रहा है…",
    connected: "X कनेक्टेड",
    signedIn: "X से साइन इन",
    wallet: "वॉलेट · {chain}",
  },
  hero: {
    kicker: "स्टेक · कमाएँ · कंपाउंड",
    title: "अपने टोकन को काम पर लगाएँ।",
    body: "लगातार यील्ड, टेन्योर बोनस जो जितना लंबा स्टेक उतना बढ鏁़े — 2.0× तक।",
    how: "यह कैसे काम करता है",
  },
  referral: {
    title: "रेफ़रल डेस्क",
    blurb:
      "लिंक शेयर करें। डायरेक्ट: लॉन्च फ़ीस का 10%, हर अतिरिक्त लॉन्च पर +1%, अधिकतम 30%। हॉप 2 को उस कमीशन का 5%। हॉप 3 को हॉप 2 का 2%। फिर रुक जाता है।",
    connect: "रेफ़रल लिंक कॉपी करने के लिए वॉलेट कनेक्ट करें।",
    copy: "कॉपी",
    copied: "कॉपी हो गया",
    count: "{n} लॉन्च रेफ़र हुए",
    owed: "अनक्लेम्ड",
    claim: "क्लेम",
    claiming: "क्लेम हो रहा है…",
    upline: "अपलाइन",
    uplinePh: "अपलाइन 0x… (वैकल्पिक, एक बार)",
    bind: "बाइंड",
    binding: "बाइंड हो रहा है…",
    learn: "कटाई कैसे चलती है →",
  },
  refPage: {
    kicker: "कटाई",
    title: "लिंक भेजो। कमाओ।",
    lede: "तीन हॉप। फिर कुआँ सूख जाता है। जानबूझकर।",
    totalLabel: "कुल कमाई",
    unitLabel: "ETH या SOL में दिखाएँ",
    unclaimed: "अनक्लेम्ड",
    progressLabel: "रेफ़र किए लॉन्च",
    progressCount: "{n} / {cap}",
    splitNow: "आपका डायरेक्ट स्प्लिट",
    listLabel: "आपके रेफ़रल",
    listHint: "पते छिपे · प्रत्येक से लाइफ़टाइम",
    listEmpty: "अभी कोई रेफ़र लॉन्च नहीं। लिंक शेयर करें। जब वे पूल बनाएँगे, यहाँ दिखेगा।",
    hopsLabel: "किसे मिलता है",
    h1t: "आपने लिंक भेजा",
    h1p: "आपके ज़रिए पहला लॉन्च 10%। हर अगला +1%, अधिकतम 30%। यही स्टेक है।",
    h1who: "आप (डायरेक्ट)",
    h2t: "आपने क्लोज़र लाया",
    h2p: "उनके हिस्से का 5%। पूरा हिस्सा उनका रहता है। आपको साइड मिलती है।",
    h2who: "आपकी अपलाइन (हॉप 2)",
    h3t: "आपने लाने वाले को लाया",
    h3p: "उस साइड का 2%। टुकड़े। अच्छे टुकड़े। फिर रुकते हैं।",
    h3who: "हॉप 2 की अपलाइन (हॉप 3)",
    cap: "हॉप 4 पर्यटक है। पर्यटकों को पे नहीं।",
    exLabel: "एक 0.03 ETH इकोसिस्टम लॉन्च",
    exBlurb: "पहली बार क्लोज़र, कोई होल्डर डिस्काउंट नहीं।",
    protocol: "प्रोटोकॉल",
    theRest: "बाकी",
    override: "ओवरराइड प्रोटोकॉल के बचे हिस्से से आते हैं। किसी की कटाई नहीं कटती। नीचे से क्लेम करें।",
    hold: "टोकन होल्ड करो, लॉन्च सस्ता। 10k → 5% छूट। 100k → 10%। 1M → 20%। 10M → 30%.",
    self: "खुद को रेफ़र नहीं कर सकते। अपलाइन एक बार बाइंड। साइकल स्किप। हमने चेक किया।",
    pitch: "कोई आपके लिंक से पूल लॉन्च करे तो आपको उनकी असल चुकाई फ़ीस का हिस्सा मिलता है।",
  },
  search: {
    label: "कॉन्ट्रैक्ट से पूल खोजें",
    placeholder: "कॉन्ट्रैक्ट एडरेस से खोजें (0x…)",
    emptyHint: "कॉन्ट्रैक्ट एडरेस से पूल खोजें",
    invalidHint: "कोई 0x पूल या टोकन एडरेस डालें",
    invalid: "यह वैध 0x एडरेस नहीं है।",
    none: "लिस्टेड फ़ैक्टरी पर उस एडरेस का पूल नहीं।",
    failed: "खोज असफल।",
  },
  directory: {
    title: "पूल",
    liveOn: "रॉबिनहुड और एथेरियम पर लाइव",
    viewAll: "सभी {n} देखें →",
    allPools: "सभी पूल →",
  },
  common: {
    website: "वेबसाइट",
    telegram: "टेलीग्राम",
    discord: "डिस्कॉर्ड",
    back: "← डैशबोर्ड पर वापस",
    daysShort: "{n}दिन",
    primary: "प्राइमरी",
  },
  create: {
    bronze: "ब्रॉन्ज़",
    ecosystem: "इकोसिस्टम",
    marketing: "मार्केटिंग",
  },
  docs: {
    title: "डॉक्स",
    back: "← डैशबोर्ड पर वापस",
  },
  faqs: {
    title: "सवाल",
    intro: "स्टेकिंग टर्मिनल के बारे में छोटे जवाब।",
  },
} as const;

export const DICTIONARIES: Record<Locale, typeof en> = {
  en,
  "zh-CN": zh as unknown as typeof en,
  hi: hi as unknown as typeof en,
};

export function chainCopy(
  t: (path: string, vars?: Record<string, string | number>) => string,
  key: string,
  kind: "label" | "short" = "label",
  fallback = key,
): string {
  const path = kind === "short" ? `chain.${key}Short` : `chain.${key}`;
  const value = t(path);
  return value === path ? fallback : value;
}
