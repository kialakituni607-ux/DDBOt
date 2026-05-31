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
    MANUAL_TRADING: 6,
    COPY_TRADING: 7,
    ANALYSIS_TOOL: 8,
    SMART_ANALYSER: 9,
    ANTIPOVERTY_AI: 10,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-charts',
    'id-tutorials',
    'id-entry-scanner',
    'id-free-bots',
    'id-manual-trading',
    'id-copy-trading',
    'id-analysis-tool',
    'id-smart-analyser',
    'id-antipoverty-ai',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
