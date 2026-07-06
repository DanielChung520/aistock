// 模拟数据

export const statsData = {
  visitors: {
    value: '24,532',
    change: '+14%',
    trend: 'up',
    period: 'Since last week',
  },
  activity: {
    value: '63,200',
    change: '-12%',
    trend: 'down',
    period: 'Since last week',
    tag: 'Annual',
  },
  realTime: {
    value: '1,320',
    change: '-18%',
    trend: 'down',
    period: 'Since last week',
    tag: 'Monthly',
  },
  bounce: {
    value: '12,364',
    change: '+27%',
    trend: 'up',
    period: 'Since last week',
    tag: 'Yearly',
  },
};

export const yearlyTrendData = [
  { month: 'Jan', value: 2400 },
  { month: 'Feb', value: 4200 },
  { month: 'Mar', value: 2800 },
  { month: 'Apr', value: 4800 },
  { month: 'May', value: 3200 },
  { month: 'Jun', value: 3600 },
  { month: 'Jul', value: 3000 },
  { month: 'Aug', value: 5200 },
  { month: 'Sep', value: 3800 },
  { month: 'Oct', value: 5600 },
  { month: 'Nov', value: 4000 },
  { month: 'Dec', value: 6200 },
];

export const deviceData = [
  { month: 'Jan', desktop: 1400, mobile: 1000 },
  { month: 'Feb', desktop: 2500, mobile: 1700 },
  { month: 'Mar', desktop: 1600, mobile: 1200 },
  { month: 'Apr', desktop: 2800, mobile: 2000 },
  { month: 'May', desktop: 1900, mobile: 1300 },
  { month: 'Jun', desktop: 2100, mobile: 1500 },
  { month: 'Jul', desktop: 1800, mobile: 1200 },
  { month: 'Aug', desktop: 3000, mobile: 2200 },
  { month: 'Sep', desktop: 2200, mobile: 1600 },
  { month: 'Oct', desktop: 3300, mobile: 2300 },
  { month: 'Nov', desktop: 2400, mobile: 1600 },
  { month: 'Dec', desktop: 3600, mobile: 2600 },
];

export const sourceMediumData = [
  { source: 'Social', revenue: 260, value: '+35%', color: '#3b82f6' },
  { source: 'Search Engines', revenue: 125, value: '-12%', color: '#f97316' },
  { source: 'Direct', revenue: 164, value: '+46%', color: '#ef4444' },
];

export const languagesData = [
  { language: 'en-us', users: 865, percentage: 86.5 },
  { language: 'en-gb', users: 240, percentage: 24.0 },
  { language: 'fr-fr', users: 220, percentage: 22.0 },
  { language: 'es-es', users: 162, percentage: 16.2 },
  { language: 'de-de', users: 86, percentage: 8.6 },
  { language: 'ru-ru', users: 32, percentage: 3.2 },
];

export const trafficSourcesData = [
  {
    source: 'Google',
    users: 1023,
    sessions: 1265,
    bounceRate: 30,
    avgDuration: '00:06:25',
  },
  {
    source: 'Direct',
    users: 872,
    sessions: 1077,
    bounceRate: 63,
    avgDuration: '00:09:18',
  },
  {
    source: 'X',
    users: 812,
    sessions: 1003,
    bounceRate: 28,
    avgDuration: '00:05:56',
  },
  {
    source: 'GitHub',
    users: 713,
    sessions: 881,
    bounceRate: 22,
    avgDuration: '00:06:19',
  },
  {
    source: 'DuckDuckGo',
    users: 693,
    sessions: 856,
    bounceRate: 56,
    avgDuration: '00:09:12',
  },
  {
    source: 'Facebook',
    users: 623,
    sessions: 770,
    bounceRate: 20,
    avgDuration: '00:04:42',
  },
];

export const visitorLocations = [
  { lat: 40.7128, lng: -74.006, city: 'New York' },
  { lat: 51.5074, lng: -0.1278, city: 'London' },
  { lat: 35.6762, lng: 139.6503, city: 'Tokyo' },
  { lat: 48.8566, lng: 2.3522, city: 'Paris' },
  { lat: 52.52, lng: 13.405, city: 'Berlin' },
  { lat: 37.7749, lng: -122.4194, city: 'San Francisco' },
  { lat: 55.7558, lng: 37.6173, city: 'Moscow' },
  { lat: 22.3193, lng: 114.1694, city: 'Hong Kong' },
  { lat: 1.3521, lng: 103.8198, city: 'Singapore' },
  { lat: 33.8688, lng: 151.2093, city: 'Sydney' },
];

export const userData = {
  name: 'Lucy Lavender',
  role: 'UX Designer',
  avatar: '',
};

export const navItems = {
  pages: [
    {
      title: 'Dashboard',
      href: '/',
      children: [
        { title: 'Default', href: '/dashboard/default' },
        { title: 'Analytics', href: '/dashboard/analytics' },
      ],
    },
    {
      title: 'SaaS',
      href: '/saas',
      children: [
        { title: 'Pages', href: '/saas/pages' },
        { title: 'Projects', href: '/saas/projects', badge: 8 },
        { title: 'Orders', href: '/saas/orders' },
        { title: 'Products', href: '/saas/products' },
        { title: 'Invoices', href: '/saas/invoices' },
        { title: 'Tasks', href: '/saas/tasks', badge: 17 },
        { title: 'Calendar', href: '/saas/calendar' },
        { title: 'Auth', href: '/saas/auth' },
      ],
    },
  ],
  elements: [
    { title: 'Components', href: '/elements/components' },
    { title: 'Charts', href: '/elements/charts' },
    { title: 'Forms', href: '/elements/forms' },
    { title: 'Tables', href: '/elements/tables' },
    { title: 'Icons', href: '/elements/icons' },
    { title: 'Maps', href: '/elements/maps' },
  ],
  miraPro: [
    { title: 'Documentation', href: '/docs' },
    { title: 'Changelog', href: '/changelog', badge: 'v6.1.0' },
  ],
};
