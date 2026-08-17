// типы ответов бэкенда, которые использует админка

export type Role = 'USER' | 'TEAM_LEAD' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'BLOCKED';
export type OrderStatus = 'PENDING' | 'PAID' | 'COMPLETED' | 'CANCELLED' | 'APPEALING' | 'UNKNOWN';

export type Subscription = {
  plan: 'FREE' | 'PRO';
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  until: string | null;
};

export type Session = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    binanceUid: string;
    nickname: string | null;
    role: Role;
    status: UserStatus;
    teamId: string | null;
    subscription: Subscription;
  };
};

export type Overview = {
  users: number;
  blocked: number;
  activeUsers30d: number;
  teams: number;
  counterparties: number;
  reviews: number;
  blacklist: number;
  orders: Partial<Record<OrderStatus, number>>;
  volumeFiat: number;
};

export type AdminUser = {
  id: string;
  binanceUid: string;
  nickname: string | null;
  role: Role;
  status: UserStatus;
  blockReason: string | null;
  team: { id: string; name: string } | null;
  subscription: Subscription;
  createdAt: string;
  lastSeenAt: string | null;
  orders: number;
  reviews: number;
  completedOrders: number;
  volumeFiat: number;
};

export type UserDetail = {
  user: {
    id: string;
    binanceUid: string;
    nickname: string | null;
    role: Role;
    status: UserStatus;
    blockReason: string | null;
    team: { id: string; name: string; slug: string } | null;
    subscription: Subscription;
    createdAt: string;
    lastSeenAt: string | null;
    activeSessions: number;
  };
  stats: {
    ordersByStatus: Partial<Record<OrderStatus, number>>;
    totalOrders: number;
    completed: number;
    cancelled: number;
    volumeFiat: number;
    avgTicketFiat: number;
    volume30dFiat: number;
    completed30d: number;
  };
  partners: {
    counterpartyId: string | null;
    externalId: string | null;
    nickname: string | null;
    countryCode: string | null;
    blacklisted: boolean;
    orders: number;
    volumeFiat: number;
  }[];
  recentOrders: {
    id: string;
    externalId: string;
    side: 'BUY' | 'SELL';
    status: OrderStatus;
    fiat: string | null;
    amountFiat: number | null;
    createdAt: string;
    counterparty: { id: string; externalId: string; nickname: string | null } | null;
  }[];
};

export type InviteTokenRow = {
  id: string;
  label: string | null;
  role: Role;
  team: { id: string; name: string } | null;
  maxUses: number;
  uses: number;
  expiresAt: string | null;
  revokedAt: string | null;
  usedBy: { id: string; binanceUid: string; nickname: string | null } | null;
  usedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'USED';
};

export type TeamRow = {
  id: string;
  name: string;
  slug: string;
  owner: { id: string; binanceUid: string; nickname: string | null } | null;
  members: number;
  orders: number;
  notes: number;
  volumeFiat: number;
  createdAt: string;
};

export type AuditRow = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: unknown;
  ip: string | null;
  createdAt: string;
  actor: { id: string; binanceUid: string; nickname: string | null } | null;
};

export type Paged<T> = { items: T[]; total: number; limit: number; offset: number };
