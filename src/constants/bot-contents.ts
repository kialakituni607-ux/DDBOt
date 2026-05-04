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
    COPY_TRADING: 6,
    ANALYSIS_TOOL: 7,
    SMART_ANALYSER: 8,
    ANTIPOVERTY_AI: 9,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-charts',
    'id-tutorials',
    'id-entry-scanner',
    'id-free-bots',
    'id-copy-trading',
    'id-analysis-tool',
    'id-smart-analyser',
    'id-antipoverty-ai',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
