/** Типы, общие для background, content script и попапа. */

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

export type Settings = {
  apiBaseUrl: string;
  panelEnabled: boolean;
  autoSyncOrders: boolean;
  captureChatRequisites: boolean;
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
  positiveCount?: number | null;
  negativeCount?: number | null;
  activeOrders?: number | null;
  merchantLevel?: string | null;
};

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
};

/** Что удалось прочитать прямо со страницы — запасной источник данных. */
export type DomSnapshot = {
  orderId?: string;
  counterpartyUid?: string;
  counterpartyNickname?: string;
  side?: OrderSide;
  status?: OrderStatus;
  fiat?: string;
  amountFiat?: number;
};

/** Откуда взяты данные о контрагенте — показываем в панели. */
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
    text: string;
    createdAt: string;
    author: string;
    isOwn: boolean;
    isTeam: boolean;
    canDelete: boolean;
  }[];
  reviewCounts: { positive: number; neutral: number; negative: number };
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
    mask: string;
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

/** Состояние панели, которое background рассылает в content script. */
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
      /** Роль пользователя — от неё зависит, доступен ли общий ЧС. */
      role: 'USER' | 'TEAM_LEAD' | 'ADMIN';
      hasTeam: boolean;
      /** Реквизиты, замеченные в чате уже после открытия карточки. */
      requisiteAlert?: { mask: string; type: RequisiteType } | null;
    };
