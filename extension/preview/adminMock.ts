// админка ходит в API обычным fetch, поэтому подменяем его, а не компоненты
// расширение сюда не попадает: оно общается через chrome.runtime

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const TEAMS = [
  {
    id: 'team-alpha',
    name: 'Alpha Desk',
    slug: 'alpha-desk',
    owner: { id: 'u-1', binanceUid: '287431109', nickname: 'ProDavan' },
    members: 3,
    orders: 473,
    notes: 28,
    volumeFiat: 16_490_000,
    createdAt: daysAgo(210),
  },
  {
    id: 'team-beta',
    name: 'Beta Flow',
    slug: 'beta-flow',
    owner: { id: 'u-4', binanceUid: '660112904', nickname: 'Darkmane' },
    members: 2,
    orders: 156,
    notes: 7,
    volumeFiat: 4_120_000,
    createdAt: daysAgo(94),
  },
];

const USERS = [
  {
    id: 'u-1',
    binanceUid: '287431109',
    nickname: 'ProDavan',
    role: 'TEAM_LEAD',
    status: 'ACTIVE',
    blockReason: null,
    team: { id: 'team-alpha', name: 'Alpha Desk' },
    subscription: { plan: 'FREE', status: 'ACTIVE', until: null },
    createdAt: daysAgo(210),
    lastSeenAt: hoursAgo(1),
    orders: 214,
    reviews: 41,
    completedOrders: 205,
    volumeFiat: 8_940_000,
  },
  {
    id: 'u-2',
    binanceUid: '551208833',
    nickname: 'VitcoinoV',
    role: 'USER',
    status: 'ACTIVE',
    blockReason: null,
    team: { id: 'team-alpha', name: 'Alpha Desk' },
    subscription: { plan: 'FREE', status: 'ACTIVE', until: null },
    createdAt: daysAgo(168),
    lastSeenAt: hoursAgo(4),
    orders: 168,
    reviews: 23,
    completedOrders: 160,
    volumeFiat: 5_120_000,
  },
  {
    id: 'u-3',
    binanceUid: '410772651',
    nickname: 'PiterGrif',
    role: 'USER',
    status: 'ACTIVE',
    blockReason: null,
    team: { id: 'team-alpha', name: 'Alpha Desk' },
    subscription: { plan: 'FREE', status: 'ACTIVE', until: null },
    createdAt: daysAgo(120),
    lastSeenAt: daysAgo(2),
    orders: 91,
    reviews: 12,
    completedOrders: 86,
    volumeFiat: 2_430_000,
  },
  {
    id: 'u-4',
    binanceUid: '660112904',
    nickname: 'Darkmane',
    role: 'TEAM_LEAD',
    status: 'ACTIVE',
    blockReason: null,
    team: { id: 'team-beta', name: 'Beta Flow' },
    subscription: { plan: 'FREE', status: 'ACTIVE', until: null },
    createdAt: daysAgo(94),
    lastSeenAt: hoursAgo(9),
    orders: 156,
    reviews: 8,
    completedOrders: 149,
    volumeFiat: 4_120_000,
  },
  {
    id: 'u-5',
    binanceUid: '905447312',
    nickname: 'sdwrus',
    role: 'USER',
    status: 'BLOCKED',
    blockReason: 'Продажа доступа третьим лицам',
    team: null,
    subscription: { plan: 'FREE', status: 'CANCELLED', until: null },
    createdAt: daysAgo(61),
    lastSeenAt: daysAgo(12),
    orders: 34,
    reviews: 2,
    completedOrders: 21,
    volumeFiat: 610_000,
  },
  {
    id: 'u-admin',
    binanceUid: '100000001',
    nickname: 'admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    blockReason: null,
    team: null,
    subscription: { plan: 'FREE', status: 'ACTIVE', until: null },
    createdAt: daysAgo(240),
    lastSeenAt: hoursAgo(0.1),
    orders: 0,
    reviews: 0,
    completedOrders: 0,
    volumeFiat: 0,
  },
];

const TOKENS = [
  {
    id: 'tk-1',
    label: 'Alpha Desk — набор',
    role: 'USER',
    team: { id: 'team-alpha', name: 'Alpha Desk' },
    maxUses: 5,
    uses: 3,
    expiresAt: daysAgo(-24),
    revokedAt: null,
    usedBy: { id: 'u-3', binanceUid: '410772651', nickname: 'PiterGrif' },
    usedAt: daysAgo(12),
    createdAt: daysAgo(30),
    createdBy: '100000001',
    status: 'ACTIVE',
  },
  {
    id: 'tk-2',
    label: 'Beta Flow — тимлид',
    role: 'TEAM_LEAD',
    team: { id: 'team-beta', name: 'Beta Flow' },
    maxUses: 1,
    uses: 1,
    expiresAt: daysAgo(-60),
    revokedAt: null,
    usedBy: { id: 'u-4', binanceUid: '660112904', nickname: 'Darkmane' },
    usedAt: daysAgo(94),
    createdAt: daysAgo(95),
    createdBy: '100000001',
    status: 'USED',
  },
  {
    id: 'tk-3',
    label: 'разовый, отозван',
    role: 'USER',
    team: null,
    maxUses: 1,
    uses: 0,
    expiresAt: daysAgo(-3),
    revokedAt: daysAgo(5),
    usedBy: null,
    usedAt: null,
    createdAt: daysAgo(20),
    createdBy: '100000001',
    status: 'REVOKED',
  },
];

const AUDIT = [
  { action: 'admin.user_blocked', targetType: 'user', targetId: 'u-5', meta: { reason: 'Продажа доступа третьим лицам' }, at: hoursAgo(3) },
  { action: 'blacklist.add', targetType: 'counterparty', targetId: 'cp-demo-scam', meta: { scope: 'GLOBAL', severity: 3 }, at: hoursAgo(5) },
  { action: 'review.upsert', targetType: 'counterparty', targetId: 'cp-demo-scam', meta: { rating: 'NEGATIVE', tag: 'SCAM' }, at: hoursAgo(6) },
  { action: 'admin.token_created', targetType: 'invite_token', targetId: 'tk-1', meta: { role: 'USER', maxUses: 5 }, at: daysAgo(30) },
  { action: 'team.joined', targetType: 'team', targetId: 'team-alpha', meta: { inviteId: 'tk-1' }, at: daysAgo(12) },
  { action: 'auth.refresh_reuse_detected', targetType: null, targetId: null, meta: { familyId: 'e4b1f5b2' }, at: daysAgo(18) },
].map((row, i) => ({
  id: `au-${i}`,
  action: row.action,
  targetType: row.targetType,
  targetId: row.targetId,
  meta: row.meta,
  ip: '127.0.0.1',
  createdAt: row.at,
  actor: { id: 'u-admin', binanceUid: '100000001', nickname: 'admin' },
}));

const OVERVIEW = {
  users: USERS.length,
  blocked: USERS.filter((u) => u.status === 'BLOCKED').length,
  activeUsers30d: 5,
  teams: TEAMS.length,
  counterparties: 1284,
  reviews: 386,
  blacklist: 97,
  orders: { COMPLETED: 621, CANCELLED: 74, APPEALING: 5, PENDING: 3, PAID: 2, UNKNOWN: 0 },
  volumeFiat: 20_610_000,
};

const USER_DETAIL = {
  user: {
    ...USERS[0]!,
    team: { id: 'team-alpha', name: 'Alpha Desk', slug: 'alpha-desk' },
    activeSessions: 2,
  },
  stats: {
    ordersByStatus: { COMPLETED: 205, CANCELLED: 9 },
    totalOrders: 214,
    completed: 205,
    cancelled: 9,
    volumeFiat: 8_940_000,
    avgTicketFiat: 43_600,
    volume30dFiat: 1_240_000,
    completed30d: 28,
  },
  partners: [
    { counterpartyId: 'cp-demo-scam', externalId: '421044135', nickname: 'aminexh', countryCode: 'MAR', blacklisted: true, orders: 6, volumeFiat: 540_000 },
    { counterpartyId: 'cp-demo-clean', externalId: '530537036', nickname: 'Lev207', countryCode: 'RUS', blacklisted: false, orders: 31, volumeFiat: 1_180_000 },
    { counterpartyId: 'cp-3', externalId: '100975212', nickname: 'sdwrus', countryCode: 'LKA', blacklisted: true, orders: 4, volumeFiat: 96_000 },
  ],
  recentOrders: [
    { id: 'o-1', externalId: '20260814000486', side: 'BUY', status: 'CANCELLED', fiat: 'RUB', amountFiat: 180_000, createdAt: hoursAgo(3), counterparty: { id: 'cp-demo-scam', externalId: '421044135', nickname: 'aminexh' } },
    { id: 'o-2', externalId: '20260814000221', side: 'BUY', status: 'COMPLETED', fiat: 'RUB', amountFiat: 15_003, createdAt: daysAgo(2), counterparty: { id: 'cp-demo-clean', externalId: '530537036', nickname: 'Lev207' } },
    { id: 'o-3', externalId: '20260813000150', side: 'SELL', status: 'COMPLETED', fiat: 'RUB', amountFiat: 45_000, createdAt: daysAgo(4), counterparty: { id: 'cp-demo-clean', externalId: '530537036', nickname: 'Lev207' } },
  ],
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

// счётчик, чтобы выданный на стенде токен не повторялся
let issued = 0;

function route(path: string, method: string): Response {
  if (path.endsWith('/auth/login')) {
    return json({
      accessToken: 'demo-access',
      refreshToken: 'demo-refresh',
      expiresIn: 900,
      user: {
        id: 'u-admin',
        binanceUid: '100000001',
        nickname: 'admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        teamId: null,
        subscription: { plan: 'FREE', status: 'ACTIVE', until: null },
      },
    });
  }
  if (path.endsWith('/auth/logout') || path.endsWith('/auth/refresh')) return json({ ok: true });

  if (path.includes('/admin/overview')) return json(OVERVIEW);

  if (/\/admin\/users\/[^/]+$/.test(path) && method === 'GET') return json(USER_DETAIL);
  if (path.includes('/admin/users')) {
    if (method !== 'GET') return json({ ok: true });
    return json({ items: USERS, total: USERS.length, limit: 25, offset: 0 });
  }

  if (path.includes('/admin/tokens')) {
    if (method === 'POST') {
      issued += 1;
      return json({ id: `tk-new-${issued}`, token: `DEMO${issued}Kq7Rt2Fv9LmPz4WbN8sYc1JhTgE`, maxUses: 1 });
    }
    if (method === 'DELETE') return json({ ok: true });
    return json({ items: TOKENS, total: TOKENS.length, limit: 25, offset: 0 });
  }

  if (path.includes('/admin/teams')) {
    if (method !== 'GET') return json({ ok: true });
    return json({ items: TEAMS });
  }

  if (path.includes('/admin/audit')) {
    return json({ items: AUDIT, total: AUDIT.length, limit: 50, offset: 0 });
  }

  return json({ error: { code: 'NOT_FOUND', message: `Заглушка не знает ${method} ${path}` } }, 404);
}

// подменяет fetch и заранее логинит админа, чтобы стенд открывался сразу
export function installAdminMock(): void {
  localStorage.setItem(
    'pg.admin.session',
    JSON.stringify({
      accessToken: 'demo-access',
      refreshToken: 'demo-refresh',
      user: {
        id: 'u-admin',
        binanceUid: '100000001',
        nickname: 'admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        teamId: null,
        subscription: { plan: 'FREE', status: 'ACTIVE', until: null },
      },
    }),
  );

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    // небольшая задержка, чтобы на стенде было видно загрузку
    await new Promise((r) => setTimeout(r, 90));
    return route(url, method);
  };
}
