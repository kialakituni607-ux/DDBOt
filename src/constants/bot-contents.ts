type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    CHART: 2,
    TUTORIAL: 3,
    ENTRY_SCANNER: 4,
    FREE_BOTS: 5,
    SMART_ANALYSER: 6,
    ANALYSIS_TOOL: 7,
    ANTIPOVERTY_AI: 8,
    ADMIN: 9,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-charts',
    'id-tutorials',
    'id-entry-scanner',
    'id-free-bots',
    'id-smart-analyser',
    'id-analysis-tool',
    'id-antipoverty-ai',
    'id-admin',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
