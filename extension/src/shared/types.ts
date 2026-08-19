// типы, общие для background, content script и попапа

export type Exchange = 'BINANCE' | 'BYBIT' | 'HTX' | 'OTHER';
export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'PENDING' | 'PAID' | 'COMPLETED' | 'CANCELLED' | 'APPEALING' | 'UNKNOWN';
export type ReviewRating = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RequisiteType = 'CARD' | 'PHONE' | 'ACCOUNT' | 'WALLET';

export type Session = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    binanceUid: string;
    nickname: string | null;
    role: 'USER' | 'TEAM_LEAD' | 'ADMIN';
    status: 'ACTIVE' | 'BLOCKED';
    teamId: string | null;
    subscription: { plan: string; status: string; until: string | null };
  };
};

// панель либо отдельный блок документа под чатом, либо накладка поверх окна
export type PanelPlacement = 'chat-bottom' | 'floating';

// шаблон либо подставляется в поле ввода, либо сразу уходит собеседнику
export type TemplateMode = 'insert' | 'send';

export type Settings = {
  apiBaseUrl: string;
  panelEnabled: boolean;
  autoSyncOrders: boolean;
  captureChatRequisites: boolean;
  // светлая по умолчанию, 'auto' — как в системе
  theme: 'light' | 'dark' | 'auto';
  panelPlacement: PanelPlacement;
  panelWidth: number;
  panelHeight: number;
  templateMode: TemplateMode;
  // открывать профиль контрагента фоновой вкладкой ради недостающих полей
  enrichFromProfile: boolean;
};

export type ExchangeStats = {
  registeredDays?: number | null;
  firstOrderDays?: number | null;
  completionRate?: number | null;
  totalOrders?: number | null;
  orders30d?: number | null;
  avgAmountFiat?: number | null;
  avgAmount30dFiat?: number | null;
  avgReleaseMinutes?: number | null;
  avgPayMinutes?: number | null;
  // доля положительных отзывов биржи, 0..1
  positiveRate?: number | null;
  positiveCount?: number | null;
  negativeCount?: number | null;
  activeOrders?: number | null;
  merchantLevel?: string | null;
  // ниже — то, что видно в карточке контрагента на самой бирже
  completionRate30d?: number | null;
  joinedAt?: string | null;
  emailVerified?: boolean | null;
  phoneVerified?: boolean | null;
  kycVerified?: boolean | null;
  feedbackCount?: number | null;
  followers?: number | null;
  blockedBy?: number | null;
  // страна регистрации аккаунта по данным биржи, ISO: RU, KZ, AZE
  kycCountry?: string | null;
  totalVolumeFiat?: number | null;
  volume30dFiat?: number | null;
};

// отзыв, оставленный на самой бирже
export type ExchangeReview = {
  rating: ReviewRating;
  text: string | null;
  author: string | null;
  createdAt: string | null;
};

// совпадают с enum ReviewTag на бэкенде
export type ReviewTag = 'SCAM' | 'FREEZE' | 'DIRTY' | 'TERMS' | 'PAINTER' | 'RUDE' | 'COMMENT';

export const REVIEW_TAG_LABEL: Record<ReviewTag, string> = {
  SCAM: 'Мошенник',
  FREEZE: 'Мороз',
  DIRTY: 'Грязь',
  TERMS: 'Невыполнение условий',
  PAINTER: 'Художник',
  RUDE: 'Неадекват',
  COMMENT: 'Комментарий',
};

// порядок в выборе категории: тяжёлое сверху, комментарий последним
export const REVIEW_TAG_ORDER: ReviewTag[] = [
  'SCAM',
  'FREEZE',
  'DIRTY',
  'PAINTER',
  'TERMS',
  'RUDE',
  'COMMENT',
];

export type OrderSnapshot = {
  externalId: string;
  side: OrderSide;
  status: OrderStatus;
  asset?: string;
  fiat?: string;
  amountFiat?: number;
  amountAsset?: number;
  price?: number;
  createdAtExchange?: string;
};

export type CounterpartySnapshot = {
  externalId: string;
  nickname?: string;
  countryCode?: string;
  maskedPhone?: string;
  stats?: ExchangeStats;
  exchangeReviews?: ExchangeReview[];
  exchangeAds?: ExchangeAd[];
};

// что удалось прочитать прямо со страницы, запасной источник
export type DomSnapshot = {
  orderId?: string;
  counterpartyUid?: string;
  counterpartyNickname?: string;
  side?: OrderSide;
  status?: OrderStatus;
  fiat?: string;
  amountFiat?: number;
  // цифры из блока «Обзор торговли» рядом с чатом
  stats?: ExchangeStats;
};

// откуда взяты данные, показываем в панели
export type ContextSource = 'intercept' | 'api' | 'dom' | 'manual';

export type RiskFactor = { code: string; label: string; impact: number; detail?: string };

export type Dossier = {
  counterparty: {
    id: string;
    exchange: Exchange;
    externalId: string;
    nickname: string | null;
    countryCode: string | null;
    maskedPhone: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  risk: { score: number; level: RiskLevel; factors: RiskFactor[] };
  exchangeStats: ExchangeStats;
  // отзывы самой биржи, показываем отдельно от наших
  exchangeReviews: ExchangeReview[];
  // активные объявления контрагента
  exchangeAds: ExchangeAd[];
  blacklist: {
    id: string;
    scope: 'GLOBAL' | 'TEAM';
    reason: string;
    severity: number;
    source: string;
    createdAt: string;
    author: string | null;
    canRevoke: boolean;
  }[];
  reviews: {
    id: string;
    rating: ReviewRating;
    tag: ReviewTag;
    text: string;
    createdAt: string;
    author: string;
    isOwn: boolean;
    isTeam: boolean;
    canDelete: boolean;
  }[];
  reviewCounts: { positive: number; neutral: number; negative: number };
  // сколько жалоб какой категории, для ярлыков в шапке
  tagCounts: Partial<Record<ReviewTag, number>>;
  teamNote: { text: string; updatedAt: string; author: string | null } | null;
  orders: {
    market: OrderSummary;
    team: OrderSummary;
    own: OrderSummary;
    byStatus: Record<'market' | 'team' | 'own', Record<OrderStatus, number>>;
    recent: {
      id: string;
      externalId: string;
      side: OrderSide;
      status: OrderStatus;
      asset: string | null;
      fiat: string | null;
      amountFiat: number | null;
      createdAt: string;
      trader: string;
      traderNickname: string | null;
      isTeam: boolean;
    }[];
  };
  requisites: {
    id: string;
    type: RequisiteType;
    value: string;
    timesSeen: number;
    lastSeenAt: string;
    blacklisted: boolean;
    alsoUsedBy: string[];
  }[];
};

export type OrderSummary = { total: number; completed: number; cancelled: number; active: number };

export type MessageTemplate = {
  id: string;
  title: string;
  body: string;
  position: number;
  shared: boolean;
  canEdit: boolean;
};

export type ApiError = { code: string; message: string; details?: unknown };

// состояние панели, которое background рассылает в content script
export type PanelState =
  | { status: 'idle' }
  | { status: 'unauthorized'; message: string }
  | { status: 'loading'; orderId: string }
  | { status: 'error'; message: string; code?: string; orderId?: string; canRetryManually?: boolean }
  | {
      status: 'ready';
      orderId: string;
      dossier: Dossier;
      templates: MessageTemplate[];
      source: ContextSource;
      // от роли зависит, доступен ли общий ЧС
      role: 'USER' | 'TEAM_LEAD' | 'ADMIN';
      hasTeam: boolean;
      // реквизиты, замеченные в чате после открытия карточки
      requisiteAlert?: { value: string; type: RequisiteType } | null;
    };

// активное объявление контрагента на бирже
export type ExchangeAd = {
  side: OrderSide;
  asset: string | null;
  price: number | null;
  fiat: string | null;
  minFiat: number | null;
  maxFiat: number | null;
  methods: string[];
};
